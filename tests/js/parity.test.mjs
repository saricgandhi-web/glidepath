// Parity tests: the browser engine must reproduce the Python engine.
// Run with:  node --test tests/js/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  atRetirement, claimingAdjustment, estimateAnnualBenefit, makeInputs, maxSustainableSpending,
  requiredSavingsRate, simulate,
} from "../../web/engine.js";

const A = JSON.parse(readFileSync(new URL("../../planner/data/assumptions.json", import.meta.url)));
const F = JSON.parse(readFileSync(new URL("../fixtures/parity.json", import.meta.url)));

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

for (const c of F.exact) {
  test(`exact parity: ${c.name}`, () => {
    const inp = makeInputs(c.inputs);
    const returns = c.returns.map((r) => Float64Array.from(r));
    const res = simulate(inp, A, returns);
    const e = c.expected;
    close(res.spending, e.spending, 1e-6, "spending");
    e.contributions.forEach((x, t) => close(res.contributions[t], x, 1e-6, `contribution ${t}`));
    e.social_security.forEach((x, t) => close(res.socialSecurity[t], x, 1e-6, `social security ${t}`));
    e.equity_weights.forEach((x, t) => close(res.equityWeights[t], x, 1e-9, `equity weight ${t}`));
    e.balances_by_sim.forEach((path, i) =>
      path.forEach((x, t) => close(res.balances[t][i], x, Math.max(1e-6, Math.abs(x) * 1e-9), `balance sim ${i} year ${t}`)));
    assert.deepEqual(Array.from(res.success), e.success);
    e.depletion_age.forEach((x, i) =>
      x === null ? assert.ok(Number.isNaN(res.depletionAge[i])) : assert.equal(res.depletionAge[i], x));
    e.funded_ratio.forEach((x, i) => close(res.funded[i], x, 1e-9, `funded ratio ${i}`));
  });
}

test("Social Security estimates match Python", () => {
  for (const c of F.social_security) close(estimateAnnualBenefit(makeInputs(c.inputs), A), c.expected, 1e-6, "benefit");
  close(claimingAdjustment(62), 0.70, 1e-12, "claim at 62");
  close(claimingAdjustment(70), 1.24, 1e-12, "claim at 70");
});

for (const c of F.stochastic) {
  test(`statistical parity: ${c.name}`, () => {
    const res = simulate(makeInputs({ ...c.inputs, seed: 7 }), A);
    // Two independent 20k-path estimates: standard error of the difference is < 0.5 pts.
    close(res.successProbability, c.success_probability, 0.02, "success probability");
    close(atRetirement(res, 50) / c.median_at_retirement, 1, 0.02, "median wealth at retirement (ratio)");
  });
}

test("solvers hit their target", () => {
  const inp = makeInputs({ current_age: 30, current_savings: 50000, annual_income: 100000, savings_rate: 0.08,
    retirement_spending: 75000, n_sims: 2000 });
  const rate = requiredSavingsRate(inp, A, 0.85);
  assert.ok(simulate({ ...inp, savings_rate: rate }, A).successProbability >= 0.85);
  assert.ok(simulate({ ...inp, savings_rate: rate - 0.005 }, A).successProbability < 0.85);
  const spend = maxSustainableSpending(inp, A, 0.85);
  assert.ok(simulate({ ...inp, retirement_spending: spend }, A).successProbability >= 0.85);
});

test("invalid inputs are rejected", () => {
  assert.throws(() => makeInputs({ current_age: 70, retirement_age: 65 }), RangeError);
  assert.throws(() => makeInputs({ savings_rate: 2 }), RangeError);
});
