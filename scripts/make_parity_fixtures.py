"""Generate tests/fixtures/parity.json: Python reference outputs that the
JavaScript engine (web/engine.js) must reproduce.

Run from the repo root:  python scripts/make_parity_fixtures.py
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from planner.model import PlanInputs, simulate  # noqa: E402
from planner.social_security import estimate_annual_benefit  # noqa: E402

OUT = ROOT / "tests" / "fixtures" / "parity.json"


def exact_case(name: str, inputs: PlanInputs, seed: int) -> dict:
    """Same inputs + the same explicit return matrix -> outputs must match exactly."""
    rng = np.random.default_rng(seed)
    returns = rng.normal(0.035, 0.11, size=(4, inputs.years)).round(10)  # JSON-exact inputs
    res = simulate(inputs, returns)
    return {
        "name": name,
        "inputs": asdict(inputs),
        "returns": returns.tolist(),
        "expected": {
            "balances_by_sim": res.balances.round(6).tolist(),
            "success": res.success.astype(int).tolist(),
            "depletion_age": [None if np.isnan(x) else float(x) for x in res.depletion_age],
            "funded_ratio": res.funded_ratio.round(10).tolist(),
            "contributions": res.contributions.round(6).tolist(),
            "social_security": res.social_security.round(6).tolist(),
            "spending": round(res.spending, 6),
            "equity_weights": res.equity_weights.round(10).tolist(),
        },
    }


def stochastic_case(name: str, inputs: PlanInputs) -> dict:
    """Different RNGs -> results must agree statistically."""
    res = simulate(inputs)
    return {
        "name": name,
        "inputs": asdict(inputs),
        "success_probability": res.success_probability,
        "median_at_retirement": res.at_retirement(50),
    }


def main() -> None:
    exact = [
        exact_case("new grad, estimated Social Security",
                   PlanInputs(current_age=22, current_savings=5_000, annual_income=78_000, savings_rate=0.12), 1),
        exact_case("pre-retiree, haircut, early claim, explicit spending",
                   PlanInputs(current_age=55, retirement_age=62, current_savings=650_000, annual_income=160_000,
                              savings_rate=0.18, retirement_spending=95_000, ss_claim_age=62, ss_haircut=True,
                              advisory_fee=0.01, fund_fee=0.0065), 2),
        exact_case("runs out of money",
                   PlanInputs(current_age=60, retirement_age=61, current_savings=200_000, annual_income=90_000,
                              savings_rate=0.0, retirement_spending=70_000, social_security=20_000), 3),
    ]
    ss = [
        {"inputs": asdict(p), "expected": estimate_annual_benefit(p.current_age, p.retirement_age, p.annual_income,
                                                                   p.real_income_growth, p.ss_claim_age)}
        for p in (
            PlanInputs(),
            PlanInputs(current_age=40, annual_income=250_000, ss_claim_age=70),
            PlanInputs(current_age=30, retirement_age=50, annual_income=45_000, ss_claim_age=62),
        )
    ]
    stochastic = [
        stochastic_case("default client", PlanInputs(n_sims=20_000)),
        stochastic_case("mid-career, conservative markets",
                        PlanInputs(current_age=40, current_savings=180_000, annual_income=140_000, savings_rate=0.15,
                                   market="vanguard_2026", n_sims=20_000)),
        stochastic_case("traditional advisor fees",
                        PlanInputs(current_age=35, current_savings=90_000, annual_income=120_000, savings_rate=0.12,
                                   advisory_fee=0.01, fund_fee=0.0065, n_sims=20_000)),
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"exact": exact, "social_security": ss, "stochastic": stochastic}, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
