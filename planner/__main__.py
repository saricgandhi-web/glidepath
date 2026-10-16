"""Command-line plan: ``python -m planner --age 30 --income 95000 --savings 40000``."""

from __future__ import annotations

import argparse

from .model import PlanInputs
from .report import build_plan, format_plan


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="planner", description="Monte Carlo retirement plan in today's dollars.")
    p.add_argument("--age", type=int, default=22, help="current age")
    p.add_argument("--retire", type=int, default=65, help="retirement age")
    p.add_argument("--plan-to", type=int, default=95, help="plan through this age")
    p.add_argument("--savings", type=float, default=0.0, help="current invested savings ($)")
    p.add_argument("--income", type=float, default=80_000.0, help="annual pre-tax income ($)")
    p.add_argument("--rate", type=float, default=0.10, help="savings rate incl. employer match (0.10 = 10%%)")
    p.add_argument("--spend", type=float, default=None, help="retirement spending, today's $/yr (default: 70%% of final income)")
    p.add_argument("--ss", type=float, default=None, help="Social Security, today's $/yr (default: estimated)")
    p.add_argument("--claim", type=int, default=67, help="Social Security claim age")
    p.add_argument("--fee", type=float, default=0.0, help="advisory fee (0.01 = 1%%)")
    p.add_argument("--fund-fee", type=float, default=0.0005, help="fund expense ratio")
    p.add_argument("--market", choices=["jpm_2026", "vanguard_2026"], default="jpm_2026")
    p.add_argument("--haircut", action="store_true", help="cut Social Security to 83%% from 2034")
    p.add_argument("--rule", choices=["fixed", "guardrails", "percent"], default="fixed", help="retirement spending rule")
    p.add_argument("--crash", action="store_true", help="stress test: -25%% and -10%% returns in the first two retirement years")
    p.add_argument("--sims", type=int, default=5_000)
    a = p.parse_args(argv)

    inputs = PlanInputs(
        current_age=a.age, retirement_age=a.retire, plan_to_age=a.plan_to, current_savings=a.savings,
        annual_income=a.income, savings_rate=a.rate, retirement_spending=a.spend, social_security=a.ss,
        ss_claim_age=a.claim, advisory_fee=a.fee, fund_fee=a.fund_fee, market=a.market,
        ss_haircut=a.haircut, spending_rule=a.rule, retirement_shock=(-0.25, -0.10) if a.crash else (), n_sims=a.sims,
    )
    print(format_plan(build_plan(inputs)))


if __name__ == "__main__":
    main()
