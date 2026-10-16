import unittest

import numpy as np

from planner.model import GUARDRAIL_MAX, SPENDING_FLOOR, PlanInputs, simulate

RETIREE = PlanInputs(current_age=64, retirement_age=65, plan_to_age=95, current_savings=1_000_000,
                     annual_income=1.0, savings_rate=0.0, retirement_spending=60_000, social_security=0.0)


def flat(inputs: PlanInputs, r: float, n: int = 1) -> np.ndarray:
    return np.full((n, inputs.years), r)


class TestFixedRule(unittest.TestCase):
    def test_spending_equals_goal_when_funded(self):
        res = simulate(RETIREE, flat(RETIREE, 0.05))  # $1M covers $60k/yr for 30 years at 5%
        retired = res.spending_paths[0, RETIREE.working_years:]
        np.testing.assert_allclose(retired, 60_000)
        self.assertEqual(res.shortfall_probability, 0.0)

    def test_shortfall_when_money_runs_out(self):
        res = simulate(RETIREE, flat(RETIREE, -0.03))
        self.assertFalse(res.success[0])
        self.assertEqual(res.shortfall_probability, 1.0)
        self.assertLess(res.low_spending, SPENDING_FLOOR * 60_000)


class TestPercentRule(unittest.TestCase):
    def test_never_runs_out(self):
        inp = RETIREE.with_(spending_rule="percent")
        res = simulate(inp, flat(inp, -0.05))
        self.assertTrue(res.success[0])
        self.assertGreater(res.balances[0, -1], 0)

    def test_spending_tracks_the_portfolio(self):
        inp = RETIREE.with_(spending_rule="percent")
        res = simulate(inp, flat(inp, -0.05))
        spend = res.spending_paths[0, inp.working_years:]
        self.assertAlmostEqual(spend[0], 60_000)          # first year = the goal
        self.assertTrue(np.all(np.diff(spend) < 0))       # falling markets, falling spending


class TestGuardrails(unittest.TestCase):
    def test_cuts_spending_and_lasts_longer_in_bad_markets(self):
        fixed = simulate(RETIREE, flat(RETIREE, -0.02))
        guard_inp = RETIREE.with_(spending_rule="guardrails")
        guard = simulate(guard_inp, flat(guard_inp, -0.02))
        self.assertFalse(fixed.success[0])
        self.assertTrue(guard.success[0] or guard.depletion_age[0] > fixed.depletion_age[0] + 5)
        self.assertLess(guard.spending_paths[0, RETIREE.working_years + 10], 60_000)

    def test_raises_spending_in_good_markets_up_to_the_cap(self):
        inp = RETIREE.with_(spending_rule="guardrails")
        res = simulate(inp, flat(inp, 0.08))
        spend = res.spending_paths[0, inp.working_years:]
        self.assertGreater(spend.max(), 60_000)
        self.assertLessEqual(spend.max(), GUARDRAIL_MAX * 60_000 + 1e-6)

    def test_first_year_is_the_goal(self):
        inp = RETIREE.with_(spending_rule="guardrails")
        res = simulate(inp, flat(inp, -0.2))
        self.assertAlmostEqual(res.spending_paths[0, inp.working_years], 60_000)


class TestRetirementShock(unittest.TestCase):
    def test_shock_overrides_first_retirement_years(self):
        inp = RETIREE.with_(retirement_shock=(-0.25, -0.10))
        res = simulate(inp, flat(inp, 0.04))
        R = inp.working_years
        np.testing.assert_allclose(res.annual_returns[0, R:R + 3], [-0.25, -0.10, 0.04])

    def test_shock_lowers_success(self):
        base = PlanInputs(n_sims=2_000, retirement_spending=70_000)
        hit = simulate(base.with_(retirement_shock=(-0.25, -0.10))).success_probability
        self.assertLess(hit, simulate(base).success_probability)

    def test_caller_returns_are_not_modified(self):
        inp = RETIREE.with_(retirement_shock=(-0.5,))
        returns = flat(inp, 0.02)
        simulate(inp, returns)
        self.assertTrue(np.all(returns == 0.02))

    def test_invalid_rule_rejected(self):
        with self.assertRaises(ValueError):
            PlanInputs(spending_rule="yolo")
        with self.assertRaises(ValueError):
            PlanInputs(retirement_shock=(-1.5,))


if __name__ == "__main__":
    unittest.main()
