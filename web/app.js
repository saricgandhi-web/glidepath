import {
  DEFAULTS, atRetirement, buildPlan, estimateAnnualBenefit, makeInputs, percentilePaths, retirementSpending, simulate,
} from "./engine.js";

const A = JSON.parse(document.getElementById("assumptions").textContent);
const TARGET = A.benchmarks.target_success_probability;
const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";

// ---------- state ----------
const state = { ...DEFAULTS };
let spendingExplicit = false;

// ---------- parsing and formatting ----------
function parseMoney(s) {
  const t = String(s).trim().toLowerCase().replace(/[$,\s]/g, "");
  const m = t.match(/^(-?\d*\.?\d+)([km]?)$/);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
}
function parsePercent(s) {
  const t = String(s).trim().replace(/[%\s]/g, "");
  return t === "" || isNaN(Number(t)) ? NaN : Number(t) / 100;
}
function parseAge(s) {
  const t = String(s).trim();
  return /^\d{1,3}$/.test(t) ? Number(t) : NaN;
}
const money = (x) => "$" + Math.round(x).toLocaleString("en-US");
const pct = (x, d = 0) => (100 * x).toFixed(d).replace(/\.0+$/, "") + "%";
function compact(x) {
  const a = Math.abs(x);
  if (a >= 1e6) return "$" + (x / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  if (a >= 1e3) return "$" + Math.round(x / 1e3) + "K";
  return "$" + Math.round(x);
}
function words(x) {
  if (x >= 1e6) return "$" + (x / 1e6).toFixed(2).replace(/0$/, "") + " million";
  return money(Math.round(x / 1000) * 1000);
}
function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function svg(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}

// ---------- the sentence ----------
const story = {
  age: { el: $("f-age"), parse: parseAge, show: (v) => String(v), key: "current_age" },
  savings: { el: $("f-savings"), parse: parseMoney, show: money, key: "current_savings" },
  income: { el: $("f-income"), parse: parseMoney, show: money, key: "annual_income" },
  rate: { el: $("f-rate"), parse: parsePercent, show: (v) => pct(v, 1), key: "savings_rate" },
  retire: { el: $("f-retire"), parse: parseAge, show: (v) => String(v), key: "retirement_age" },
  spend: { el: $("f-spend"), parse: parseMoney, show: money, key: "retirement_spending" },
  planto: { el: $("f-planto"), parse: parseAge, show: (v) => String(v), key: "plan_to_age" },
};

const measurer = el("span", { "aria-hidden": "true", style: "position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0" });
document.body.append(measurer);
function autosize(input) {
  const cs = getComputedStyle(input);
  measurer.style.font = cs.font;
  measurer.style.letterSpacing = cs.letterSpacing;
  measurer.textContent = input.value || "00";
  input.style.width = Math.ceil(measurer.getBoundingClientRect().width) + 10 + "px";
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
    reset.addEventListener("click", () => {
      spendingExplicit = false;
      state.retirement_spending = null;
      fillStory();
      schedule();
    });
    note.append(reset);
  }
}

function readStory() {
  const errors = [];
  for (const [name, f] of Object.entries(story)) {
    const v = f.parse(f.el.value);
    const bad = !Number.isFinite(v) || v < 0;
    f.el.setAttribute("aria-invalid", bad ? "true" : "false");
    if (bad) { errors.push(`Enter a number for ${f.el.getAttribute("aria-label").toLowerCase()}.`); continue; }
    if (name === "spend") {
      if (spendingExplicit) state.retirement_spending = v;
    } else {
      state[f.key] = v;
    }
  }
  if (errors.length) return errors[0];
  if (state.current_age < 18 || state.current_age > 80) return "Current age has to be between 18 and 80.";
  if (state.retirement_age <= state.current_age) return "Retirement age has to be after your current age.";
  if (state.plan_to_age <= state.retirement_age || state.plan_to_age > 110) return "The plan has to run past retirement, up to age 110.";
  if (state.savings_rate > 1) return "Savings rate can't be more than 100% of income.";
  return null;
}

story.spend.el.addEventListener("input", () => { spendingExplicit = true; });
for (const f of Object.values(story)) {
  f.el.addEventListener("input", () => { autosize(f.el); schedule(); });
  f.el.addEventListener("blur", () => {
    const v = f.parse(f.el.value);
    if (Number.isFinite(v)) { f.el.value = f.show(v); autosize(f.el); }
  });
}

// ---------- settings ----------
function initSettings() {
  const claim = $("s-claim");
  for (let a = 62; a <= 70; a++) claim.append(el("option", { value: a }, a === 67 ? "67 (full retirement age)" : String(a)));

  const market = $("s-market");
  for (const [key, m] of Object.entries(A.markets)) {
    const b = el("button", { type: "button", "data-key": key }, key === "jpm_2026" ? "Base case" : "Conservative");
    b.addEventListener("click", () => { state.market = key; syncSettings(); schedule(); });
    market.append(b);
  }

  const presets = $("s-fee-presets");
  const names = { diy_index: "Index funds", robo: "Robo-advisor", traditional: "Traditional advisor" };
  for (const [key, p] of Object.entries(A.fee_profiles)) {
    const b = el("button", { type: "button", "data-key": key }, names[key] || p.label);
    b.addEventListener("click", () => {
      state.advisory_fee = p.advisory_fee; state.fund_fee = p.fund_fee; syncSettings(); schedule();
    });
    presets.append(b);
  }

  $("s-ss").addEventListener("input", schedule);
  claim.addEventListener("change", () => { state.ss_claim_age = Number(claim.value); schedule(); });
  $("s-haircut").addEventListener("change", (e) => { state.ss_haircut = e.target.checked; schedule(); });
  for (const [id, key, out] of [["s-eq-now", "equity_now", "o-eq-now"], ["s-eq-ret", "equity_at_retirement", "o-eq-ret"]]) {
    $(id).addEventListener("input", (e) => { state[key] = Number(e.target.value) / 100; $(out).textContent = e.target.value + "%"; schedule(); });
  }
  for (const id of ["s-adv", "s-fund", "s-growth", "s-replace"]) $(id).addEventListener("input", schedule);
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
    const on = Math.abs(p.advisory_fee - state.advisory_fee) < 1e-9 && Math.abs(p.fund_fee - state.fund_fee) < 1e-9;
    b.setAttribute("aria-pressed", String(on));
  }
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
      return `${label} has to be between ${pct(lo)} and ${pct(hi)}.`;
    }
    state[key] = v;
  }
  return null;
}

// ---------- rendering ----------
function statusFor(p) {
  if (p >= TARGET) return { label: "On track", color: "var(--good)", icon: "check" };
  if (p >= 0.7) return { label: "Close", color: "var(--warning)", icon: "alert" };
  return { label: "At risk", color: "var(--critical)", icon: "cross" };
}
function statusIcon(kind, color) {
  const s = svg("svg", { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": "true" });
  s.append(svg("circle", { cx: 9, cy: 9, r: 9, fill: color }));
  const d = { check: "M5 9.5l2.5 2.5L13 6.5", alert: "M9 4.5v5.5M9 13v.5", cross: "M6 6l6 6M12 6l-6 6" }[kind];
  s.append(svg("path", { d, stroke: kind === "alert" ? "#15241e" : "#fff", "stroke-width": 2, "stroke-linecap": "round", fill: "none" }));
  return s;
}

function renderAnswer(res) {
  const p = res.successProbability;
  $("answer-figure").textContent = pct(p);
  $("answer-text").textContent = `of simulated markets pay for your spending every year through age ${state.plan_to_age}.`;
  const st = statusFor(p);
  const status = $("status");
  status.textContent = "";
  status.append(statusIcon(st.icon, st.color), el("span", { class: "status-label" }, st.label));
  const median = atRetirement(res, 50), bad = atRetirement(res, 10);
  status.append(el("span", { class: "status-detail" },
    `In the median market you retire with ${words(median)}. In a bad one, ${words(bad)}.`));
  const fill = $("meter-fill");
  fill.style.width = Math.max(p * 100, 0.5) + "%";
  fill.style.background = st.color;
  $("meter-target").style.left = TARGET * 100 + "%";
}

// Round tick step (1, 2, 2.5 or 5 x 10^k) and an axis top that is a whole number of steps.
function niceScale(v, ticks = 4) {
  if (!(v > 0)) return { max: 1, step: 0.25 };
  const raw = v / ticks, exp = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((s) => s >= raw);
  return { max: Math.ceil(v / step) * step, step };
}

let fanState = null;
function renderFan(res) {
  const host = $("fan-chart");
  const paths = percentilePaths(res);
  const ages = res.balances.map((_, t) => state.current_age + t);
  const W = Math.max(host.clientWidth, 320), H = W < 560 ? 260 : 340;
  const m = { l: 56, r: 12, t: 18, b: 30 };
  const { max: yMax, step: yStep } = niceScale(Math.max(...paths[90]));
  const x = (i) => m.l + (i / (ages.length - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - v / yMax) * (H - m.t - m.b);

  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" });
  for (let v = 0; v <= yMax + 1e-6; v += yStep) {
    s.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: "var(--rule)", "stroke-width": 1 }));
    s.append(svg("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, compact(v)));
  }
  const step = ages.length > 50 ? 10 : 5;
  ages.forEach((a, i) => {
    if (a % step === 0 && x(i) < W - m.r - 34) s.append(svg("text", { x: x(i), y: H - 8, "text-anchor": "middle" }, String(a)));
  });
  s.append(svg("text", { x: W - m.r, y: H - 8, "text-anchor": "end", class: "axis-label" }, "Age"));

  const band = (lo, hi) => {
    const top = hi.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const bot = lo.map((v, i) => `${x(i)},${y(v)}`).reverse().join(" ");
    return `${top} ${bot}`;
  };
  s.append(svg("polygon", { points: band(paths[10], paths[90]), fill: "var(--green-wash)" }));
  s.append(svg("polygon", { points: band(paths[25], paths[75]), fill: "var(--green-wash-2)" }));
  s.append(svg("polyline", { points: paths[50].map((v, i) => `${x(i)},${y(v)}`).join(" "), fill: "none",
    stroke: "var(--green)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));

  const ri = state.retirement_age - state.current_age;
  s.append(svg("line", { x1: x(ri), x2: x(ri), y1: m.t, y2: H - m.b, stroke: "var(--brass)", "stroke-width": 2 }));
  s.append(svg("text", { x: x(ri) + 6, y: m.t + 10, class: "axis-label" }, `Retire at ${state.retirement_age}`));
  s.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), stroke: "var(--rule-strong)", "stroke-width": 1 }));

  const cross = svg("line", { y1: m.t, y2: H - m.b, stroke: "var(--ink-3)", "stroke-width": 1, visibility: "hidden" });
  const dot = svg("circle", { r: 5, fill: "var(--green)", stroke: "var(--paper)", "stroke-width": 2, visibility: "hidden" });
  s.append(cross, dot);

  host.textContent = "";
  host.append(s);
  const tip = el("div", { class: "tooltip", hidden: "" });
  host.append(tip);
  fanState = { ages, paths, x, y, W, H, m, cross, dot, tip, idx: ri };
  host.setAttribute("aria-label",
    `Projected portfolio by age. Median at retirement ${money(paths[50][ri])}; median at age ${state.plan_to_age} ${money(paths[50].at(-1))}.`);
}

function showTip(i) {
  const f = fanState;
  if (!f) return;
  i = Math.max(0, Math.min(f.ages.length - 1, i));
  f.idx = i;
  const cx = f.x(i);
  f.cross.setAttribute("x1", cx); f.cross.setAttribute("x2", cx); f.cross.setAttribute("visibility", "visible");
  f.dot.setAttribute("cx", cx); f.dot.setAttribute("cy", f.y(f.paths[50][i])); f.dot.setAttribute("visibility", "visible");
  const t = f.tip;
  t.textContent = "";
  t.append(el("div", { class: "tt-age" }, `Age ${f.ages[i]}`), el("strong", {}, money(f.paths[50][i])), el("div", {}, "median"));
  for (const [label, lo, hi] of [["Middle 50%", 25, 75], ["80% range", 10, 90]]) {
    const row = el("div", { class: "tt-row" });
    row.append(el("span", {}, label), el("span", {}, `${compact(f.paths[lo][i])} to ${compact(f.paths[hi][i])}`));
    t.append(row);
  }
  t.hidden = false;
  const host = $("fan-chart");
  const scale = host.clientWidth / f.W;
  const left = cx * scale + 14, tw = t.offsetWidth;
  t.style.left = (left + tw > host.clientWidth ? Math.max(cx * scale - tw - 14, 0) : left) + "px";
  t.style.top = "8px";
}
function hideTip() {
  if (!fanState) return;
  fanState.tip.hidden = true;
  fanState.cross.setAttribute("visibility", "hidden");
  fanState.dot.setAttribute("visibility", "hidden");
}
{
  const host = $("fan-chart");
  host.addEventListener("pointermove", (e) => {
    if (!fanState) return;
    const r = host.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * fanState.W;
    const frac = (px - fanState.m.l) / (fanState.W - fanState.m.l - fanState.m.r);
    showTip(Math.round(frac * (fanState.ages.length - 1)));
  });
  host.addEventListener("pointerleave", hideTip);
  host.addEventListener("focus", () => fanState && showTip(fanState.idx));
  host.addEventListener("blur", hideTip);
  host.addEventListener("keydown", (e) => {
    if (!fanState) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      showTip(fanState.idx + (e.key === "ArrowRight" ? 1 : -1));
    }
  });
}

function renderTable(res) {
  const paths = percentilePaths(res);
  const table = $("fan-table");
  table.textContent = "";
  const head = el("tr");
  for (const h of ["Age", "10th percentile", "25th", "Median", "75th", "90th"]) head.append(el("th", { scope: "col" }, h));
  const thead = el("thead"); thead.append(head);
  const tbody = el("tbody");
  res.balances.forEach((_, t) => {
    const age = state.current_age + t;
    if (age % 5 !== 0 && age !== state.retirement_age && t !== res.balances.length - 1) return;
    const tr = el("tr");
    tr.append(el("td", {}, age === state.retirement_age ? `${age} (retire)` : String(age)));
    for (const p of [10, 25, 50, 75, 90]) tr.append(el("td", {}, money(paths[p][t])));
    tbody.append(tr);
  });
  table.append(thead, tbody);
}

function lever(main, sub, onApply) {
  const li = el("li", { class: onApply ? "lever" : "lever na" });
  const text = el("div");
  text.append(el("div", { class: "lever-main" }, main), el("div", { class: "lever-sub" }, sub));
  li.append(text);
  if (onApply) {
    const b = el("button", { type: "button", class: "button quiet" }, "Apply");
    b.addEventListener("click", onApply);
    li.append(b);
  }
  return li;
}

function renderLevers(plan) {
  const ul = $("levers");
  ul.textContent = "";
  const p = plan.result.successProbability;
  const above = p >= TARGET;
  $("levers-title").textContent = above ? "How much room you have" : `Three ways to reach ${pct(TARGET)} confidence`;
  const rate = plan.requiredSavingsRate, spend = plan.maxSpending, age = plan.earliestRetirementAge;

  if (rate === null) ul.append(lever("Saving more won't get there alone", "Even 75% of income falls short. Combine it with another lever."));
  else {
    const r = Math.ceil(rate * 1000) / 1000;
    ul.append(lever(above ? `Save as little as ${pct(r, 1)} of income` : `Save ${pct(r, 1)} of income`,
      `${above ? "down" : "up"} from ${pct(state.savings_rate, 1)}`,
      () => { state.savings_rate = r; fillStory(); schedule(); }));
  }
  const s = Math.floor(spend / 10) * 10;
  ul.append(lever(above ? `Spend up to ${money(s)} a year` : `Spend ${money(s)} a year`, `instead of ${money(plan.result.spending)}`,
    () => { spendingExplicit = true; state.retirement_spending = s; fillStory(); schedule(); }));
  if (age === null) ul.append(lever("Working longer won't get there alone", "Even retiring at 75 falls short."));
  else ul.append(lever(above ? `Retire as early as ${age}` : `Retire at ${age}`, `instead of ${state.retirement_age}`,
    age === state.retirement_age ? null : () => {
      // The solver holds the spending goal fixed in today's dollars; keep it fixed here too.
      spendingExplicit = true;
      state.retirement_spending = plan.result.spending;
      state.retirement_age = age;
      fillStory();
      schedule();
    }));
}

function renderFees(plan) {
  const rows = plan.fees;
  const host = $("fees");
  const W = Math.max(host.clientWidth, 300), rowH = 58, labelW = W < 420 ? 118 : 150, valueW = 70;
  const H = rows.length * rowH;
  const max = Math.max(...rows.map((r) => r.medianAtRetirement));
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
    "aria-label": "Median portfolio at retirement by fee level" });
  const names = { diy_index: "Index funds", robo: "Robo-advisor", traditional: "Traditional advisor" };
  rows.forEach((r, i) => {
    const y0 = i * rowH + 8;
    s.append(svg("text", { x: 0, y: y0 + 13 }, names[r.key] || r.label));
    s.append(svg("text", { x: 0, y: y0 + 31, class: "bar-sub" }, `${pct(r.totalFee, 2)} a year`));
    const bw = Math.max(((W - labelW - valueW) * r.medianAtRetirement) / max, 2);
    const bh = 22, by = y0 + 2, bx = labelW, rr = 4;
    const g = svg("g");
    g.append(svg("path", { d: `M${bx},${by} h${bw - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${bh - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${bw - rr} z`,
      fill: "var(--green)" }));
    g.append(svg("title", {}, `${names[r.key]}: ${money(r.medianAtRetirement)} median at retirement, ${pct(r.successProbability)} chance of success`));
    s.append(g);
    s.append(svg("text", { x: bx + bw + 8, y: by + 15, class: "bar-value" }, compact(r.medianAtRetirement)));
    s.append(svg("text", { x: bx, y: by + bh + 16, class: "bar-sub" }, `${pct(r.successProbability)} chance of success`));
  });
  host.textContent = "";
  host.append(s);
  const lo = rows[0], hi = rows[rows.length - 1];
  $("fee-note").textContent = `Paying ${pct(hi.totalFee, 2)} a year instead of ${pct(lo.totalFee, 2)} costs this plan about ${words(hi.costVsLowest)} at retirement and moves the chance of success from ${pct(lo.successProbability)} to ${pct(hi.successProbability)}.`;
}

function renderPlan(plan) {
  const ol = $("plan-list");
  ol.textContent = "";
  const labels = { high: "High impact", medium: "Medium impact", low: "Worth knowing" };
  // The three levers already have their own section on screen.
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

function renderSsHint(inp) {
  const est = estimateAnnualBenefit(inp, A);
  $("s-ss").placeholder = `Estimate: ${money(est)}`;
  $("s-ss-hint").textContent = state.social_security === null
    ? `Leave blank to use the estimate from your income: ${money(est)} a year at ${state.ss_claim_age}.`
    : `The estimate from your income would be ${money(est)} a year.`;
}

function renderSources() {
  const j = A.markets.jpm_2026, v = A.markets.vanguard_2026, f = A.fee_profiles.traditional;
  const lim = A.contribution_limits_2026, ss = A.social_security;
  const rows = [
    ["U.S. stocks, expected return", pct(j.equity_return, 1), "J.P. Morgan 2026 Long-Term Capital Market Assumptions"],
    ["U.S. bonds, expected return", pct(j.bond_return, 1), "J.P. Morgan 2026 LTCMA"],
    ["Inflation", pct(j.inflation, 1), "J.P. Morgan 2026 LTCMA"],
    ["Conservative case, stocks and bonds", `${pct(v.equity_return, 1)} / ${pct(v.bond_return, 1)}`, "Vanguard Capital Markets Model (June 2026) and 2026 outlook, range midpoints"],
    ["Volatility, stocks and bonds", `${pct(j.equity_vol, 1)} / ${pct(j.bond_vol, 1)}`, "Vanguard Capital Markets Model"],
    ["Stock-bond correlation", j.correlation.toFixed(2), "Project assumption"],
    ["Traditional advisor, all-in cost", pct(f.advisory_fee + f.fund_fee, 2), "Kitces Research 2024 (1.00% median fee); Inside Information fee study (about 1.65% all-in)"],
    ["401(k) and IRA limits, 2026", `${money(lim.employee_401k)} / ${money(lim.ira)}`, "IRS"],
    ["Social Security bend points", `${money(ss.bend_point_1)} / ${money(ss.bend_point_2)}`, "SSA, 2027 benefit formula"],
    ["Social Security trust funds", `${ss.combined_trust_fund_depletion_year}, ${pct(ss.payable_ratio_at_depletion)} payable`, "2026 Social Security Trustees Report"],
    ["Safe withdrawal rate", pct(A.benchmarks.morningstar_safe_withdrawal_rate, 1), "Morningstar, The State of Retirement Income"],
    ["Confidence target", pct(TARGET), "Project default"],
  ];
  const tbody = $("sources").querySelector("tbody");
  for (const r of rows) {
    const tr = el("tr");
    tr.append(el("td", {}, r[0]), el("td", {}, r[1]), el("td", {}, r[2]));
    tbody.append(tr);
  }
}

// ---------- run loop ----------
let timer = null, runId = 0, lastResult = null, lastPlan = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, 220);
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
  renderSsHint(inp);
  const res = simulate(inp, A);
  lastResult = res;
  renderAnswer(res);
  renderFan(res);
  renderTable(res);
  document.body.classList.add("updating");
  setTimeout(() => {
    if (id !== runId) return;
    const plan = buildPlan(inp, A, TARGET);
    if (id !== runId) return;
    lastPlan = plan;
    renderLevers(plan);
    renderFees(plan);
    renderPlan(plan);
    document.body.classList.remove("updating");
  }, 16);
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (lastResult) renderFan(lastResult);
    if (lastPlan) renderFees(lastPlan);
  }, 150);
});

$("print-plan")?.addEventListener("click", () => window.print());
window.addEventListener("beforeprint", () => { hideTip(); document.activeElement?.blur?.(); });
$("print-date").textContent = "Plan prepared " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

initSettings();
syncSettings();
renderSources();
fillStory();
run();
