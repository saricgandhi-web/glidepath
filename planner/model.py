"""Monte Carlo goals-based retirement planning engine.

The model runs in annual steps and in *real* (today's) dollars:

1. Each year, equity and bond returns are drawn from correlated lognormal
   distributions calibrated to a capital market assumption set.
2. The portfolio is rebalanced annually along a glide path that moves from
   ``equity_now`` to ``equity_at_retirement``.
3. Advisory and fund fees are deducted from each year's return, then the
   result is deflated by inflation.
4. While working, the client contributes ``savings_rate`` of income at the
   start of each year. In retirement, the portfolio funds whatever spending
   Social Security does not cover.
5. A spending rule sets each retirement year's withdrawal: a fixed real
   amount, Guyton-Klinger style guardrails, or a share of the portfolio.
6. A path *succeeds* if every planned withdrawal is paid in full through
   ``plan_to_age``.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np

from . import assumptions as A
from .social_security import estimate_annual_benefit

PERCENTILES = (10, 25, 50, 75, 90)
SPENDING_RULES = ("fixed", "guardrails", "percent")

# Guardrails (after Guyton & Klinger, 2006): compare this year's withdrawal rate
# with the rate at retirement. Above 120% of it, cut spending 10%; below 80%,
# raise it 10%. The multiplier stays between 50% and 150% of the goal.
GUARDRAIL_UPPER = 1.2
GUARDRAIL_LOWER = 0.8
GUARDRAIL_CUT = 0.9
GUARDRAIL_RAISE = 1.1
GUARDRAIL_MIN = 0.5
GUARDRAIL_MAX = 1.5
# A retirement year "falls short" when spending drops below this share of the goal.
SPENDING_FLOOR = 0.8


@dataclass(frozen=True)
class PlanInputs:
    """Everything the planner needs to know about one client."""

    current_age: int = 22
    retirement_age: int = 65
    plan_to_age: int = 95
    current_savings: float = 0.0
    annual_income: float = 80_000.0
    real_income_growth: float = 0.01
    savings_rate: float = 0.10
    # Retirement spending in today's dollars per year. ``None`` means
    # ``replacement_ratio`` x income in the final working year.
    retirement_spending: float | None = None
    replacement_ratio: float = 0.70
    # Social Security in today's dollars per year. ``None`` means estimate it
    # from the projected earnings record with the SSA benefit formula.
    social_security: float | None = None
    ss_claim_age: int = 67
    ss_haircut: bool = False
    equity_now: float = 0.90
    equity_at_retirement: float = 0.50
    advisory_fee: float = 0.0
    fund_fee: float = 0.0005
    market: str = "jpm_2026"
    correlation: float | None = None
    spending_rule: str = "fixed"
    # Real, after-fee returns forced onto the first retirement years, e.g.
    # (-0.25, -0.10) for a crash right after retiring (sequence-of-returns risk).
    retirement_shock: tuple[float, ...] = ()
    n_sims: int = 5_000
    seed: int = 2026
    start_year: int = 2026

    def __post_init__(self) -> None:
        if not 18 <= self.current_age < self.retirement_age <= self.plan_to_age - 1:
            raise ValueError("Ages must satisfy 18 <= current < retirement < plan_to_age.")
        if not 62 <= self.ss_claim_age <= 70:
            raise ValueError("Social Security claim age must be between 62 and 70.")
        for name in ("equity_now", "equity_at_retirement", "savings_rate", "replacement_ratio"):
            if not 0.0 <= getattr(self, name) <= 1.0:
                raise ValueError(f"{name} must be between 0 and 1.")
        if self.n_sims < 1:
            raise ValueError("n_sims must be positive.")
        if self.spending_rule not in SPENDING_RULES:
            raise ValueError(f"spending_rule must be one of {SPENDING_RULES}.")
        if any(not -1.0 < r < 10.0 for r in self.retirement_shock):
            raise ValueError("retirement_shock returns must be greater than -100%.")

    def with_(self, **changes) -> PlanInputs:
        """Return a copy with some fields changed (handy for what-if analysis)."""
        return replace(self, **changes)

    @property
    def years(self) -> int:
        return self.plan_to_age - self.current_age

    @property
    def working_years(self) -> int:
        return self.retirement_age - self.current_age

    @property
    def total_fee(self) -> float:
        return self.advisory_fee + self.fund_fee


@dataclass
class SimulationResult:
    inputs: PlanInputs
    ages: np.ndarray                 # (years + 1,) age at the start of each year
    balances: np.ndarray             # (n_sims, years + 1) start-of-year balances, today's $
    success: np.ndarray              # (n_sims,) bool
    depletion_age: np.ndarray        # (n_sims,) age the money ran out, NaN if never
    funded_ratio: np.ndarray         # (n_sims,) share of retirement withdrawals funded
    contributions: np.ndarray        # (years,) contribution each year, today's $
    spending: float                  # retirement spending goal, today's $/yr
    social_security: np.ndarray      # (years,) benefit each year, today's $
    withdrawals_needed: np.ndarray   # (years,) portfolio withdrawal the fixed goal needs each year
    equity_weights: np.ndarray       # (years,) glide path
    spending_paths: np.ndarray = field(repr=False, default=None)  # (n_sims, years) spending incl. SS
    annual_returns: np.ndarray = field(repr=False, default=None)  # (n_sims, years) real, net of fees

    @property
    def success_probability(self) -> float:
        return float(self.success.mean())

    @property
    def retirement_index(self) -> int:
        return self.inputs.working_years

    def percentile_paths(self, pcts=PERCENTILES) -> dict[int, np.ndarray]:
        return {p: np.percentile(self.balances, p, axis=0) for p in pcts}

    def at_retirement(self, pct: float = 50) -> float:
        return float(np.percentile(self.balances[:, self.retirement_index], pct))

    def terminal(self, pct: float = 50) -> float:
        return float(np.percentile(self.balances[:, -1], pct))

    @property
    def sustained_withdrawal_rate(self) -> float:
        """Portfolio withdrawal once Social Security has started, as a share of
        the median balance at retirement. Comparable to Morningstar's safe
        withdrawal rate, which also excludes Social Security."""
        bal = self.at_retirement(50)
        first_ss_year = max(self.inputs.retirement_age, self.inputs.ss_claim_age) - self.inputs.current_age
        idx = min(first_ss_year, self.inputs.years - 1)
        need = self.withdrawals_needed[idx]
        return float(need / bal) if bal > 0 else float("inf")

    @property
    def bridge_years(self) -> int:
        """Retirement years before Social Security starts (funded entirely by the portfolio)."""
        return max(self.inputs.ss_claim_age - self.inputs.retirement_age, 0)

    def _retired_spending(self) -> np.ndarray:
        return self.spending_paths[:, self.retirement_index:]

    def spending_percentiles(self, pcts=PERCENTILES) -> dict[int, np.ndarray]:
        """Percentiles of each year's actual spending (today's $), retirement years only."""
        return {p: np.percentile(self._retired_spending(), p, axis=0) for p in pcts}

    @property
    def median_spending(self) -> float:
        """Median across paths of average annual spending in retirement."""
        return float(np.median(self._retired_spending().mean(axis=1)))

    @property
    def low_spending(self) -> float:
        """Spending in the leanest retirement year, 10th percentile across paths."""
        return float(np.percentile(self._retired_spending().min(axis=1), 10))

    @property
    def shortfall_probability(self) -> float:
        """Share of paths where spending drops below SPENDING_FLOOR x the goal in some year."""
        floor = SPENDING_FLOOR * self.spending - 1e-6
        return float((self._retired_spending().min(axis=1) < floor).mean())

    def median_depletion_age(self) -> float | None:
        failed = self.depletion_age[~np.isnan(self.depletion_age)]
        return float(np.median(failed)) if failed.size else None

    def summary(self) -> dict:
        return {
            "success_probability": round(self.success_probability, 4),
            "median_at_retirement": round(self.at_retirement(50)),
            "p10_at_retirement": round(self.at_retirement(10)),
            "median_terminal": round(self.terminal(50)),
            "retirement_spending": round(self.spending),
            "social_security": round(float(self.social_security.max())),
            "sustained_withdrawal_rate": round(self.sustained_withdrawal_rate, 4),
            "bridge_years": self.bridge_years,
            "mean_funded_ratio": round(float(self.funded_ratio.mean()), 4),
            "median_depletion_age": self.median_depletion_age(),
            "median_spending": round(self.median_spending),
            "low_spending": round(self.low_spending),
            "shortfall_probability": round(self.shortfall_probability, 4),
        }


def lognormal_params(compound_return: float, vol: float) -> tuple[float, float]:
    """Log-space (mu, sigma) so the median gross return is 1 + compound_return
    and the standard deviation of the simple return equals ``vol``."""
    g = 1.0 + compound_return
    u = (1.0 + np.sqrt(1.0 + 4.0 * vol**2 / g**2)) / 2.0
    return float(np.log(g)), float(np.sqrt(np.log(u)))


def glide_path(inputs: PlanInputs) -> np.ndarray:
    """Equity weight for each simulated year (linear de-risking to retirement)."""
    t = np.arange(inputs.years)
    frac = np.clip(t / inputs.working_years, 0.0, 1.0)
    return inputs.equity_now + (inputs.equity_at_retirement - inputs.equity_now) * frac


def income_path(inputs: PlanInputs) -> np.ndarray:
    """Real income for each year of the plan (zero once retired)."""
    t = np.arange(inputs.years)
    income = inputs.annual_income * (1.0 + inputs.real_income_growth) ** t
    income[t >= inputs.working_years] = 0.0
    return income


def retirement_spending(inputs: PlanInputs) -> float:
    if inputs.retirement_spending is not None:
        return float(inputs.retirement_spending)
    final_income = inputs.annual_income * (1.0 + inputs.real_income_growth) ** max(inputs.working_years - 1, 0)
    return float(inputs.replacement_ratio * final_income)


def social_security_path(inputs: PlanInputs) -> np.ndarray:
    ss_cfg = A.social_security()
    if inputs.social_security is not None:
        benefit = float(inputs.social_security)
    else:
        benefit = estimate_annual_benefit(
            current_age=inputs.current_age,
            retirement_age=inputs.retirement_age,
            annual_income=inputs.annual_income,
            real_income_growth=inputs.real_income_growth,
            claim_age=inputs.ss_claim_age,
        )
    ages = inputs.current_age + np.arange(inputs.years)
    years = inputs.start_year + np.arange(inputs.years)
    ss = np.where((ages >= inputs.ss_claim_age) & (ages >= inputs.retirement_age), benefit, 0.0)
    if inputs.ss_haircut:
        cut = years >= ss_cfg["combined_trust_fund_depletion_year"]
        ss = np.where(cut, ss * ss_cfg["payable_ratio_at_depletion"], ss)
    return ss


def simulate_returns(inputs: PlanInputs) -> np.ndarray:
    """Real, after-fee portfolio returns with shape (n_sims, years)."""
    m = A.market(inputs.market)
    rho = m.correlation if inputs.correlation is None else inputs.correlation
    mu_e, sd_e = lognormal_params(m.equity_return, m.equity_vol)
    mu_b, sd_b = lognormal_params(m.bond_return, m.bond_vol)

    rng = np.random.default_rng(inputs.seed)
    z1 = rng.standard_normal((inputs.n_sims, inputs.years))
    z2 = rng.standard_normal((inputs.n_sims, inputs.years))
    eq = np.exp(mu_e + sd_e * z1) - 1.0
    bd = np.exp(mu_b + sd_b * (rho * z1 + np.sqrt(1.0 - rho**2) * z2)) - 1.0

    w = glide_path(inputs)
    nominal = w * eq + (1.0 - w) * bd
    after_fee = (1.0 + nominal) * (1.0 - inputs.total_fee) - 1.0
    return (1.0 + after_fee) / (1.0 + m.inflation) - 1.0


def simulate(inputs: PlanInputs, returns: np.ndarray | None = None) -> SimulationResult:
    """Run the Monte Carlo simulation. Pass ``returns`` to reuse a return matrix."""
    real_returns = simulate_returns(inputs) if returns is None else returns
    n, T = real_returns.shape
    R = inputs.working_years
    if inputs.retirement_shock:
        real_returns = real_returns.copy()
        for i, shock in enumerate(inputs.retirement_shock):
            if R + i < T:
                real_returns[:, R + i] = shock

    contributions = inputs.savings_rate * income_path(inputs)
    spend = retirement_spending(inputs)
    ss = social_security_path(inputs)
    ages = inputs.current_age + np.arange(T + 1)
    retired = ages[:-1] >= inputs.retirement_age
    need = np.where(retired, np.maximum(spend - ss, 0.0), 0.0)
    rule = inputs.spending_rule

    balances = np.empty((n, T + 1))
    balances[:, 0] = inputs.current_savings
    spending_paths = np.zeros((n, T))
    depletion_age = np.full(n, np.nan)
    funded = np.zeros(n)
    alive = np.ones(n, dtype=bool)
    multiplier = np.ones(n)
    start_balance = np.ones(n)

    for t in range(T):
        pre = balances[:, t] + contributions[t]
        if t == R:
            start_balance = np.maximum(pre, 1e-9)
        if not retired[t]:
            planned = np.zeros(n)
        elif rule == "percent":
            planned = need[t] * np.maximum(pre, 0.0) / start_balance
        elif rule == "guardrails":
            if t > R:
                ratio = multiplier * start_balance / np.maximum(pre, 1e-9)
                multiplier = np.where(ratio > GUARDRAIL_UPPER, np.maximum(multiplier * GUARDRAIL_CUT, GUARDRAIL_MIN),
                                      np.where(ratio < GUARDRAIL_LOWER,
                                               np.minimum(multiplier * GUARDRAIL_RAISE, GUARDRAIL_MAX), multiplier))
            planned = need[t] * multiplier
        else:
            planned = np.full(n, need[t])
        paid = np.minimum(np.maximum(pre, 0.0), planned)
        funded += paid
        if retired[t]:
            spending_paths[:, t] = paid + ss[t]
        short = (pre < planned - 1e-9) & alive
        depletion_age[short] = ages[t]
        alive &= ~short
        after = np.maximum(pre - planned, 0.0)
        balances[:, t + 1] = after * (1.0 + real_returns[:, t])

    total_need = need.sum()
    funded_ratio = funded / total_need if total_need > 0 else np.ones(n)

    return SimulationResult(
        inputs=inputs,
        ages=ages,
        balances=balances,
        success=alive,
        depletion_age=depletion_age,
        funded_ratio=funded_ratio,
        contributions=contributions,
        spending=spend,
        social_security=ss,
        withdrawals_needed=need,
        equity_weights=glide_path(inputs),
        annual_returns=real_returns,
        spending_paths=spending_paths,
    )
