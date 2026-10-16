import unittest

from planner.fees import compare_fee_profiles, deterministic_balance, share_of_wealth_lost
from planner.model import PlanInputs, simulate
from planner.report import build_plan
from planner.solvers import earliest_retirement_age, max_sustainable_spending, required_savings_rate

TARGET = 0.85
CLIENT = PlanInputs(current_age=30, current_savings=50_000, annual_income=100_000, savings_rate=0.08,
                    retirement_spending=75_000, n_sims=2_000)


class TestSolvers(unittest.TestCase):
    def test_required_savings_rate_hits_target(self):
        rate = required_savings_rate(CLIENT, TARGET)
        self.assertIsNotNone(rate)
        self.assertGreaterEqual(simulate(CLIENT.with_(savings_rate=rate)).success_probability, TARGET)
        self.assertLess(simulate(CLIENT.with_(savings_rate=rate - 0.005)).success_probability, TARGET)

    def test_impossible_goal_returns_none(self):
        hopeless = CLIENT.with_(retirement_spending=2_000_000)
        self.assertIsNone(required_savings_rate(hopeless, TARGET))

    def test_max_spending_hits_target(self):
        spend = max_sustainable_spending(CLIENT, TARGET)
        self.assertGreaterEqual(simulate(CLIENT.with_(retirement_spending=spend)).success_probability, TARGET)
        self.assertLess(simulate(CLIENT.with_(retirement_spending=spend + 1_000)).success_probability, TARGET)

    def test_earliest_retirement_age(self):
        age = earliest_retirement_age(CLIENT, TARGET)
        self.assertIsNotNone(age)
        self.assertGreaterEqual(simulate(CLIENT.with_(retirement_age=age)).success_probability, TARGET)
        self.assertLess(simulate(CLIENT.with_(retirement_age=age - 1)).success_probability, TARGET)


class TestFees(unittest.TestCase):
    def test_deterministic_balance_matches_annuity_due(self):
        r, n, c = 0.05, 40, 1.0
        closed_form = c * (1 + r) * ((1 + r) ** n - 1) / r
        self.assertAlmostEqual(deterministic_balance(0.0, c, n, r, 0.0), closed_form, places=8)

    def test_one_percent_fee_over_forty_years(self):
        lost = share_of_wealth_lost(40, 0.01, annual_return=0.05)
        self.assertGreater(lost, 0.15)
        self.assertLess(lost, 0.25)

    def test_cheaper_is_wealthier(self):
        rows = compare_fee_profiles(CLIENT)
        wealth = [r.median_at_retirement for r in rows]
        self.assertEqual(wealth, sorted(wealth, reverse=True))
        self.assertEqual(rows[0].cost_vs_lowest, 0.0)


class TestReport(unittest.TestCase):
    def test_plan_has_recommendations(self):
        plan = build_plan(CLIENT.with_(advisory_fee=0.01, fund_fee=0.0065))
        titles = [r.title for r in plan["recommendations"]]
        self.assertIn("Audit your fees", titles)
        self.assertTrue(all(r.impact in {"high", "medium", "low"} for r in plan["recommendations"]))


if __name__ == "__main__":
    unittest.main()
