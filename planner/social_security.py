"""Social Security retirement benefit estimate using the SSA's PIA formula.

This is a planning approximation, not an official estimate. It works in
today's dollars: because SSA indexes past earnings and bend points to wage
growth, applying current bend points to a real (inflation-adjusted) earnings
record gives a reasonable estimate. Clients should replace it with the figure
on their own statement at ssa.gov/myaccount.
"""

from __future__ import annotations

import numpy as np

from . import assumptions as A

CAREER_START_AGE = 22
COMPUTATION_YEARS = 35


def primary_insurance_amount(aime: float) -> float:
    """Monthly benefit at full retirement age (90% / 32% / 15% formula)."""
    cfg = A.social_security()
    b1, b2 = cfg["bend_point_1"], cfg["bend_point_2"]
    return (
        0.90 * min(aime, b1)
        + 0.32 * max(min(aime, b2) - b1, 0.0)
        + 0.15 * max(aime - b2, 0.0)
    )


def claiming_adjustment(claim_age: int, fra: int | None = None) -> float:
    """Multiplier for claiming before or after full retirement age."""
    fra = A.social_security()["full_retirement_age"] if fra is None else fra
    months = (claim_age - fra) * 12
    if months < 0:
        early = -months
        reduction = min(early, 36) * (5 / 9) / 100 + max(early - 36, 0) * (5 / 12) / 100
        return 1.0 - reduction
    delayed_years = min(claim_age, 70) - fra
    return 1.0 + 0.08 * max(delayed_years, 0)


def earnings_record(current_age: int, retirement_age: int, annual_income: float, real_income_growth: float) -> np.ndarray:
    """Approximate real earnings from age 22 to retirement.

    Past earnings are back-cast from today's income at the same growth rate;
    future earnings follow the projected path.
    """
    start = min(CAREER_START_AGE, current_age)
    ages = np.arange(start, retirement_age)
    return annual_income * (1.0 + real_income_growth) ** (ages - current_age)


def estimate_annual_benefit(
    current_age: int,
    retirement_age: int,
    annual_income: float,
    real_income_growth: float,
    claim_age: int = 67,
) -> float:
    cfg = A.social_security()
    record = np.minimum(earnings_record(current_age, retirement_age, annual_income, real_income_growth), cfg["taxable_maximum"])
    top = np.sort(record)[::-1][:COMPUTATION_YEARS]
    aime = top.sum() / (COMPUTATION_YEARS * 12)
    monthly = primary_insurance_amount(aime) * claiming_adjustment(claim_age)
    return float(12 * monthly)
