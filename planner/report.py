"""Turn simulation results into plain-English, prioritized recommendations."""

from __future__ import annotations

from dataclasses import dataclass

from . import assumptions as A
from .fees import compare_fee_profiles
from .model import PlanInputs, SimulationResult, simulate
from .solvers import earliest_retirement_age, max_sustainable_spending, required_savings_rate


@dataclass(frozen=True)
class Recommendation:
    title: str
    detail: str
    impact: str  # "high" | "medium" | "low"


def _money(x: float) -> str:
    return f"${x:,.0f}"


def build_plan(inputs: PlanInputs, target: float | None = None) -> dict:
    """Run the full analysis for one client and return a structured plan."""
    bench = A.benchmarks()
    target = bench["target_success_probability"] if target is None else target
    result = simulate(inputs)
    recs: list[Recommendation] = []

    rate = required_savings_rate(inputs, target)
    spend = max_sustainable_spending(inputs, target)
    age = earliest_retirement_age(inputs, target)
    p = result.success_probability

    if p < target:
        if rate is not None:
            recs.append(Recommendation(
                "Raise your savings rate",
                f"Saving {rate:.1%} of income (vs {inputs.savings_rate:.1%} today) lifts the plan to "
                f"{target:.0%} confidence.",
                "high",
            ))
        recs.append(Recommendation(
            "Or right-size the spending goal",
            f"At today's savings rate, {_money(spend // 10 * 10)}/yr in retirement is sustainable at {target:.0%} confidence "
            f"(goal: {_money(result.spending)}/yr).",
            "high",
        ))
        if age is not None and age > inputs.retirement_age:
            recs.append(Recommendation(
                "Or work a little longer",
                f"Retiring at {age} instead of {inputs.retirement_age} reaches {target:.0%} confidence.",
                "medium",
            ))
    else:
        recs.append(Recommendation(
            "You're on track",
            f"{p:.0%} of simulated markets fully fund your goal. You could spend up to {_money(spend // 10 * 10)}/yr, "
            + (f"or retire as early as {age}." if age else "at the current plan."),
            "low",
        ))

    fees = compare_fee_profiles(inputs)
    cheapest = min(fees, key=lambda f: f.total_fee)
    if inputs.total_fee > cheapest.total_fee + 0.0025:
        lost = simulate(inputs.with_(advisory_fee=0.0, fund_fee=cheapest.total_fee)).at_retirement(50) - result.at_retirement(50)
        recs.append(Recommendation(
            "Audit your fees",
            f"An all-in cost of {inputs.total_fee:.2%} reduces median wealth at retirement by about {_money(lost)} "
            f"compared with {cheapest.total_fee:.2%} index funds. Make sure the advice is worth it.",
            "high" if lost > 0.15 * result.at_retirement(50) else "medium",
        ))

    limits = A.contribution_limits()
    tax_adv = limits["employee_401k"] + limits["ira"]
    needed_rate = rate if (rate is not None and p < target) else inputs.savings_rate
    first_contribution = needed_rate * inputs.annual_income
    if first_contribution > tax_adv:
        recs.append(Recommendation(
            "Use accounts beyond your 401(k) and IRA",
            f"Saving {_money(first_contribution)}/yr exceeds the 2026 401(k) + IRA limits of {_money(tax_adv)}. "
            "Route the rest to an HSA (if eligible) or a taxable brokerage account.",
            "medium",
        ))

    wr = result.sustained_withdrawal_rate
    swr = bench["morningstar_safe_withdrawal_rate"]
    if wr > swr:
        bridge = (
            f" The {result.bridge_years} years before Social Security starts are funded entirely by the portfolio, "
            "which adds early sequence-of-returns risk."
            if result.bridge_years else ""
        )
        recs.append(Recommendation(
            "Watch the withdrawal rate",
            f"Once Social Security starts, you draw {wr:.1%} a year from the median portfolio, above Morningstar's "
            f"{swr:.1%} safe starting rate. A flexible spending rule (cut back after bad years) adds a margin "
            f"of safety.{bridge}",
            "medium",
        ))

    if not inputs.ss_haircut:
        stressed = simulate(inputs.with_(ss_haircut=True)).success_probability
        if p - stressed >= 0.03:
            recs.append(Recommendation(
                "Stress-test Social Security",
                f"If benefits are cut to 83% when the trust funds run out in 2034, success falls from {p:.0%} to "
                f"{stressed:.0%}.",
                "medium",
            ))

    order = {"high": 0, "medium": 1, "low": 2}
    recs.sort(key=lambda r: order[r.impact])

    return {
        "result": result,
        "target": target,
        "required_savings_rate": rate,
        "max_spending": spend,
        "earliest_retirement_age": age,
        "fees": fees,
        "recommendations": recs,
    }


def format_plan(plan: dict) -> str:
    r: SimulationResult = plan["result"]
    s = r.summary()
    lines = [
        "GLIDEPATH  |  plan summary (today's dollars)",
        "=" * 58,
        f"Probability of success      {s['success_probability']:.0%}   (target {plan['target']:.0%})",
        f"Median at retirement        {_money(s['median_at_retirement'])}",
        f"Bad-market (10th pct)       {_money(s['p10_at_retirement'])}",
        f"Spending goal               {_money(s['retirement_spending'])}/yr",
        f"Social Security (est.)      {_money(s['social_security'])}/yr",
        f"Sustained withdrawal rate   {s['sustained_withdrawal_rate']:.1%}",
        "",
        "RECOMMENDATIONS",
    ]
    for i, rec in enumerate(plan["recommendations"], 1):
        lines.append(f"{i}. [{rec.impact.upper()}] {rec.title}: {rec.detail}")
    return "\n".join(lines)
