// Glidepath: JavaScript port of the Python engine (planner/).
// Same model, same assumptions file, verified against Python output by
// tests/js/parity.test.mjs. Runs entirely in the browser; nothing leaves the page.

export const DEFAULTS = Object.freeze({
  current_age: 22,
  retirement_age: 65,
  plan_to_age: 95,
  current_savings: 0,
  annual_income: 80000,
  real_income_growth: 0.01,
  savings_rate: 0.10,
  retirement_spending: null, // null -> replacement_ratio x final income
  replacement_ratio: 0.70,
  social_security: null,     // null -> estimate with the SSA formula
  ss_claim_age: 67,
  ss_haircut: false,
  equity_now: 0.90,
  equity_at_retirement: 0.50,
  advisory_fee: 0.0,
  fund_fee: 0.0005,
  market: "jpm_2026",
  correlation: null,
  n_sims: 5000,
  seed: 2026,
  start_year: 2026,
});

export function makeInputs(overrides = {}) {
  const inp = { ...DEFAULTS, ...overrides };
  if (!(inp.current_age >= 18 && inp.current_age < inp.retirement_age && inp.retirement_age <= inp.plan_to_age - 1)) {
    throw new RangeError("Ages must satisfy 18 <= current < retirement < plan-to age.");
  }
  if (!(inp.ss_claim_age >= 62 && inp.ss_claim_age <= 70)) {
    throw new RangeError("Social Security claim age must be between 62 and 70.");
  }
  for (const k of ["equity_now", "equity_at_retirement", "savings_rate", "replacement_ratio"]) {
    if (!(inp[k] >= 0 && inp[k] <= 1)) throw new RangeError(`${k} must be between 0 and 1.`);
  }
  return inp;
}

const years = (inp) => inp.plan_to_age - inp.current_age;
const workingYears = (inp) => inp.retirement_age - inp.current_age;
const totalFee = (inp) => inp.advisory_fee + inp.fund_fee;

// ---------- random numbers ----------

// mulberry32: small, fast, seedable PRNG.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSource(seed) {
  const rand = mulberry32(seed);
  let spare = null;
  return function () {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

// ---------- building blocks (mirror planner/model.py) ----------

export function lognormalParams(compoundReturn, vol) {
  const g = 1 + compoundReturn;
  const u = (1 + Math.sqrt(1 + (4 * vol * vol) / (g * g))) / 2;
  return [Math.log(g), Math.sqrt(Math.log(u))];
}

export function glidePath(inp) {
  const T = years(inp), W = workingYears(inp);
  const out = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const frac = Math.min(Math.max(t / W, 0), 1);
    out[t] = inp.equity_now + (inp.equity_at_retirement - inp.equity_now) * frac;
  }
  return out;
}

export function incomePath(inp) {
  const T = years(inp), W = workingYears(inp);
  const out = new Float64Array(T);
  for (let t = 0; t < T; t++) out[t] = t < W ? inp.annual_income * (1 + inp.real_income_growth) ** t : 0;
  return out;
}

export function retirementSpending(inp) {
  if (inp.retirement_spending !== null && inp.retirement_spending !== undefined) return Number(inp.retirement_spending);
  const finalIncome = inp.annual_income * (1 + inp.real_income_growth) ** Math.max(workingYears(inp) - 1, 0);
  return inp.replacement_ratio * finalIncome;
}

// ---------- Social Security (mirror planner/social_security.py) ----------

export function primaryInsuranceAmount(aime, ss) {
  const b1 = ss.bend_point_1, b2 = ss.bend_point_2;
  return 0.9 * Math.min(aime, b1) + 0.32 * Math.max(Math.min(aime, b2) - b1, 0) + 0.15 * Math.max(aime - b2, 0);
}

export function claimingAdjustment(claimAge, fra = 67) {
  const months = (claimAge - fra) * 12;
  if (months < 0) {
    const early = -months;
    return 1 - (Math.min(early, 36) * (5 / 9)) / 100 - (Math.max(early - 36, 0) * (5 / 12)) / 100;
  }
  return 1 + 0.08 * Math.max(Math.min(claimAge, 70) - fra, 0);
}

export function estimateAnnualBenefit(inp, A) {
  const ss = A.social_security;
  const start = Math.min(22, inp.current_age);
  const record = [];
  for (let age = start; age < inp.retirement_age; age++) {
    const e = inp.annual_income * (1 + inp.real_income_growth) ** (age - inp.current_age);
    record.push(Math.min(e, ss.taxable_maximum));
  }
  record.sort((a, b) => b - a);
  const top = record.slice(0, 35).reduce((s, x) => s + x, 0);
  const aime = top / (35 * 12);
  return 12 * primaryInsuranceAmount(aime, ss) * claimingAdjustment(inp.ss_claim_age, ss.full_retirement_age);
}

export function socialSecurityPath(inp, A) {
  const ss = A.social_security;
  const benefit = inp.social_security !== null && inp.social_security !== undefined
    ? Number(inp.social_security)
    : estimateAnnualBenefit(inp, A);
  const T = years(inp);
  const out = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const age = inp.current_age + t;
    let b = age >= inp.ss_claim_age && age >= inp.retirement_age ? benefit : 0;
    if (inp.ss_haircut && inp.start_year + t >= ss.combined_trust_fund_depletion_year) b *= ss.payable_ratio_at_depletion;
    out[t] = b;
  }
  return out;
}

// ---------- returns ----------

// Real, after-fee portfolio returns: array of n_sims Float64Arrays of length years.
export function simulateReturns(inp, A) {
  const m = A.markets[inp.market];
  if (!m) throw new RangeError(`Unknown market assumption set '${inp.market}'.`);
  const rho = inp.correlation === null || inp.correlation === undefined ? m.correlation : inp.correlation;
  const [muE, sdE] = lognormalParams(m.equity_return, m.equity_vol);
  const [muB, sdB] = lognormalParams(m.bond_return, m.bond_vol);
  const w = glidePath(inp);
  const T = years(inp), fee = totalFee(inp), infl = 1 + m.inflation;
  const k = Math.sqrt(1 - rho * rho);
  const z = normalSource(inp.seed);
  const out = new Array(inp.n_sims);
  for (let i = 0; i < inp.n_sims; i++) {
    const row = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      const z1 = z(), z2 = z();
      const eq = Math.exp(muE + sdE * z1) - 1;
      const bd = Math.exp(muB + sdB * (rho * z1 + k * z2)) - 1;
      const nominal = w[t] * eq + (1 - w[t]) * bd;
      row[t] = ((1 + nominal) * (1 - fee)) / infl - 1;
    }
    out[i] = row;
  }
  return out;
}

// ---------- simulation ----------

export function simulate(inp, A, returns = null) {
  const R = returns ?? simulateReturns(inp, A);
  const n = R.length, T = years(inp);
  const income = incomePath(inp);
  const contributions = income.map((x) => inp.savings_rate * x);
  const spend = retirementSpending(inp);
  const ss = socialSecurityPath(inp, A);
  const need = new Float64Array(T);
  for (let t = 0; t < T; t++) need[t] = inp.current_age + t >= inp.retirement_age ? Math.max(spend - ss[t], 0) : 0;
  const totalNeed = need.reduce((s, x) => s + x, 0);

  // balances[t] holds the start-of-year balance of every path at year t.
  const balances = Array.from({ length: T + 1 }, () => new Float64Array(n));
  const success = new Uint8Array(n);
  const depletionAge = new Float64Array(n).fill(NaN);
  const funded = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    let bal = inp.current_savings, alive = true, paid = 0;
    balances[0][i] = bal;
    const r = R[i];
    for (let t = 0; t < T; t++) {
      const pre = bal + contributions[t];
      paid += Math.min(Math.max(pre, 0), need[t]);
      if (alive && pre < need[t] - 1e-9) { alive = false; depletionAge[i] = inp.current_age + t; }
      bal = Math.max(pre - need[t], 0) * (1 + r[t]);
      balances[t + 1][i] = bal;
    }
    success[i] = alive ? 1 : 0;
    funded[i] = totalNeed > 0 ? paid / totalNeed : 1;
  }

  let wins = 0;
  for (let i = 0; i < n; i++) wins += success[i];
  return {
    inputs: inp,
    balances, success, depletionAge, funded,
    contributions, spending: spend, socialSecurity: ss, withdrawalsNeeded: need,
    equityWeights: glidePath(inp),
    successProbability: wins / n,
  };
}

// numpy.percentile default ("linear") so both engines agree exactly.
export function percentile(values, p) {
  const a = Float64Array.from(values).sort();
  if (a.length === 0) return NaN;
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

export function percentilePaths(result, pcts = [10, 25, 50, 75, 90]) {
  const out = {};
  for (const p of pcts) out[p] = result.balances.map((col) => percentile(col, p));
  return out;
}

export function atRetirement(result, p = 50) {
  return percentile(result.balances[workingYears(result.inputs)], p);
}

export function sustainedWithdrawalRate(result) {
  const inp = result.inputs;
  const bal = atRetirement(result, 50);
  const idx = Math.min(Math.max(inp.retirement_age, inp.ss_claim_age) - inp.current_age, years(inp) - 1);
  return bal > 0 ? result.withdrawalsNeeded[idx] / bal : Infinity;
}

// ---------- solvers (mirror planner/solvers.py) ----------

function bisect(fn, lo, hi, target, tol, increasing = true, maxIter = 60) {
  for (let i = 0; i < maxIter && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2;
    const ok = fn(mid) >= target;
    if (ok === increasing) hi = mid; else lo = mid;
  }
  return increasing ? hi : lo;
}

export function requiredSavingsRate(inp, A, target = 0.85, maxRate = 0.75) {
  const R = simulateReturns(inp, A);
  const base = { ...inp, retirement_spending: retirementSpending(inp) };
  const prob = (rate) => simulate({ ...base, savings_rate: rate }, A, R).successProbability;
  if (prob(0) >= target) return 0;
  if (prob(maxRate) < target) return null;
  return bisect(prob, 0, maxRate, target, 0.0005, true);
}

export function maxSustainableSpending(inp, A, target = 0.85) {
  const R = simulateReturns(inp, A);
  const prob = (s) => simulate({ ...inp, retirement_spending: s }, A, R).successProbability;
  let hi = Math.max(retirementSpending(inp), 10000);
  while (prob(hi) >= target && hi < 1e8) hi *= 2;
  return bisect(prob, 0, hi, target, 50, false);
}

// Walks outward from the planned age (same algorithm as Python).
export function earliestRetirementAge(inp, A, target = 0.85, maxAge = 75) {
  const base = { ...inp, retirement_spending: retirementSpending(inp) };
  const upper = Math.min(maxAge, inp.plan_to_age - 1);
  const works = (age) => simulate({ ...base, retirement_age: age }, A).successProbability >= target;
  let age = inp.retirement_age;
  if (works(age)) {
    while (age - 1 > inp.current_age && works(age - 1)) age -= 1;
    return age;
  }
  for (age = inp.retirement_age + 1; age <= upper; age++) if (works(age)) return age;
  return null;
}

// ---------- plan + recommendations (mirror planner/report.py) ----------

const money = (x) => "$" + Math.round(x).toLocaleString("en-US");
const pct = (x, d = 0) => (100 * x).toFixed(d) + "%";

export function buildPlan(inp, A, target = A.benchmarks.target_success_probability) {
  const result = simulate(inp, A);
  const p = result.successProbability;
  const rate = requiredSavingsRate(inp, A, target);
  const spend = maxSustainableSpending(inp, A, target);
  const age = earliestRetirementAge(inp, A, target);
  const fees = compareFeeProfiles(inp, A);
  const recs = [];

  if (p < target) {
    if (rate !== null) recs.push({ title: "Raise your savings rate", impact: "high",
      detail: `Saving ${pct(rate, 1)} of income (vs ${pct(inp.savings_rate, 1)} today) lifts the plan to ${pct(target)} confidence.` });
    recs.push({ title: "Or right-size the spending goal", impact: "high",
      detail: `At today's savings rate, ${money(Math.floor(spend / 10) * 10)}/yr in retirement is sustainable at ${pct(target)} confidence (goal: ${money(result.spending)}/yr).` });
    if (age !== null && age > inp.retirement_age) recs.push({ title: "Or work a little longer", impact: "medium",
      detail: `Retiring at ${age} instead of ${inp.retirement_age} reaches ${pct(target)} confidence.` });
  } else {
    recs.push({ title: "You're on track", impact: "low",
      detail: `${pct(p)} of simulated markets fully fund your goal. You could spend up to ${money(Math.floor(spend / 10) * 10)}/yr` +
        (age ? `, or retire as early as ${age}.` : ".") });
  }

  const cheapest = fees.reduce((a, b) => (b.totalFee < a.totalFee ? b : a));
  if (totalFee(inp) > cheapest.totalFee + 0.0025) {
    const lost = atRetirement(simulate({ ...inp, advisory_fee: 0, fund_fee: cheapest.totalFee }, A)) - atRetirement(result);
    recs.push({ title: "Audit your fees", impact: lost > 0.15 * atRetirement(result) ? "high" : "medium",
      detail: `An all-in cost of ${pct(totalFee(inp), 2)} reduces median wealth at retirement by about ${money(lost)} compared with ${pct(cheapest.totalFee, 2)} index funds. Make sure the advice is worth it.` });
  }

  const lim = A.contribution_limits_2026;
  const taxAdv = lim.employee_401k + lim.ira;
  const neededRate = rate !== null && p < target ? rate : inp.savings_rate;
  const firstContribution = neededRate * inp.annual_income;
  if (firstContribution > taxAdv) recs.push({ title: "Use accounts beyond your 401(k) and IRA", impact: "medium",
    detail: `Saving ${money(firstContribution)}/yr exceeds the 2026 401(k) + IRA limits of ${money(taxAdv)}. Route the rest to an HSA (if eligible) or a taxable brokerage account.` });

  const wr = sustainedWithdrawalRate(result);
  const swr = A.benchmarks.morningstar_safe_withdrawal_rate;
  const bridge = Math.max(inp.ss_claim_age - inp.retirement_age, 0);
  if (wr > swr) recs.push({ title: "Watch the withdrawal rate", impact: "medium",
    detail: `Once Social Security starts, you draw ${pct(wr, 1)} a year from the median portfolio, above Morningstar's ${pct(swr, 1)} safe starting rate. A flexible spending rule (cut back after bad years) adds a margin of safety.` +
      (bridge ? ` The ${bridge} years before Social Security starts are funded entirely by the portfolio, which adds early sequence-of-returns risk.` : "") });

  if (!inp.ss_haircut) {
    const stressed = simulate({ ...inp, ss_haircut: true }, A).successProbability;
    if (p - stressed >= 0.03) recs.push({ title: "Stress-test Social Security", impact: "medium",
      detail: `If benefits are cut to 83% when the trust funds run out in 2034, success falls from ${pct(p)} to ${pct(stressed)}.` });
  }

  const order = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => order[a.impact] - order[b.impact]);
  return { result, target, requiredSavingsRate: rate, maxSpending: spend, earliestRetirementAge: age, fees, recommendations: recs };
}

export function compareFeeProfiles(inp, A, keys = ["diy_index", "robo", "traditional"]) {
  const rows = keys.map((k) => {
    const p = A.fee_profiles[k];
    const res = simulate({ ...inp, advisory_fee: p.advisory_fee, fund_fee: p.fund_fee }, A);
    return {
      key: k, label: p.label, totalFee: p.advisory_fee + p.fund_fee,
      successProbability: res.successProbability,
      medianAtRetirement: atRetirement(res, 50),
    };
  });
  const best = Math.max(...rows.map((r) => r.medianAtRetirement));
  return rows.map((r) => ({ ...r, costVsLowest: best - r.medianAtRetirement }));
}
