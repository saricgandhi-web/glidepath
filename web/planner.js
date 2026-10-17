// The planner page: the plan as a sentence, the answer, and eight views of the same plan
// (overview, stress test, spending rules, Social Security, Plan A vs. Plan B, two Pro views:
// the odds map and the year-by-year plan, and assumptions).
import {
  DEFAULTS, atRetirement, buildPlan, claimingAdjustment, estimateAnnualBenefit, lowSpending,
  makeInputs, medianSpending, percentile, percentilePaths, retirementSpending, shortfallProbability, simulate,
  simulateReturns, spendingPercentiles, sustainedWithdrawalRate,
} from "./engine.js";
import {
  $, A, FEE_NAMES, MINUS, RB, RULE_NAMES, ST, TARGET, animate, compact, drawChart, el, gsap, growBars, hideTip,
  money, nextFrame, parseAge, parseMoney, parsePercent, pct, percentOrNA, pts, scrollToY, statusFor, statusIcon, words,
} from "./ui.js";
import { PRO_FEATURES, isPro, lockPreview, onProChange } from "./pro.js";

export const VIEWS = ["overview", "stress", "spending", "ss", "compare", "map", "years", "assumptions"];
const SLUGS = { overview: "", stress: "stress", spending: "spending", ss: "social-security", compare: "compare",
  map: "odds-map", years: "year-by-year", assumptions: "assumptions" };
const PRO_VIEWS = new Set(["map", "years"]);
export const viewFromSlug = (slug) => VIEWS.find((v) => SLUGS[v] === (slug || "")) || null;
export const hrefFor = (view) => "#/planner" + (SLUGS[view] ? "/" + SLUGS[view] : "");

// =====================================================================================
// State
// =====================================================================================
const state = { ...DEFAULTS };
let spendingExplicit = false;
const current = { inp: null, res: null, plan: null };
let bState = null;          // Plan B, filled on first visit to Compare
let ssShowCut = false;
let spendChartRule = null;  // which rule the spending chart shows
let ready = false;
let activeView = "overview";
const rendered = new Set();
const dirty = new Set(VIEWS);
const inflight = new Map();
let timer = null, runId = 0;

// =====================================================================================
// The sentence
// =====================================================================================
let story = null;
const measurer = el("span", { "aria-hidden": "true", style: "position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0" });
function autosize(input) {
  const cs = getComputedStyle(input);
  measurer.style.font = cs.font;
  measurer.style.letterSpacing = cs.letterSpacing;
  measurer.textContent = input.value || "00";
  input.style.width = Math.ceil(measurer.getBoundingClientRect().width) + 12 + "px";
}
function fillStory() {
  for (const [name, f] of Object.entries(story)) {
    const v = name === "spend" ? retirementSpending(state) : state[f.key];
    if (document.activeElement !== f.el) f.el.value = f.show(v);
    autosize(f.el);
  }
  const note = $("story-note");
  note.textContent = "";
  if (!spendingExplicit) {
    note.append(`Spending defaults to ${pct(state.replacement_ratio)} of your final salary. Type your own number to change it.`);
  } else {
    note.append("Using your spending goal. ");
    const reset = el("button", { type: "button" }, `Reset to ${pct(state.replacement_ratio)} of final salary`);
    reset.addEventListener("click", () => { spendingExplicit = false; state.retirement_spending = null; fillStory(); schedule(0); });
    note.append(reset);
  }
}
function readStory() {
  for (const [name, f] of Object.entries(story)) {
    const v = f.parse(f.el.value);
    const bad = !Number.isFinite(v) || v < 0;
    f.el.setAttribute("aria-invalid", bad ? "true" : "false");
    if (bad) return `Enter a number for ${f.el.getAttribute("aria-label").toLowerCase()}.`;
    if (name === "spend") { if (spendingExplicit) state.retirement_spending = v; }
    else state[f.key] = v;
  }
  if (state.current_age < 18 || state.current_age > 80) return "Current age has to be between 18 and 80.";
  if (state.retirement_age <= state.current_age) return "Retirement age has to be after your current age.";
  if (state.plan_to_age <= state.retirement_age || state.plan_to_age > 110) return "The plan has to run past retirement, up to age 110.";
  if (state.savings_rate > 1) return "Savings rate can't be more than 100% of income.";
  return null;
}
function initStory() {
  story = {
    age: { el: $("f-age"), parse: parseAge, show: (v) => String(v), key: "current_age" },
    savings: { el: $("f-savings"), parse: parseMoney, show: money, key: "current_savings" },
    income: { el: $("f-income"), parse: parseMoney, show: money, key: "annual_income" },
    rate: { el: $("f-rate"), parse: parsePercent, show: (v) => pct(v, 1), key: "savings_rate" },
    retire: { el: $("f-retire"), parse: parseAge, show: (v) => String(v), key: "retirement_age" },
    spend: { el: $("f-spend"), parse: parseMoney, show: money, key: "retirement_spending" },
    planto: { el: $("f-planto"), parse: parseAge, show: (v) => String(v), key: "plan_to_age" },
  };
  document.body.append(measurer);
  story.spend.el.addEventListener("input", () => { spendingExplicit = true; });
  for (const f of Object.values(story)) {
    f.el.addEventListener("input", () => { autosize(f.el); schedule(); });
    f.el.addEventListener("blur", () => {
      const v = f.parse(f.el.value);
      if (Number.isFinite(v)) { f.el.value = f.show(v); autosize(f.el); }
    });
  }
  $("story").addEventListener("submit", (e) => e.preventDefault());
}

// =====================================================================================
// Assumptions view
// =====================================================================================
function initSettings() {
  const claim = $("s-claim");
  for (let a = 62; a <= 70; a++) claim.append(el("option", { value: a }, a === 67 ? "67 (full retirement age)" : String(a)));
  for (const key of Object.keys(A.markets)) {
    const b = el("button", { type: "button", "data-key": key }, key === "jpm_2026" ? "Base case" : "Conservative");
    b.addEventListener("click", () => { state.market = key; syncSettings(); schedule(0); });
    $("s-market").append(b);
  }
  for (const [key, p] of Object.entries(A.fee_profiles)) {
    const b = el("button", { type: "button", "data-key": key }, FEE_NAMES[key] || p.label);
    b.addEventListener("click", () => { state.advisory_fee = p.advisory_fee; state.fund_fee = p.fund_fee; syncSettings(); schedule(0); });
    $("s-fee-presets").append(b);
  }
  for (const [key, name] of Object.entries(RULE_NAMES)) {
    const b = el("button", { type: "button", "data-key": key }, name);
    b.addEventListener("click", () => { state.spending_rule = key; syncSettings(); schedule(0); });
    $("s-rule").append(b);
  }
  $("s-ss").addEventListener("input", () => schedule());
  claim.addEventListener("change", () => { state.ss_claim_age = Number(claim.value); schedule(0); });
  $("s-haircut").addEventListener("change", (e) => { state.ss_haircut = e.target.checked; schedule(0); });
  for (const [id, key, out] of [["s-eq-now", "equity_now", "o-eq-now"], ["s-eq-ret", "equity_at_retirement", "o-eq-ret"]]) {
    $(id).addEventListener("input", (e) => { state[key] = Number(e.target.value) / 100; $(out).textContent = e.target.value + "%"; schedule(); });
  }
  for (const id of ["s-adv", "s-fund", "s-growth", "s-replace"]) $(id).addEventListener("input", () => schedule());
}
function syncSettings() {
  $("s-claim").value = String(state.ss_claim_age);
  $("s-haircut").checked = state.ss_haircut;
  $("s-eq-now").value = Math.round(state.equity_now * 100);
  $("s-eq-ret").value = Math.round(state.equity_at_retirement * 100);
  $("o-eq-now").textContent = Math.round(state.equity_now * 100) + "%";
  $("o-eq-ret").textContent = Math.round(state.equity_at_retirement * 100) + "%";
  for (const b of $("s-market").children) b.setAttribute("aria-pressed", String(b.dataset.key === state.market));
  const m = A.markets[state.market];
  $("s-market-hint").textContent = `${m.label}: stocks ${pct(m.equity_return, 1)}, bonds ${pct(m.bond_return, 1)} a year before inflation.`;
  for (const b of $("s-fee-presets").children) {
    const p = A.fee_profiles[b.dataset.key];
    b.setAttribute("aria-pressed", String(Math.abs(p.advisory_fee - state.advisory_fee) < 1e-9 && Math.abs(p.fund_fee - state.fund_fee) < 1e-9));
  }
  for (const b of $("s-rule").children) b.setAttribute("aria-pressed", String(b.dataset.key === state.spending_rule));
  if (document.activeElement !== $("s-adv")) $("s-adv").value = pct(state.advisory_fee, 2);
  if (document.activeElement !== $("s-fund")) $("s-fund").value = pct(state.fund_fee, 2);
  if (document.activeElement !== $("s-growth")) $("s-growth").value = pct(state.real_income_growth, 1);
  if (document.activeElement !== $("s-replace")) $("s-replace").value = pct(state.replacement_ratio);
}
function readSettings() {
  const ssRaw = $("s-ss").value.trim();
  if (ssRaw === "") state.social_security = null;
  else {
    const v = parseMoney(ssRaw);
    if (!Number.isFinite(v) || v < 0) return "Enter Social Security as a yearly dollar amount, or leave it blank to use the estimate.";
    state.social_security = v;
  }
  const fields = [["s-adv", "advisory_fee", 0, 0.05, "Advisory fee"], ["s-fund", "fund_fee", 0, 0.03, "Fund expense ratio"],
    ["s-growth", "real_income_growth", -0.05, 0.08, "Raises above inflation"], ["s-replace", "replacement_ratio", 0, 1, "Default spending goal"]];
  for (const [id, key, lo, hi, label] of fields) {
    const v = parsePercent($(id).value);
    $(id).setAttribute("aria-invalid", "false");
    if (!Number.isFinite(v) || v < lo || v > hi) {
      $(id).setAttribute("aria-invalid", "true");
      return `${label} has to be between ${pct(lo)} and ${pct(hi)} (Assumptions view).`;
    }
    state[key] = v;
  }
  return null;
}

// =====================================================================================
// The answer (header card) and the sidebar summary
// =====================================================================================
let heroFirst = true;
let answerCounter = null, sideCounter = null;
function renderAnswer(res) {
  const p = res.successProbability;
  const value = Math.round(p * 100);
  if (!answerCounter && RB.counter) answerCounter = RB.counter($("answer-figure"), { value: 0, label: (v) => `${v} percent` });
  if (!sideCounter && RB.counter) sideCounter = RB.counter($("side-odds"), { value: 0, format: (v) => `${v}%`, label: (v) => `${v} percent` });
  if (answerCounter) answerCounter.set(value, { instant: !animate });
  else $("answer-figure").textContent = String(value);
  if (sideCounter) sideCounter.set(value, { instant: !animate });
  else $("side-odds").textContent = value + "%";
  $("answer-text").textContent = `of simulated markets pay for every year of planned spending through age ${state.plan_to_age}.`;
  const st = statusFor(p);
  const status = $("status");
  status.textContent = "";
  status.append(statusIcon(st.icon, st.color), el("span", { class: "status-label" }, st.label),
    el("span", { class: "status-detail" }, `Median at retirement: ${words(atRetirement(res, 50))}. In a bad market: ${words(atRetirement(res, 10))}.`));
  $("side-label").textContent = st.label;
  $("side-label").style.setProperty("--status", st.color);
  for (const fill of [$("meter-fill"), $("side-fill")]) {
    fill.style.background = st.color;
    if (animate) gsap.to(fill, { width: Math.max(p * 100, 0.5) + "%", duration: heroFirst ? 1.4 : 0.6, ease: "power3.out", delay: heroFirst ? 0.3 : 0 });
    else fill.style.width = Math.max(p * 100, 0.5) + "%";
  }
  $("meter-target").style.left = TARGET * 100 + "%";
  $("side-target").style.left = TARGET * 100 + "%";
  const badge = $("rule-badge");
  if (state.spending_rule !== "fixed") {
    badge.hidden = false;
    badge.textContent = "";
    badge.append("Spending rule: ", el("strong", {}, RULE_NAMES[state.spending_rule]), ". ");
    badge.append(el("a", { href: hrefFor("spending") }, "Compare rules"));
  } else badge.hidden = true;
  heroFirst = false;
}

// =====================================================================================
// Overview
// =====================================================================================
function renderFan(res, animateIn) {
  const paths = percentilePaths(res);
  const ages = res.balances.map((_, t) => state.current_age + t);
  const ri = state.retirement_age - state.current_age;
  drawChart($("fan-chart"), {
    x: ages, xLabel: "Age", animate: animateIn, startIndex: ri,
    bands: [{ lo: paths[10], hi: paths[90], fill: "var(--green-wash)" }, { lo: paths[25], hi: paths[75], fill: "var(--green-wash-2)" }],
    lines: [{ values: paths[50], stroke: "var(--green)" }],
    vmark: { x: state.retirement_age, label: `Retire at ${state.retirement_age}` },
    ariaLabel: `Projected portfolio by age. Median at retirement ${money(paths[50][ri])}; median at age ${state.plan_to_age} ${money(paths[50].at(-1))}.`,
    tip: (i) => ({ title: `Age ${ages[i]}`, value: money(paths[50][i]), valueLabel: "median",
      rows: [["Middle 50%", `${compact(paths[25][i])} to ${compact(paths[75][i])}`], ["80% range", `${compact(paths[10][i])} to ${compact(paths[90][i])}`]] }),
  });
  const table = $("fan-table");
  table.textContent = "";
  const head = el("tr");
  ["Age", "10th percentile", "25th", "Median", "75th", "90th"].forEach((h) => head.append(el("th", { scope: "col" }, h)));
  const thead = el("thead"); thead.append(head);
  const tbody = el("tbody");
  ages.forEach((age, t) => {
    if (age % 5 !== 0 && age !== state.retirement_age && t !== ages.length - 1) return;
    const tr = el("tr");
    tr.append(el("td", {}, age === state.retirement_age ? `${age} (retire)` : String(age)));
    [10, 25, 50, 75, 90].forEach((p) => tr.append(el("td", {}, money(paths[p][t]))));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  // Key figures beside the chart
  $("kf-median").textContent = words(paths[50][ri]);
  $("kf-bad").textContent = words(paths[10][ri]);
  $("kf-spend").textContent = money(res.spending);
  $("kf-ss").textContent = money(res.socialSecurity[Math.min(Math.max(state.ss_claim_age, state.retirement_age) - state.current_age, res.socialSecurity.length - 1)]);
}

function lever(main, sub, onApply) {
  const li = el("li", { class: onApply ? "lever" : "lever na" });
  const text = el("div");
  text.append(el("div", { class: "lever-main" }, main), el("div", { class: "lever-sub" }, sub));
  li.append(text);
  if (onApply) {
    const b = el("button", { type: "button", class: "button quiet small" }, "Apply");
    b.addEventListener("click", onApply);
    li.append(b);
  }
  return li;
}
function renderLevers(plan) {
  const ul = $("levers");
  ul.textContent = "";
  const above = plan.result.successProbability >= TARGET;
  $("levers-title").textContent = above ? "How much room you have" : `Three ways to reach ${pct(TARGET)} confidence`;
  $("levers-sub").textContent = above ? "You're above the target. Here's how far each lever could move before you'd drop below it."
    : "Each one closes the gap on its own. Apply one to see the new plan.";
  const rate = plan.requiredSavingsRate, spend = plan.maxSpending, age = plan.earliestRetirementAge;
  if (rate === null) ul.append(lever("Saving more won't get there alone", "Even 75% of income falls short. Combine it with another lever."));
  else {
    const r = Math.ceil(rate * 1000) / 1000;
    ul.append(lever(above ? `Save as little as ${pct(r, 1)} of income` : `Save ${pct(r, 1)} of income`,
      `${above ? "down" : "up"} from ${pct(state.savings_rate, 1)}`, () => { state.savings_rate = r; fillStory(); schedule(0); }));
  }
  const s = Math.floor(spend / 10) * 10;
  ul.append(lever(above ? `Spend up to ${money(s)} a year` : `Spend ${money(s)} a year`, `instead of ${money(plan.result.spending)}`,
    () => { spendingExplicit = true; state.retirement_spending = s; fillStory(); schedule(0); }));
  if (age === null) ul.append(lever("Working longer won't get there alone", "Even retiring at 75 falls short."));
  else ul.append(lever(above ? `Retire as early as ${age}` : `Retire at ${age}`, `instead of ${state.retirement_age}`,
    age === state.retirement_age ? null : () => {
      spendingExplicit = true; state.retirement_spending = plan.result.spending; state.retirement_age = age; fillStory(); schedule(0);
    }));
  if (animate) gsap.fromTo(ul.children, { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.5, stagger: 0.07, ease: "power3.out" });
}
function renderFees(plan) {
  const rows = plan.fees;
  const host = $("fees");
  host.textContent = "";
  const max = Math.max(...rows.map((r) => r.medianAtRetirement));
  const bars = [];
  rows.forEach((r) => {
    const row = el("div", { class: "hbar" });
    const label = el("div", { class: "hbar-label" }, FEE_NAMES[r.key] || r.label);
    label.append(el("small", {}, `${pct(r.totalFee, 2)} a year`));
    const track = el("div", { class: "hbar-track" });
    const bar = el("div", { class: "hbar-bar", style: `width: calc((100% - 70px) * ${(r.medianAtRetirement / max).toFixed(4)})`,
      title: `${money(r.medianAtRetirement)} median at retirement` });
    track.append(bar, el("span", { class: "hbar-value" }, compact(r.medianAtRetirement)));
    row.append(label, track, el("div", { class: "hbar-meta" }, `${pct(r.successProbability)} chance of success`));
    host.append(row);
    bars.push(bar);
  });
  growBars(bars);
  const lo = rows[0], hi = rows[rows.length - 1];
  $("fee-note").textContent = `Paying ${pct(hi.totalFee, 2)} a year instead of ${pct(lo.totalFee, 2)} costs this plan about ${words(hi.costVsLowest)} at retirement and moves the chance of success from ${pct(lo.successProbability)} to ${pct(hi.successProbability)}.`;
}
function renderPlanList(plan) {
  const ol = $("plan-list");
  ol.textContent = "";
  const labels = { high: "High impact", medium: "Medium impact", low: "Worth knowing" };
  const levers = new Set(["Raise your savings rate", "Or right-size the spending goal", "Or work a little longer"]);
  const recs = plan.recommendations.filter((r) => !levers.has(r.title));
  if (!recs.length) ol.append(el("li", { class: "plan-item" }, "Nothing else stands out. Fees, withdrawal rate and Social Security risk all look reasonable for this plan."));
  for (const r of recs) {
    const li = el("li", { class: "plan-item" });
    const body = el("div");
    body.append(el("h3", {}, r.title), el("p", {}, r.detail));
    li.append(el("div", { class: `impact ${r.impact}` }, labels[r.impact]), body);
    ol.append(li);
  }
}
async function renderOverview(id, firstTime) {
  renderFan(current.res, firstTime);
  await nextFrame();
  if (id !== runId) return false;
  const plan = buildPlan(current.inp, A, TARGET);
  if (id !== runId) return false;
  current.plan = plan;
  renderLevers(plan);
  renderFees(plan);
  renderPlanList(plan);
  return true;
}

// =====================================================================================
// Stress test
// =====================================================================================
export function stressScenarios(inp) {
  return [
    { key: "crash", name: "A crash right after you retire", desc: `Returns of ${MINUS}25% and then ${MINUS}10% in your first two retirement years.`, mod: { retirement_shock: [-0.25, -0.10] } },
    { key: "weak", name: "Weaker markets for good", desc: "Vanguard's cautious forecast: stocks 5.2% and bonds 4.3% a year before inflation.", mod: { market: "vanguard_2026" },
      note: inp.market === "vanguard_2026" ? "You're already using this outlook." : null },
    { key: "ss", name: "Social Security is cut in 2034", desc: "Benefits drop to 83%, the share the 2026 Trustees Report projects as payable.", mod: { ss_haircut: true },
      note: inp.ss_haircut ? "Already included in your plan." : null },
    { key: "long", name: "You live to 100", desc: `Five more years of spending than planned (to ${Math.max(100, inp.plan_to_age + 5)}).`, mod: { plan_to_age: Math.max(100, inp.plan_to_age + 5) } },
    { key: "early", name: "You stop working 3 years early", desc: "A layoff or health issue ends your career sooner, with the same spending goal.",
      mod: inp.retirement_age - 3 > inp.current_age ? { retirement_age: inp.retirement_age - 3, retirement_spending: retirementSpending(inp) } : null },
    { key: "fees", name: "You pay 1% more in fees", desc: "For example, hiring an advisor who charges 1% of assets.", mod: { advisory_fee: inp.advisory_fee + 0.01 } },
    { key: "storm", name: "All three market risks at once", desc: "The crash, weaker markets and the Social Security cut together.",
      mod: { retirement_shock: [-0.25, -0.10], market: "vanguard_2026", ss_haircut: true } },
  ];
}
async function renderStress(id, firstTime) {
  const inp = current.inp, base = current.res;
  const host = $("stress-list");
  const results = [];
  for (const sc of stressScenarios(inp)) {
    await nextFrame();
    if (id !== runId) return false;
    if (!sc.mod) { results.push({ ...sc, p: null }); continue; }
    const res = simulate(makeInputs({ ...inp, ...sc.mod }), A);
    results.push({ ...sc, p: res.successProbability, res });
  }
  host.textContent = "";
  const fills = [];
  const addRow = (sc, p, isBase) => {
    const delta = isBase ? 0 : p - base.successProbability;
    const row = el("div", { class: `stress-row${isBase ? " base" : ""}${!isBase && delta < -0.02 ? " worse" : ""}` });
    const text = el("div");
    text.append(el("h3", {}, sc.name), el("p", {}, sc.note || sc.desc));
    const track = el("div", { class: "stress-track", role: "img", "aria-label": p === null ? "Not applicable" : `${pct(p)} chance of success` });
    if (p !== null) {
      const fill = el("div", { class: "stress-fill", style: `width:${Math.max(p * 100, 0.6)}%` });
      track.append(fill, el("div", { class: "stress-mark", style: `left:${base.successProbability * 100}%`, title: "Your plan" }));
      fills.push(fill);
    }
    const val = el("div", { class: "stress-value" });
    val.append(el("strong", {}, p === null ? "n/a" : pct(p)), el("span", {}, isBase ? "chance of success" : p === null ? "can't retire earlier" : pts(delta)));
    row.append(text, track, val);
    host.append(row);
  };
  addRow({ name: "Your plan as entered", desc: "The baseline every scenario is compared against. The dark tick marks it on each bar." }, base.successProbability, true);
  results.forEach((r) => addRow(r, r.p, false));
  growBars(fills);
  const valid = results.filter((r) => r.p !== null && r.key !== "storm");
  const worst = valid.reduce((a, b) => (b.p < a.p ? b : a), valid[0]);
  $("stress-lead").textContent = worst
    ? `Seven things that go wrong for real retirees, applied to your plan one at a time. The biggest single risk for you: ${worst.name.toLowerCase()} (${pts(worst.p - base.successProbability)}).`
    : "Seven things that go wrong for real retirees, applied to your plan one at a time.";
  const crash = results.find((r) => r.key === "crash");
  const ages = base.balances.map((_, t) => state.current_age + t);
  const a50 = percentilePaths(base, [50])[50], c50 = percentilePaths(crash.res, [50])[50];
  drawChart($("seq-chart"), {
    x: ages, xLabel: "Age", animate: firstTime, startIndex: state.retirement_age - state.current_age + 5,
    lines: [{ values: c50, stroke: "var(--brass)" }, { values: a50, stroke: "var(--green)" }], dotIndex: 1,
    vmark: { x: state.retirement_age, label: `Retire at ${state.retirement_age}` },
    tip: (i) => ({ title: `Age ${ages[i]}`, rows: [["Your plan", money(a50[i])], ["With the crash", money(c50[i])], ["Difference", money(c50[i] - a50[i])]] }),
  });
  return true;
}

// =====================================================================================
// Spending rules
// =====================================================================================
const ruleCache = { results: {} };
async function renderSpending(id, firstTime) {
  const inp = current.inp;
  const results = {};
  for (const rule of Object.keys(RULE_NAMES)) {
    await nextFrame();
    if (id !== runId) return false;
    results[rule] = rule === inp.spending_rule ? current.res : simulate(makeInputs({ ...inp, spending_rule: rule }), A);
  }
  ruleCache.results = results;
  const tbody = $("rules-table").querySelector("tbody");
  tbody.textContent = "";
  for (const [rule, res] of Object.entries(results)) {
    const tr = el("tr", { class: rule === inp.spending_rule ? "current" : "" });
    tr.append(el("td", {}, RULE_NAMES[rule]),
      el("td", { class: "num" }, pct(res.successProbability)),
      el("td", { class: "num" }, money(Math.round(medianSpending(res) / 100) * 100)),
      el("td", { class: "num" }, money(Math.round(lowSpending(res) / 100) * 100)),
      el("td", { class: "num" }, pct(shortfallProbability(res))));
    const act = el("td");
    if (rule !== inp.spending_rule) {
      const b = el("button", { type: "button", class: "button quiet small" }, "Use this rule");
      b.addEventListener("click", () => { state.spending_rule = rule; syncSettings(); schedule(0); });
      act.append(b);
    }
    tr.append(act);
    tbody.append(tr);
  }
  if (animate && firstTime) gsap.fromTo(tbody.children, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.08, ease: "power3.out" });
  const pick = $("spend-rule-pick");
  if (!pick.children.length) {
    for (const [rule, name] of Object.entries(RULE_NAMES)) {
      const b = el("button", { type: "button", "data-key": rule }, name);
      b.addEventListener("click", () => { spendChartRule = rule; drawSpendChart(true); });
      pick.append(b);
    }
  }
  if (!spendChartRule) spendChartRule = inp.spending_rule === "fixed" ? "guardrails" : inp.spending_rule;
  drawSpendChart(firstTime);
  return true;
}
function drawSpendChart(animateIn) {
  const res = ruleCache.results[spendChartRule];
  if (!res) return;
  for (const b of $("spend-rule-pick").children) b.setAttribute("aria-pressed", String(b.dataset.key === spendChartRule));
  $("spend-chart-title").textContent = `Yearly spending under ${spendChartRule === "fixed" ? "fixed spending" : RULE_NAMES[spendChartRule].toLowerCase()}`;
  const sp = spendingPercentiles(res, [10, 50, 90]);
  const ages = sp[50].map((_, k) => state.retirement_age + k);
  drawChart($("spend-chart"), {
    x: ages, xLabel: "Age", animate: animateIn,
    bands: [{ lo: sp[10], hi: sp[90], fill: "var(--green-wash)" }],
    lines: [{ values: sp[50], stroke: "var(--green)" }],
    hline: { y: res.spending, label: `Goal ${compact(res.spending)}` },
    tip: (i) => ({ title: `Age ${ages[i]}`, value: money(sp[50][i]), valueLabel: "median spending",
      rows: [["80% range", `${compact(sp[10][i])} to ${compact(sp[90][i])}`], ["Goal", money(res.spending)]] }),
  });
}

// =====================================================================================
// Social Security
// =====================================================================================
async function renderSS(id, firstTime) {
  const inp = current.inp;
  const rows = [];
  for (let age = 62; age <= 70; age++) {
    await nextFrame();
    if (id !== runId) return false;
    const benefitOverride = state.social_security === null ? null
      : state.social_security * claimingAdjustment(age, A.social_security.full_retirement_age) / claimingAdjustment(state.ss_claim_age, A.social_security.full_retirement_age);
    const base = makeInputs({ ...inp, ss_claim_age: age, social_security: benefitOverride });
    const res = simulate(base, A);
    const benefit = benefitOverride ?? estimateAnnualBenefit(base, A);
    const cut = ssShowCut ? simulate(makeInputs({ ...base, ss_haircut: true }), A).successProbability : null;
    rows.push({ age, benefit, p: res.successProbability, cut });
  }
  const now = rows.find((r) => r.age === state.ss_claim_age);
  let best = rows.reduce((a, b) => (b.p > a.p + 1e-9 ? b : a), rows[0]);
  if (best.p - now.p < 0.005) best = now; // within half a point: keep the current choice
  const lead = $("ss-lead");
  lead.textContent = best.age === state.ss_claim_age
    ? `Claiming at ${best.age}, your current choice, already gives the best odds: ${pct(best.p)}.`
    : `Claiming at ${best.age} gives the best odds: ${pct(best.p)}, versus ${pct(now.p)} at ${state.ss_claim_age}, your current choice. `;
  if (best.age !== state.ss_claim_age) {
    const b = el("button", { type: "button", class: "button quiet small" }, `Claim at ${best.age}`);
    b.addEventListener("click", () => { state.ss_claim_age = best.age; syncSettings(); schedule(0); });
    lead.append(b);
  }
  $("ss-legend-cut").hidden = !ssShowCut;
  const lines = [{ values: rows.map((r) => r.p), stroke: "var(--green)" }];
  if (ssShowCut) lines.push({ values: rows.map((r) => r.cut), stroke: "var(--brass)" });
  const vals = lines.flatMap((l) => l.values);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 0.05) * 10) / 10), hi = Math.min(1, Math.ceil((Math.max(...vals) + 0.05) * 10) / 10);
  drawChart($("ss-chart"), {
    x: rows.map((r) => r.age), xEvery: 1, animate: firstTime, points: true, height: 280,
    lines, yMin: lo, yMax: hi, yStep: (hi - lo) / 4, yFormat: (v) => pct(v), startIndex: best.age - 62,
    highlight: { i: best.age - 62, v: best.p },
    tip: (i) => ({ title: `Claim at ${rows[i].age}`, value: pct(rows[i].p), valueLabel: "chance your money lasts",
      rows: [["Benefit", `${money(rows[i].benefit)} a year`], ...(ssShowCut ? [["With the 2034 cut", pct(rows[i].cut)]] : [])] }),
  });
  const table = $("ss-table");
  table.textContent = "";
  const head = el("tr");
  ["Claim at", "Yearly benefit", "Chance money lasts", ...(ssShowCut ? ["With the 2034 cut"] : [])].forEach((h) => head.append(el("th", { scope: "col" }, h)));
  const thead = el("thead"); thead.append(head);
  const tbody = el("tbody");
  rows.forEach((r) => {
    const tr = el("tr", { class: r.age === best.age ? "best" : "" });
    tr.append(el("td", {}, r.age === 67 ? "67 (full retirement age)" : String(r.age)), el("td", {}, money(r.benefit)), el("td", {}, pct(r.p)));
    if (ssShowCut) tr.append(el("td", {}, pct(r.cut)));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  return true;
}

// =====================================================================================
// Compare: Plan B is built from scrub fields you can drag, type into or step with keys.
// =====================================================================================
const bFields = {};
function bFromA() {
  return {
    retirement_age: state.retirement_age,
    savings_rate: state.savings_rate,
    retirement_spending: retirementSpending(state),
    equity_at_retirement: state.equity_at_retirement,
    total_fee: state.advisory_fee + state.fund_fee,
    spending_rule: state.spending_rule,
  };
}
function initCompare() {
  const specs = [
    ["retirement_age", "b-retire", { label: "Retire at", min: 40, max: 85, step: 1, sensitivity: 8, format: (v) => String(Math.round(v)) }],
    ["savings_rate", "b-rate", { label: "Save", min: 0, max: 0.75, step: 0.005, sensitivity: 3, format: (v) => pct(v, 1), parse: (s) => parsePercent(s) }],
    ["retirement_spending", "b-spend", { label: "Spend", min: 10000, max: 300000, step: 1000, sensitivity: 2, format: money, parse: parseMoney }],
    ["equity_at_retirement", "b-eq", { label: "Stocks", min: 0, max: 1, step: 0.05, sensitivity: 6, format: (v) => pct(v), parse: (s) => parsePercent(s) }],
    ["total_fee", "b-fee", { label: "Fees", min: 0, max: 0.03, step: 0.0005, sensitivity: 3, format: (v) => pct(v, 2), parse: (s) => parsePercent(s) }],
  ];
  for (const [key, id, spec] of specs) {
    const host = $(id);
    const onChange = (v) => { if (bState) { bState[key] = v; queueCompare(); } };
    if (RB.scrubField) {
      bFields[key] = RB.scrubField(host, { ...spec, id: id + "-input", value: 0, onChange, onCommit: onChange });
    } else {
      const input = el("input", { type: "text", id: id + "-input", "aria-label": spec.label });
      host.append(input);
      input.addEventListener("input", () => { const v = (spec.parse || Number)(input.value); if (Number.isFinite(v)) onChange(v); });
      bFields[key] = { set: (v) => { input.value = spec.format(v); }, input };
    }
  }
  $("b-rule").addEventListener("change", () => { if (bState) { bState.spending_rule = $("b-rule").value; queueCompare(); } });
  $("b-form").addEventListener("submit", (e) => e.preventDefault());
  $("b-reset").addEventListener("click", () => { bState = bFromA(); syncBForm(); dirty.add("compare"); renderView("compare", runId); });
  $("b-apply").addEventListener("click", () => {
    if (validateB()) return;
    const fund = Math.min(state.fund_fee, bState.total_fee);
    Object.assign(state, { retirement_age: bState.retirement_age, savings_rate: bState.savings_rate, retirement_spending: bState.retirement_spending,
      equity_at_retirement: bState.equity_at_retirement, fund_fee: fund, advisory_fee: Math.max(bState.total_fee - fund, 0), spending_rule: bState.spending_rule });
    spendingExplicit = true;
    fillStory();
    syncSettings();
    navigate("overview");
    schedule(0);
  });
}
let bTimer = null;
function queueCompare() {
  clearTimeout(bTimer);
  bTimer = setTimeout(() => { dirty.add("compare"); renderView("compare", runId); }, 160);
}
function syncBForm() {
  for (const [key, f] of Object.entries(bFields)) f.set(bState[key]);
  $("b-rule").value = bState.spending_rule;
}
function validateB() {
  if (!(bState.retirement_age > state.current_age && bState.retirement_age < state.plan_to_age)) return "Plan B retirement age has to be after your current age and before the plan ends.";
  if (!(bState.savings_rate >= 0 && bState.savings_rate <= 1)) return "Plan B savings rate has to be between 0% and 100%.";
  return null;
}
function bInputs() {
  const fund = Math.min(state.fund_fee, bState.total_fee);
  return makeInputs({ ...current.inp, retirement_age: bState.retirement_age, savings_rate: bState.savings_rate,
    retirement_spending: bState.retirement_spending, equity_at_retirement: bState.equity_at_retirement,
    fund_fee: fund, advisory_fee: Math.max(bState.total_fee - fund, 0), spending_rule: bState.spending_rule });
}
async function renderCompare(id, firstTime) {
  if (!bState) {
    bState = bFromA();
    bState.savings_rate = Math.min(0.75, Math.round((state.savings_rate + 0.03) * 1000) / 1000);
    syncBForm();
  }
  const err = validateB();
  $("b-error").textContent = err || "";
  if (err) return true;
  await nextFrame();
  if (id !== runId) return false;
  const aRes = current.res;
  let bRes;
  try { bRes = simulate(bInputs(), A); } catch (e) { $("b-error").textContent = e.message; return true; }
  const signed = (d, text) => (d > 0 ? "+" : MINUS) + text;
  const dMoney = (d) => signed(d, money(Math.abs(d)));
  const metrics = [
    ["Chance money lasts", (r) => r.successProbability, (v) => pct(v), true, 0.005, (d) => pts(d)],
    ["Median at retirement", (r) => atRetirement(r, 50), money, true, 1, dMoney],
    ["Bad market at retirement (10th pct)", (r) => atRetirement(r, 10), money, true, 1, dMoney],
    ["Typical yearly spending in retirement", (r) => medianSpending(r), money, true, 1, dMoney],
    ["Median left at plan end", (r) => percentile(r.balances.at(-1), 50), money, true, 1, dMoney],
    ["Withdrawal rate once Social Security starts", (r) => sustainedWithdrawalRate(r), percentOrNA, false,
      0.0005, (d) => signed(d, (100 * Math.abs(d)).toFixed(1) + " pts")],
  ];
  const table = $("compare-table");
  table.textContent = "";
  const head = el("tr");
  ["Measure", "Plan A", "Plan B", "Difference"].forEach((h) => head.append(el("th", { scope: "col" }, h)));
  const thead = el("thead"); thead.append(head);
  const tbody = el("tbody");
  for (const [label, get, fmt, higherBetter, eps, fmtDelta] of metrics) {
    const a = get(aRes), b = get(bRes);
    const d = Number.isFinite(a) && Number.isFinite(b) ? b - a : 0;
    const tr = el("tr");
    const moved = Math.abs(d) >= eps;
    const good = moved && (higherBetter ? d > 0 : d < 0), bad = moved && !good;
    tr.append(el("td", {}, label), el("td", {}, fmt(a)), el("td", {}, fmt(b)), el("td", { class: `delta ${good ? "up" : bad ? "down" : ""}` }, moved ? fmtDelta(d) : "same"));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  $("b-odds").textContent = pct(bRes.successProbability);
  $("a-odds").textContent = pct(aRes.successProbability);
  const ages = aRes.balances.map((_, t) => state.current_age + t);
  const a50 = percentilePaths(aRes, [50])[50], b50 = percentilePaths(bRes, [50])[50];
  drawChart($("compare-chart"), {
    x: ages, xLabel: "Age", animate: firstTime, endLabels: true, startIndex: state.retirement_age - state.current_age,
    lines: [{ values: a50, stroke: "var(--green)", label: "A" }, { values: b50, stroke: "var(--brass)", label: "B" }],
    tip: (i) => ({ title: `Age ${ages[i]}`, rows: [["Plan A median", money(a50[i])], ["Plan B median", money(b50[i])]] }),
  });
  return true;
}

// =====================================================================================
// Pro views (demo): locked previews until Pro is on
// =====================================================================================
function syncLocks() {
  const on = isPro();
  for (const v of PRO_VIEWS) {
    const lock = $(`lock-${v}`), body = $(`pro-${v}`);
    if (!lock || !body) continue;
    if (!on && !lock.firstChild) {
      const f = PRO_FEATURES[v];
      const card = el("div", { class: "lock-card" });
      const icon = el("span", { class: "lock-icon", "aria-hidden": "true" });
      icon.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
      const actions = el("div", { class: "lock-actions" });
      actions.append(el("button", { type: "button", class: "button brass", "data-unlock-pro": v }, "Unlock Pro (demo)"),
        el("a", { class: "button ghost", href: "#/pricing" }, "See pricing"));
      card.append(icon, el("h2", {}, `${f.name} is part of Pro`), el("p", {}, f.text), actions,
        el("p", { class: "lock-fine" }, "Demo only: Glidepath never asks for payment details and nothing is charged."));
      lock.append(lockPreview(v), card);
    }
    lock.hidden = on;
    body.hidden = !on;
  }
  document.querySelectorAll(".viewnav .pro-pill").forEach((n) => n.classList.toggle("is-on", on));
}

// ---------- Odds map: retirement age x savings rate ----------
// Each column reuses one matrix of simulated returns (they depend on the retirement age through the
// glide path, not on the savings rate), and the seed matches the main run, so the cell for your
// current plan shows exactly the headline number.
// Cells are judged on the whole percent they show, so a square labeled 85 sits inside the 85% line.
const HEAT = [0, 40, 55, 70, 80, 85, 92];
const shown = (p) => Math.round(p * 100);
const reaches = (p) => shown(p) >= Math.round(TARGET * 100);
const heatStep = (p) => { let k = 0; HEAT.forEach((t, i) => { if (shown(p) >= t) k = i; }); return k; };
let mapPick = null, mapNarrow = null;
// Eleven retirement ages on wide screens, seven on phones, so every column fits without scrolling.
const isNarrowMap = () => (($("panel-map")?.clientWidth || $("planner-body")?.clientWidth || 800) < 600);
function mapAxes(span) {
  const want = 2 * span + 1;
  const cols = [];
  for (let a = state.retirement_age - span; a <= state.retirement_age + span; a++) if (a > state.current_age && a < state.plan_to_age) cols.push(a);
  let lo = cols[0], hi = cols.at(-1);
  while (cols.length < want && hi + 1 < state.plan_to_age) cols.push(++hi);
  while (cols.length < want && lo - 1 > state.current_age) cols.unshift(--lo);
  const rows = [];
  for (let k = 6; k >= -4; k--) {
    const r = Math.round((state.savings_rate + k * 0.025) * 1000) / 1000;
    if (r >= 0 && r <= 0.75) rows.push(r);
  }
  return { cols, rows };
}
function describeMap(grid, cols, rows) {
  const ci = cols.indexOf(state.retirement_age), ri = rows.indexOf(Math.round(state.savings_rate * 1000) / 1000);
  const total = grid.flat().filter(reaches).length;
  const parts = [`${total} of the ${cols.length * rows.length} combinations reach ${pct(TARGET)}.`];
  const p0 = grid[ri]?.[ci];
  if (reaches(p0)) {
    let early = null;
    for (let c = 0; c <= ci; c++) if (reaches(grid[ri][c])) { early = cols[c]; break; }
    parts.push(`Your plan is one of them${early !== null && early < state.retirement_age ? `; at your savings rate you could retire as early as ${early}` : ""}.`);
  } else {
    let age = null, rate = null;
    for (let c = ci; c < cols.length; c++) if (reaches(grid[ri][c])) { age = cols[c]; break; }
    for (let r = ri; r >= 0; r--) if (reaches(grid[r][ci])) { rate = rows[r]; break; }
    if (rate !== null) parts.push(`At ${state.retirement_age}, saving ${pct(rate, 1)} gets there.`);
    if (age !== null) parts.push(`At your current savings rate, retiring at ${age} does.`);
    if (rate === null && age === null) parts.push("Nothing in this range gets there without spending less. Try the spending lever on the Overview.");
  }
  return parts.join(" ");
}
function showPick(cell) {
  const bar = $("map-pick");
  bar.textContent = "";
  if (!cell) { bar.append(el("span", { class: "map-pick-hint" }, "Point at or select a square to read it.")); return; }
  const { age, rate, p } = cell;
  const isCurrent = age === state.retirement_age && Math.abs(rate - state.savings_rate) < 1e-9;
  const text = el("span", { class: "map-pick-text" });
  text.append(el("strong", {}, pct(p)), ` chance the money lasts if you retire at ${age} and save ${pct(rate, 1)} of income`);
  bar.append(text);
  if (isCurrent) bar.append(el("span", { class: "map-pick-tag" }, "Your plan"));
  else {
    const b = el("button", { type: "button", class: "button small" }, "Use this plan");
    b.addEventListener("click", () => {
      spendingExplicit = true;
      state.retirement_spending = current.res.spending;
      state.retirement_age = age;
      state.savings_rate = rate;
      fillStory();
      schedule(0);
    });
    bar.append(b);
  }
}
async function renderMap(id, firstTime) {
  const inp = current.inp, spend = current.res.spending;
  mapNarrow = isNarrowMap();
  const { cols, rows } = mapAxes(mapNarrow ? 3 : 5);
  const table = $("odds-table");
  table.textContent = "";
  table.classList.toggle("is-narrow", mapNarrow);
  table.append(el("caption", { class: "visually-hidden" }, "Chance the money lasts, by savings rate (rows) and retirement age (columns)"));
  const thead = el("thead"), hr = el("tr");
  hr.append(el("th", { scope: "col", class: "corner" }, "Save"));
  cols.forEach((a) => hr.append(el("th", { scope: "col", class: a === state.retirement_age ? "is-current" : null }, String(a))));
  thead.append(hr);
  const tbody = el("tbody");
  const cells = rows.map((r) => {
    const tr = el("tr");
    const isRow = Math.abs(r - state.savings_rate) < 1e-9;
    tr.append(el("th", { scope: "row", class: isRow ? "is-current" : null }, pct(r, 1)));
    const out = cols.map((a) => {
      const td = el("td");
      const b = el("button", { type: "button", class: "odds-cell is-pending", tabindex: "-1", "aria-label": `Retire at ${a}, save ${pct(r, 1)}: calculating` });
      if (isRow && a === state.retirement_age) td.classList.add("is-current");
      td.append(b);
      tr.append(td);
      return { td, b, age: a, rate: r, p: null };
    });
    tbody.append(tr);
    return out;
  });
  table.append(thead, tbody);
  $("map-lead").textContent = "Running every combination…";
  showPick(null);
  const grid = rows.map(() => cols.map(() => null));
  for (let c = 0; c < cols.length; c++) {
    await nextFrame();
    if (id !== runId) return false;
    const colInp = makeInputs({ ...inp, retirement_age: cols[c], retirement_spending: spend });
    const R = simulateReturns(colInp, A);
    const filled = [];
    rows.forEach((r, k) => {
      const p = simulate(makeInputs({ ...colInp, savings_rate: r }), A, R).successProbability;
      grid[k][c] = p;
      const cell = cells[k][c];
      cell.p = p;
      cell.b.textContent = String(shown(p));
      cell.b.dataset.step = String(heatStep(p));
      cell.b.classList.remove("is-pending");
      cell.b.setAttribute("aria-label", `Retire at ${cols[c]}, save ${pct(r, 1)}: ${pct(p)} chance the money lasts`);
      filled.push(cell.b);
    });
    if (animate && firstTime) gsap.fromTo(filled, { scale: 0.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.35, ease: "back.out(1.6)", stagger: 0.012 });
  }
  if (id !== runId) return false;
  // The 85% line: an edge wherever a cell that reaches the target meets one that doesn't.
  rows.forEach((_, k) => cols.forEach((__, c) => {
    if (!reaches(grid[k][c])) return;
    const td = cells[k][c].td;
    if (c > 0 && !reaches(grid[k][c - 1])) td.classList.add("edge-l");
    if (c < cols.length - 1 && !reaches(grid[k][c + 1])) td.classList.add("edge-r");
    if (k > 0 && !reaches(grid[k - 1][c])) td.classList.add("edge-t");
    if (k < rows.length - 1 && !reaches(grid[k + 1][c])) td.classList.add("edge-b");
  }));
  $("map-lead").textContent = describeMap(grid, cols, rows);
  // Roving focus: one tab stop, arrow keys move between squares.
  const flat = cells.flat();
  const start = flat.find((x) => x.td.classList.contains("is-current")) || flat[0];
  start.b.tabIndex = 0;
  for (const cell of flat) {
    const pick = () => { mapPick = cell; showPick(cell); };
    cell.b.addEventListener("pointerenter", pick);
    cell.b.addEventListener("focus", pick);
    cell.b.addEventListener("click", pick);
  }
  table.onkeydown = (e) => {
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = moves[e.key];
    const at = flat.findIndex((x) => x.b === document.activeElement);
    if (!m || at < 0) return;
    e.preventDefault();
    const k = Math.floor(at / cols.length), c = at % cols.length;
    const nk = Math.min(rows.length - 1, Math.max(0, k + m[0])), nc = Math.min(cols.length - 1, Math.max(0, c + m[1]));
    const next = cells[nk][nc];
    flat.forEach((x) => { x.b.tabIndex = -1; });
    next.b.tabIndex = 0;
    next.b.focus();
  };
  table.onpointerleave = () => showPick(mapPick && cells.flat().includes(mapPick) ? mapPick : null);
  mapPick = null;
  return true;
}

// ---------- Year-by-year plan ----------
let yearRows = [];
function yearData(res) {
  const n = res.success.length;
  const depl = Array.from(res.depletionAge).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const W = state.retirement_age - state.current_age;
  const rows = [];
  let j = 0;
  for (let t = 0; t < res.contributions.length; t++) {
    const age = state.current_age + t;
    while (j < depl.length && depl[j] <= age) j++;
    const bal = Float64Array.from(res.balances[t]).sort();
    const q = (p) => { const x = (p / 100) * (n - 1), lo = Math.floor(x), hi = Math.ceil(x); return bal[lo] + (bal[hi] - bal[lo]) * (x - lo); };
    const retired = t >= W;
    let spend = null;
    if (retired) {
      const col = new Float64Array(n);
      for (let i = 0; i < n; i++) col[i] = res.spendingPaths[i][t];
      spend = percentile(col, 50);
    }
    rows.push({
      age, year: state.start_year + t, retired, contribution: res.contributions[t], ss: res.socialSecurity[t], spend,
      p10: q(10), p50: q(50), p90: q(90), lasts: 1 - j / n,
    });
  }
  return rows;
}
async function renderYears(id) {
  await nextFrame();
  if (id !== runId) return false;
  const rows = yearData(current.res);
  yearRows = rows;
  const table = $("years-table");
  table.textContent = "";
  const thead = el("thead");
  const h1 = el("tr"), h2 = el("tr");
  h1.append(el("th", { scope: "col", rowspan: "2" }, "Age"), el("th", { scope: "col", rowspan: "2" }, "Year"),
    el("th", { scope: "col", rowspan: "2" }, "You save"), el("th", { scope: "col", rowspan: "2" }, "Social Security"),
    el("th", { scope: "col", rowspan: "2" }, "You spend (median)"),
    el("th", { scope: "colgroup", colspan: "3", class: "group" }, "Portfolio at the start of the year"),
    el("th", { scope: "col", rowspan: "2" }, "Money lasts this far"));
  h2.append(el("th", { scope: "col" }, "Bad market"), el("th", { scope: "col" }, "Median"), el("th", { scope: "col" }, "Good market"));
  thead.append(h1, h2);
  const tbody = el("tbody");
  const dash = "–";
  for (const r of rows) {
    const tr = el("tr", { class: r.age === state.retirement_age ? "retire-row" : r.retired ? "retired" : null });
    tr.append(el("th", { scope: "row" }, r.age === state.retirement_age ? `${r.age} (retire)` : String(r.age)), el("td", {}, String(r.year)),
      el("td", {}, r.contribution > 0.5 ? money(r.contribution) : dash), el("td", {}, r.ss > 0.5 ? money(r.ss) : dash),
      el("td", {}, r.spend === null ? dash : money(r.spend)),
      el("td", {}, money(r.p10)), el("td", { class: "strong" }, money(r.p50)), el("td", {}, money(r.p90)),
      el("td", { class: r.lasts < TARGET ? "warn" : null }, pct(r.lasts)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const peak = rows.reduce((m, r) => (r.p50 > m.p50 ? r : m), rows[0]);
  const last = rows.at(-1);
  $("years-lead").textContent = `${rows.length} years, from age ${rows[0].age} to ${last.age}, in today's dollars. The median portfolio peaks at ${words(peak.p50)} at age ${peak.age}, and ${pct(last.lasts)} of simulated markets still have money in the final year.`;
  return true;
}
function downloadYears() {
  if (!yearRows.length) return;
  const head = ["Age", "Year", "You save", "Social Security", "You spend (median)", "Portfolio, bad market (10th percentile)",
    "Portfolio, median", "Portfolio, good market (90th percentile)", "Chance the money lasts to this age"];
  // RFC 4180: quote any field with a comma, quote or line break.
  const field = (v) => { const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const line = (cells) => cells.map(field).join(",");
  const lines = [line([`Glidepath plan in today's dollars: retire at ${state.retirement_age}, save ${pct(state.savings_rate, 1)}, spend ${money(current.res.spending)} a year. For education only.`]), line(head)];
  for (const r of yearRows) {
    lines.push(line([r.age, r.year, Math.round(r.contribution), Math.round(r.ss), r.spend === null ? "" : Math.round(r.spend),
      Math.round(r.p10), Math.round(r.p50), Math.round(r.p90), r.lasts.toFixed(4)]));
  }
  const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `glidepath-plan-retire-${state.retirement_age}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  const s = $("years-status");
  s.textContent = "Downloaded.";
  setTimeout(() => { s.textContent = ""; }, 3000);
}

// =====================================================================================
// Views (sidebar on wide screens, a scrolling bar of pills on narrow ones)
// =====================================================================================
let navigate = (view) => { location.hash = hrefFor(view); };
function moveIndicator(instant) {
  const nav = $("viewnav"), btn = $(`tab-${activeView}`), ind = $("viewnav-indicator");
  if (!nav || !btn || !ind || nav.offsetParent === null) return;
  const vertical = getComputedStyle(nav).flexDirection === "column";
  const props = vertical
    ? { x: 0, y: btn.offsetTop, width: 3, height: btn.offsetHeight }
    : { x: btn.offsetLeft, y: btn.offsetTop + btn.offsetHeight - 2, width: btn.offsetWidth, height: 2 };
  if (animate && !instant) gsap.to(ind, { ...props, duration: 0.45, ease: "power3.out" });
  else if (gsap) gsap.set(ind, props);
}
function selectView(name, { focus = false, initial = false } = {}) {
  if (!VIEWS.includes(name)) name = "overview";
  const prev = activeView;
  activeView = name;
  for (const v of VIEWS) {
    const b = $(`tab-${v}`);
    b.setAttribute("aria-selected", String(v === name));
    b.tabIndex = v === name ? 0 : -1;
    $(`panel-${v}`).hidden = v !== name;
  }
  const btn = $(`tab-${name}`);
  if (focus) btn.focus();
  const nav = $("viewnav");
  if (getComputedStyle(nav).flexDirection !== "column") {
    const left = btn.offsetLeft, right = left + btn.offsetWidth;
    if (left < nav.scrollLeft) nav.scrollTo({ left: Math.max(left - 16, 0), behavior: animate ? "smooth" : "auto" });
    else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: right - nav.clientWidth + 32, behavior: animate ? "smooth" : "auto" });
  }
  moveIndicator(initial);
  const panel = $(`panel-${name}`);
  if (animate && !initial && prev !== name) gsap.fromTo(panel, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: "power3.out" });
  if (!initial && prev !== name) {
    const body = $("planner-body");
    const top = body.getBoundingClientRect().top;
    if (top < 0) scrollToY(window.scrollY + top - 72, { duration: 0.8 });
  }
  if (name === "assumptions") dirty.delete("assumptions");
  if (current.res) renderView(name, runId);
  if (ST) requestAnimationFrame(() => ST.refresh());
}

async function renderView(name, id) {
  if (PRO_VIEWS.has(name)) {
    syncLocks();
    if (!isPro()) {
      if (id === runId && !inflight.size) document.body.classList.remove("updating");
      return;
    }
  }
  if (!dirty.has(name) || !current.res) {
    if (id === runId && !inflight.size) document.body.classList.remove("updating");
    return;
  }
  if (inflight.get(name) === id) return;
  inflight.set(name, id);
  const firstTime = !rendered.has(name);
  document.body.classList.add("updating");
  let done = true;
  try {
    if (name === "overview") done = await renderOverview(id, firstTime);
    else if (name === "stress") done = await renderStress(id, firstTime);
    else if (name === "spending") done = await renderSpending(id, firstTime);
    else if (name === "ss") done = await renderSS(id, firstTime);
    else if (name === "compare") done = await renderCompare(id, firstTime);
    else if (name === "map") done = await renderMap(id, firstTime);
    else if (name === "years") done = await renderYears(id);
  } catch (err) {
    console.error(err);
  }
  if (inflight.get(name) === id) inflight.delete(name);
  if (done && id === runId) {
    dirty.delete(name);
    rendered.add(name);
    if (!inflight.size) document.body.classList.remove("updating");
    if (ST) ST.refresh();
  }
}

// =====================================================================================
// Run loop
// =====================================================================================
function schedule(delay = 220) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}
function run() {
  const err = readStory() || readSettings();
  $("form-error").textContent = err || "";
  if (err) return;
  let inp;
  try { inp = makeInputs(state); } catch (e) { $("form-error").textContent = e.message; return; }
  const id = ++runId;
  syncSettings();
  fillStory();
  const est = estimateAnnualBenefit(inp, A);
  $("s-ss").placeholder = `Estimate: ${money(est)}`;
  $("s-ss-hint").textContent = state.social_security === null
    ? `Leave blank to use the estimate from your income: ${money(est)} a year at ${state.ss_claim_age}.`
    : `The estimate from your income would be ${money(est)} a year.`;
  current.inp = inp;
  current.res = simulate(inp, A);
  renderAnswer(current.res);
  VIEWS.forEach((v) => dirty.add(v));
  dirty.delete("assumptions");
  renderView(activeView, id);
}

// =====================================================================================
// Page lifecycle
// =====================================================================================
function init(nav) {
  if (ready) return;
  ready = true;
  if (nav) navigate = nav;
  initStory();
  initSettings();
  initCompare();
  syncSettings();
  fillStory();
  VIEWS.forEach((v, k) => {
    const b = $(`tab-${v}`);
    b.addEventListener("click", () => navigate(v));
    b.addEventListener("keydown", (e) => {
      let j = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (k + 1) % VIEWS.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (k - 1 + VIEWS.length) % VIEWS.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = VIEWS.length - 1;
      if (j === null) return;
      e.preventDefault();
      navigate(VIEWS[j]);
      requestAnimationFrame(() => $(`tab-${VIEWS[j]}`).focus());
    });
  });
  $("ss-stress").addEventListener("change", (e) => { ssShowCut = e.target.checked; dirty.add("ss"); renderView("ss", runId); });
  $("years-download").addEventListener("click", downloadYears);
  syncLocks();
  onProChange(() => {
    syncLocks();
    if (PRO_VIEWS.has(activeView)) renderView(activeView, runId);
  });
  $("print-plan")?.addEventListener("click", () => window.print());
  window.addEventListener("beforeprint", () => { document.querySelectorAll(".chart").forEach(hideTip); document.activeElement?.blur?.(); });
  $("print-date").textContent = "Plan prepared " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  document.fonts?.ready?.then(() => { for (const f of Object.values(story)) autosize(f.el); moveIndicator(true); });
}

export const planner = {
  init,
  enter(view = "overview", { initial = false } = {}) {
    init();
    const first = !current.res;
    selectView(view, { initial: initial || first });
    if (first) run();
    requestAnimationFrame(() => { for (const f of Object.values(story)) autosize(f.el); moveIndicator(true); });
  },
  leave() { document.body.classList.remove("updating"); },
  resize() {
    if (!ready) return;
    moveIndicator(true);
    if (activeView === "map" && isPro() && mapNarrow !== null && mapNarrow !== isNarrowMap()) { dirty.add("map"); renderView("map", runId); }
    for (const f of Object.values(story)) autosize(f.el);
  },
  get view() { return activeView; },
};
