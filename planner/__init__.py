"""Glidepath: a free, transparent goals-based retirement planning engine."""

from .fees import compare_fee_profiles, share_of_wealth_lost
from .model import PlanInputs, SimulationResult, simulate
from .report import build_plan, format_plan
from .social_security import estimate_annual_benefit
from .solvers import earliest_retirement_age, max_sustainable_spending, required_savings_rate

__version__ = "1.0.0"

__all__ = [
    "PlanInputs",
    "SimulationResult",
    "build_plan",
    "compare_fee_profiles",
    "earliest_retirement_age",
    "estimate_annual_benefit",
    "format_plan",
    "max_sustainable_spending",
    "required_savings_rate",
    "share_of_wealth_lost",
    "simulate",
]
