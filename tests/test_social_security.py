import unittest

from planner import assumptions as A
from planner.social_security import (
    claiming_adjustment,
    earnings_record,
    estimate_annual_benefit,
    primary_insurance_amount,
)


class TestPIAFormula(unittest.TestCase):
    def setUp(self):
        cfg = A.social_security()
        self.b1, self.b2 = cfg["bend_point_1"], cfg["bend_point_2"]

    def test_first_bend_point(self):
        self.assertAlmostEqual(primary_insurance_amount(self.b1), 0.9 * self.b1)

    def test_second_bend_point(self):
        expected = 0.9 * self.b1 + 0.32 * (self.b2 - self.b1)
        self.assertAlmostEqual(primary_insurance_amount(self.b2), expected)

    def test_above_second_bend_point(self):
        expected = 0.9 * self.b1 + 0.32 * (self.b2 - self.b1) + 0.15 * 1_000
        self.assertAlmostEqual(primary_insurance_amount(self.b2 + 1_000), expected)


class TestClaimingAge(unittest.TestCase):
    def test_ssa_reduction_and_credit_schedule(self):
        self.assertAlmostEqual(claiming_adjustment(62), 0.70)        # 60 months early
        self.assertAlmostEqual(claiming_adjustment(65), 1 - 24 * 5 / 9 / 100)
        self.assertAlmostEqual(claiming_adjustment(67), 1.00)
        self.assertAlmostEqual(claiming_adjustment(70), 1.24)        # 8%/yr delayed credits


class TestEstimate(unittest.TestCase):
    def test_earnings_capped_at_taxable_maximum(self):
        cap = A.social_security()["taxable_maximum"]
        rich = estimate_annual_benefit(40, 65, cap * 3, 0.0)
        at_cap = estimate_annual_benefit(40, 65, cap, 0.0)
        self.assertAlmostEqual(rich, at_cap)

    def test_short_career_counts_zero_years(self):
        full = estimate_annual_benefit(22, 57, 60_000, 0.0)   # 35 years
        short = estimate_annual_benefit(22, 40, 60_000, 0.0)  # 18 years
        self.assertLess(short, full)

    def test_backcast_starts_at_22(self):
        record = earnings_record(30, 65, 100_000, 0.02)
        self.assertEqual(len(record), 65 - 22)
        self.assertAlmostEqual(record[8], 100_000)  # age 30


if __name__ == "__main__":
    unittest.main()
