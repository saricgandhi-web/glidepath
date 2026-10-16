import unittest

import numpy as np

from planner import assumptions as A
from planner.fees import deterministic_balance
from planner.model import (
    PlanInputs,
    glide_path,
    lognormal_params,
    retirement_spending,
    simulate,
    simulate_returns,
    social_security_path,
)


def constant_returns(inputs: PlanInputs, r: float, n: int = 1) -> np.ndarray:
    return np.full((n, inputs.years), r)


class TestLognormalCalibration(unittest.TestCase):
    def test_median_and_volatility_match_targets(self):
        mu, sd = lognormal_params(0.067, 0.164)
        rng = np.random.default_rng(0)
        sample = np.exp(mu + sd * rng.standard_normal(1_000_000)) - 1.0
        self.assertAlmostEqual(float(np.median(sample)), 0.067, places=3)
        self.assertAlmostEqual(float(sample.std()), 0.164, places=3)

    def test_zero_volatility_is_deterministic(self):
        mu, sd = lognormal_params(0.05, 0.0)
        self.assertAlmostEqual(np.exp(mu), 1.05)
        self.assertEqual(sd, 0.0)


class TestAccumulation(unittest.TestCase):
    def test_matches_closed_form_annuity(self):
        inp = PlanInputs(current_age=30, retirement_age=60, current_savings=10_000, annual_income=100_000,
                         real_income_growth=0.0, savings_rate=0.15, retirement_spending=0.0, social_security=0.0)
        res = simulate(inp, constant_returns(inp, 0.04))
        expected = deterministic_balance(10_000, 15_000, 30, 0.04, 0.0)
        self.assertAlmostEqual(res.balances[0, inp.working_years], expected, places=4)

    def test_income_growth_raises_contributions(self):
        inp = PlanInputs(real_income_growth=0.02, retirement_spending=0.0, social_security=0.0)
        res = simulate(inp, constant_returns(inp, 0.0))
        self.assertAlmostEqual(res.contributions[1] / res.contributions[0], 1.02)
        self.assertTrue(np.all(res.contributions[inp.working_years:] == 0))


class TestDecumulation(unittest.TestCase):
    def setUp(self):
        self.base = PlanInputs(current_age=64, retirement_age=65, plan_to_age=95, annual_income=1.0,
                               savings_rate=0.0, social_security=0.0, retirement_spending=40_000)

    def test_exactly_enough_money_succeeds(self):
        inp = self.base.with_(current_savings=40_000 * 30)
        res = simulate(inp, constant_returns(inp, 0.0))
        self.assertTrue(res.success[0])
        self.assertAlmostEqual(res.balances[0, -1], 0.0, places=6)

    def test_running_out_records_depletion_age(self):
        inp = self.base.with_(current_savings=40_000 * 10)
        res = simulate(inp, constant_returns(inp, 0.0))
        self.assertFalse(res.success[0])
        self.assertEqual(res.depletion_age[0], 75)  # funded ages 65-74, short at 75
        self.assertAlmostEqual(res.funded_ratio[0], 10 / 30)

    def test_social_security_reduces_withdrawals(self):
        inp = self.base.with_(social_security=25_000, ss_claim_age=67)
        need = simulate(inp, constant_returns(inp, 0.0)).withdrawals_needed
        self.assertEqual(need[1], 40_000)   # age 65: before claiming
        self.assertEqual(need[3], 15_000)   # age 67: benefit started


class TestSocialSecurityHaircut(unittest.TestCase):
    def test_haircut_applies_from_depletion_year(self):
        cfg = A.social_security()
        inp = PlanInputs(current_age=64, retirement_age=65, social_security=30_000, ss_claim_age=65,
                         ss_haircut=True, start_year=2026)
        ss = social_security_path(inp)
        idx = cfg["combined_trust_fund_depletion_year"] - 2026
        self.assertEqual(ss[idx - 1], 30_000)
        self.assertAlmostEqual(ss[idx], 30_000 * cfg["payable_ratio_at_depletion"])


class TestPortfolio(unittest.TestCase):
    def test_glide_path_endpoints(self):
        inp = PlanInputs(current_age=25, retirement_age=65, equity_now=0.9, equity_at_retirement=0.4)
        w = glide_path(inp)
        self.assertAlmostEqual(w[0], 0.9)
        self.assertAlmostEqual(w[inp.working_years], 0.4)
        self.assertAlmostEqual(w[-1], 0.4)
        self.assertTrue(np.all(np.diff(w) <= 1e-12))

    def test_fees_lower_returns_one_for_one(self):
        inp = PlanInputs(n_sims=500)
        cheap = simulate_returns(inp.with_(fund_fee=0.0, advisory_fee=0.0))
        pricey = simulate_returns(inp.with_(fund_fee=0.0, advisory_fee=0.01))
        np.testing.assert_allclose((1 + pricey), (1 + cheap) * 0.99, rtol=1e-12)

    def test_same_seed_same_answer(self):
        a = simulate(PlanInputs(n_sims=1_000)).success_probability
        b = simulate(PlanInputs(n_sims=1_000)).success_probability
        self.assertEqual(a, b)

    def test_more_saving_never_hurts(self):
        probs = [simulate(PlanInputs(savings_rate=r, n_sims=2_000, retirement_spending=70_000)).success_probability
                 for r in (0.05, 0.10, 0.15, 0.20)]
        self.assertEqual(probs, sorted(probs))

    def test_conservative_assumptions_are_worse(self):
        base = simulate(PlanInputs(n_sims=2_000)).at_retirement()
        cons = simulate(PlanInputs(n_sims=2_000, market="vanguard_2026")).at_retirement()
        self.assertLess(cons, base)


class TestInputs(unittest.TestCase):
    def test_default_spending_uses_replacement_ratio(self):
        inp = PlanInputs(current_age=30, retirement_age=31, annual_income=100_000, replacement_ratio=0.8)
        self.assertAlmostEqual(retirement_spending(inp), 80_000)

    def test_invalid_ages_rejected(self):
        with self.assertRaises(ValueError):
            PlanInputs(current_age=70, retirement_age=65)
        with self.assertRaises(ValueError):
            PlanInputs(ss_claim_age=61)
        with self.assertRaises(ValueError):
            PlanInputs(savings_rate=1.5)


if __name__ == "__main__":
    unittest.main()
