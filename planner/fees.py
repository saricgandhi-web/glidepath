"""Fee drag: what a percentage-of-assets fee costs over a lifetime."""

from __future__ import annotations

from dataclasses import dataclass

from . import assumptions as A
from .model import PlanInputs, simulate


def deterministic_balance(initial: float, contribution: float, years: int, annual_return: float, fee: float) -> float:
    """Ending balance with start-of-year contributions and a fixed return.

    Fees are charged the same way as in the Monte Carlo model:
    ``(1 + r) * (1 - fee)`` per year.
    """
    bal = initial
    growth = (1.0 + annual_return) * (1.0 - fee)
    for _ in range(years):
        bal = (bal + contribution) * growth
    return bal


def share_of_wealth_lost(years: int, fee: float, annual_return: float = 0.05, contribution: float = 1.0) -> float:
    """Fraction of ending wealth lost to fees for a steady saver."""
    gross = deterministic_balance(0.0, contribution, years, annual_return, 0.0)
    net = deterministic_balance(0.0, contribution, years, annual_return, fee)
    return 1.0 - net / gross


@dataclass(frozen=True)
class FeeComparison:
    key: str
    label: str
    total_fee: float
    success_probability: float
    median_at_retirement: float
    median_terminal: float
    cost_vs_lowest: float  # median wealth at retirement given up vs the cheapest option


def compare_fee_profiles(inputs: PlanInputs, keys: tuple[str, ...] = ("diy_index", "robo", "traditional")) -> list[FeeComparison]:
    """Run the same client under each fee profile with identical market draws."""
    profiles = A.fee_profiles()
    rows = []
    for k in keys:
        p = profiles[k]
        res = simulate(inputs.with_(advisory_fee=p.advisory_fee, fund_fee=p.fund_fee))
        rows.append((p, res))
    best = max(r.at_retirement(50) for _, r in rows)
    return [
        FeeComparison(
            key=p.key,
            label=p.label,
            total_fee=p.total,
            success_probability=r.success_probability,
            median_at_retirement=r.at_retirement(50),
            median_terminal=r.terminal(50),
            cost_vs_lowest=best - r.at_retirement(50),
        )
        for p, r in rows
    ]
