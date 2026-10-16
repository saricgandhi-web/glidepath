import {
  DEFAULTS, SPENDING_FLOOR, atRetirement, buildPlan, claimingAdjustment, estimateAnnualBenefit, lowSpending,
  makeInputs, medianSpending, percentile, percentilePaths, retirementSpending, shortfallProbability, simulate,
  spendingPercentiles, sustainedWithdrawalRate,
} from "./engine.js";

// =====================================================================================
// Setup
// =====================================================================================
const A = JSON.parse(document.getElementById("assumptions").textContent);
let CASE = {};
try { CASE = JSON.parse(document.getElementById("case-study")?.textContent || "{}"); } catch { CASE = {}; }
const TARGET = A.benchmarks.target_success_probability;
const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const gsap = window.gsap;
const ST = window.ScrollTrigger;
const RB = window.ReactBits || {};
const motionOK = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const animate = Boolean(gsap) && motionOK;
if (gsap && ST) gsap.registerPlugin(ST);

const TABS = ["plan", "stress", "spending", "ss", "compare", "assumptions", "about"];
const RULE_NAMES = { fixed: "Fixed", guardrails: "Guardrails", percent: "Percent of portfolio" };

// ---------- formatting ----------
const money = (x) => "$" + Math.round(x).toLocaleString("en-US");
const pct = (x, d = 0) => (100 * x).toFixed(d).replace(/\.0+$/, "") + "%";
const pts = (x) => {
  const n = Math.abs(Math.round(100 * x));
  return (n === 0 ? "" : x > 0 ? "+" : "−") + n + (n === 1 ? " pt" : " pts");
};
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
function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function svg(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// =====================================================================================
// State
// =====================================================================================
const state = { ...DEFAULTS };
let spendingExplicit = false;
const current = { inp: null, res: null, plan: null };
let bState = null;          // Plan B overrides, filled on first visit to Compare
let ssShowCut = false;
let spendChartRule = null;  // which rule the spending chart shows

// =====================================================================================
// The sentence (hero inputs)
// =====================================================================================
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

story.spend.el.addEventListener("input", () => { spendingExplicit = true; });
for (const f of Object.values(story)) {
  f.el.addEventListener("input", () => { autosize(f.el); schedule(); });
  f.el.addEventListener("blur", () => {
    const v = f.parse(f.el.value);
    if (Number.isFinite(v)) { f.el.value = f.show(v); autosize(f.el); }
  });
}
$("story").addEventListener("submit", (e) => e.preventDefault());

// =====================================================================================
// Assumptions tab controls
// =====================================================================================
const FEE_NAMES = { diy_index: "Index funds", robo: "Robo-advisor", traditional: "Traditional advisor" };
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
      return `${label} has to be between ${pct(lo)} and ${pct(hi)} (Assumptions tab).`;
    }
    state[key] = v;
  }
  return null;
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
    ["Guardrails spending rule", "±20% band, 10% steps", "Guyton and Klinger (2006), simplified"],
    ["Confidence target", pct(TARGET), "Project default"],
  ];
  const tbody = $("sources").querySelector("tbody");
  tbody.textContent = "";
  for (const r of rows) {
    const tr = el("tr");
    r.forEach((c) => tr.append(el("td", {}, c)));
    tbody.append(tr);
  }
}

// =====================================================================================
// Charts (SVG, drawn by hand so the page needs no chart library)
// =====================================================================================
function scale(v, ticks = 4) {
  if (!(v > 0)) return { max: 1, step: 0.25 };
  const raw = v / ticks, exp = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((s) => s >= raw);
  return { max: Math.ceil(v / step) * step, step };
}
let clipSeq = 0;

// opts: { x: [ages], bands: [{lo, hi, fill}], lines: [{values, stroke, width, label}],
//         points: bool, vmark: {x, label}, hline: {y, label}, yFormat, yMin, yMax, height,
//         tip: (i) => ({title, value, rows: [[label, value]]}), animate: bool, ariaLabel }
function drawChart(host, opts) {
  host._chartOpts = opts;
  const W = Math.max(host.clientWidth || 0, 300);
  const H = opts.height ?? (W < 560 ? 250 : 330);
  const m = { l: 58, r: opts.endLabels ? 70 : 14, t: 18, b: 30 };
  const xs = opts.x;
  const all = [...(opts.bands || []).flatMap((b) => b.hi), ...(opts.lines || []).flatMap((l) => l.values)];
  if (opts.hline) all.push(opts.hline.y);
  const yMin = opts.yMin ?? 0;
  const span = scale(Math.max(...all) - yMin);
  const yMax = opts.yMax ?? yMin + span.max;
  const step = opts.yStep ?? (opts.yMax ? (opts.yMax - yMin) / 4 : span.step);
  const n = xs.length;
  const x = (i) => m.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const fmt = opts.yFormat || compact;

  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" });
  for (let v = yMin; v <= yMax + 1e-9; v += step) {
    s.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: "var(--rule)", "stroke-width": 1 }));
    s.append(svg("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, fmt(v)));
  }
  const every = opts.xEvery ?? (n > 50 ? 10 : n > 14 ? 5 : 1);
  xs.forEach((a, i) => {
    if ((opts.xEvery === 1 || a % every === 0) && x(i) < W - m.r - (opts.xLabel ? 30 : 0)) {
      s.append(svg("text", { x: x(i), y: H - 8, "text-anchor": "middle" }, String(a)));
    }
  });
  if (opts.xLabel) s.append(svg("text", { x: W - m.r, y: H - 8, "text-anchor": "end", class: "axis-label" }, opts.xLabel));

  const clipId = `clip-${++clipSeq}`;
  const defs = svg("defs");
  const clip = svg("clipPath", { id: clipId });
  const clipRect = svg("rect", { x: 0, y: 0, width: W, height: H });
  clip.append(clipRect);
  defs.append(clip);
  s.append(defs);
  const g = svg("g", { "clip-path": `url(#${clipId})` });
  for (const b of opts.bands || []) {
    const top = b.hi.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const bot = b.lo.map((v, i) => `${x(i)},${y(v)}`).reverse().join(" ");
    g.append(svg("polygon", { points: `${top} ${bot}`, fill: b.fill }));
  }
  s.append(g);
  if (opts.hline) {
    s.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(opts.hline.y), y2: y(opts.hline.y), stroke: "var(--brass)", "stroke-width": 2 }));
    if (opts.hline.label) s.append(svg("text", { x: W - m.r, y: y(opts.hline.y) - 6, "text-anchor": "end", class: "axis-label" }, opts.hline.label));
  }
  if (opts.vmark) {
    const vi = xs.indexOf(opts.vmark.x);
    if (vi >= 0) {
      s.append(svg("line", { x1: x(vi), x2: x(vi), y1: m.t, y2: H - m.b, stroke: "var(--brass)", "stroke-width": 2 }));
      s.append(svg("text", { x: x(vi) + 6, y: m.t + 10, class: "axis-label" }, opts.vmark.label));
    }
  }
  const lineEls = [];
  for (const l of opts.lines || []) {
    const p = svg("polyline", { points: l.values.map((v, i) => `${x(i)},${y(v)}`).join(" "), fill: "none",
      stroke: l.stroke, "stroke-width": l.width ?? 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
    s.append(p);
    lineEls.push(p);
    if (opts.points) {
      l.values.forEach((v, i) => s.append(svg("circle", { cx: x(i), cy: y(v), r: 4.5, fill: l.stroke, stroke: "var(--paper)", "stroke-width": 2 })));
    }
    if (opts.endLabels && l.label) {
      s.append(svg("text", { x: x(n - 1) + 8, y: y(l.values[n - 1]) + 4, class: "end-label" }, l.label));
    }
  }
  if (opts.highlight != null) {
    const hl = opts.highlight;
    s.append(svg("circle", { cx: x(hl.i), cy: y(hl.v), r: 8, fill: "none", stroke: "var(--brass)", "stroke-width": 2 }));
  }
  s.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(yMin), y2: y(yMin), stroke: "var(--rule-strong)", "stroke-width": 1 }));
  const cross = svg("line", { y1: m.t, y2: H - m.b, stroke: "var(--ink-3)", "stroke-width": 1, visibility: "hidden" });
  const dotLine = opts.lines?.[opts.dotIndex ?? 0];
  const dot = svg("circle", { r: 5, fill: dotLine?.stroke || "var(--green)", stroke: "var(--paper)", "stroke-width": 2, visibility: "hidden" });
  s.append(cross, dot);

  host.textContent = "";
  host.append(s);
  const tip = el("div", { class: "tooltip", hidden: "" });
  host.append(tip);
  if (opts.ariaLabel) host.setAttribute("aria-label", opts.ariaLabel);
  host._chart = { xs, x, y, W, m, cross, dot, tip, opts, idx: opts.startIndex ?? 0 };
  attachTips(host);

  if (opts.animate && animate) {
    gsap.fromTo(clipRect, { attr: { width: 0 } }, { attr: { width: W }, duration: 1.1, ease: "power2.out" });
    lineEls.forEach((p, k) => {
      const len = p.getTotalLength?.() || 0;
      if (!len) return;
      gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, {
        strokeDashoffset: 0, duration: 1.1, ease: "power2.out", delay: 0.08 * k,
        onComplete: () => { p.style.strokeDasharray = ""; p.style.strokeDashoffset = ""; },
      });
    });
  } else if (animate && opts.fade !== false) {
    gsap.fromTo(s, { opacity: 0.4 }, { opacity: 1, duration: 0.35, ease: "power1.out" });
  }
}

function showTip(host, i) {
  const c = host._chart;
  if (!c || !c.opts.tip) return;
  i = Math.max(0, Math.min(c.xs.length - 1, i));
  c.idx = i;
  const cx = c.x(i);
  const first = c.opts.lines?.[c.opts.dotIndex ?? 0];
  c.cross.setAttribute("x1", cx); c.cross.setAttribute("x2", cx); c.cross.setAttribute("visibility", "visible");
  if (first) { c.dot.setAttribute("cx", cx); c.dot.setAttribute("cy", c.y(first.values[i])); c.dot.setAttribute("visibility", "visible"); }
  const info = c.opts.tip(i);
  const t = c.tip;
  t.textContent = "";
  t.append(el("div", { class: "tt-age" }, info.title));
  if (info.value) t.append(el("strong", {}, info.value), el("div", {}, info.valueLabel || ""));
  for (const [label, value] of info.rows || []) {
    const row = el("div", { class: "tt-row" });
    row.append(el("span", {}, label), el("span", {}, value));
    t.append(row);
  }
  t.hidden = false;
  const sc = host.clientWidth / c.W;
  const left = cx * sc + 14, tw = t.offsetWidth;
  t.style.left = (left + tw > host.clientWidth ? Math.max(cx * sc - tw - 14, 0) : left) + "px";
  t.style.top = "6px";
}
function hideTip(host) {
  const c = host._chart;
  if (!c) return;
  c.tip.hidden = true;
  c.cross.setAttribute("visibility", "hidden");
  c.dot.setAttribute("visibility", "hidden");
}
function attachTips(host) {
  if (host._tipsAttached) return;
  host._tipsAttached = true;
  host.addEventListener("pointermove", (e) => {
    const c = host._chart;
    if (!c) return;
    const r = host.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * c.W;
    const frac = (px - c.m.l) / (c.W - c.m.l - c.m.r);
    showTip(host, Math.round(frac * (c.xs.length - 1)));
  });
  host.addEventListener("pointerleave", () => hideTip(host));
  host.addEventListener("focus", () => host._chart && showTip(host, host._chart.idx));
  host.addEventListener("blur", () => hideTip(host));
  host.addEventListener("keydown", (e) => {
    const c = host._chart;
    if (!c || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    e.preventDefault();
    showTip(host, c.idx + (e.key === "ArrowRight" ? 1 : -1));
  });
}

function growBars(nodes) {
  if (!animate || !nodes.length) return;
  gsap.fromTo(nodes, { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power3.out", stagger: 0.06 });
}

// =====================================================================================
// Hero answer
// =====================================================================================
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

let heroFirst = true;
function renderHero(res) {
  const p = res.successProbability;
  const fig = $("answer-figure");
  if (RB.countUp && animate) RB.countUp(fig, Math.round(p * 100), { duration: heroFirst ? 1.6 : 0.9, easing: "spring", from: heroFirst ? 0 : undefined });
  else fig.textContent = String(Math.round(p * 100));
  $("answer-text").textContent = `of simulated markets pay for every year of planned spending through age ${state.plan_to_age}.`;
  const st = statusFor(p);
  const status = $("status");
  status.textContent = "";
  status.append(statusIcon(st.icon, st.color), el("span", { class: "status-label" }, st.label),
    el("span", { class: "status-detail" }, `Median at retirement: ${words(atRetirement(res, 50))}. In a bad market: ${words(atRetirement(res, 10))}.`));
  const fill = $("meter-fill");
  fill.style.background = st.color;
  if (animate) gsap.to(fill, { width: Math.max(p * 100, 0.5) + "%", duration: heroFirst ? 1.4 : 0.6, ease: "power3.out", delay: heroFirst ? 0.5 : 0 });
  else fill.style.width = Math.max(p * 100, 0.5) + "%";
  $("meter-target").style.left = TARGET * 100 + "%";
  const badge = $("rule-badge");
  if (state.spending_rule !== "fixed") {
    badge.hidden = false;
    badge.textContent = "";
    badge.append("Spending rule: ", el("strong", {}, RULE_NAMES[state.spending_rule]), ". ");
    const link = el("a", { href: "#spending" }, "Compare rules");
    link.addEventListener("click", (e) => { e.preventDefault(); selectTab("spending"); });
    badge.append(link);
  } else badge.hidden = true;
  heroFirst = false;
}

// =====================================================================================
// Plan tab
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

async function renderPlanTab(id, firstTime) {
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
// Stress test tab
// =====================================================================================
function stressScenarios(inp) {
  const list = [
    { key: "crash", name: "A crash right after you retire", desc: "Returns of −25% and then −10% in your first two retirement years.", mod: { retirement_shock: [-0.25, -0.10] } },
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
  return list;
}

async function renderStressTab(id, firstTime) {
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
// Spending rules tab
// =====================================================================================
const ruleCache = { key: "", results: {} };
async function renderSpendingTab(id, firstTime) {
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
// Social Security tab
// =====================================================================================
async function renderSSTab(id, firstTime) {
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
$("ss-stress").addEventListener("change", (e) => { ssShowCut = e.target.checked; dirty.add("ss"); renderTab("ss", runId); });

// =====================================================================================
// Compare tab
// =====================================================================================
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
function syncBForm() {
  const f = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  f("b-retire", String(bState.retirement_age));
  f("b-rate", pct(bState.savings_rate, 1));
  f("b-spend", money(bState.retirement_spending));
  f("b-eq", String(Math.round(bState.equity_at_retirement * 100)));
  f("b-fee", pct(bState.total_fee, 2));
  $("b-rule").value = bState.spending_rule;
}
function readBForm() {
  const checks = [
    ["b-retire", parseAge, (v) => v > state.current_age && v < state.plan_to_age, "Plan B retirement age has to be after your current age and before the plan ends.", "retirement_age"],
    ["b-rate", parsePercent, (v) => v >= 0 && v <= 1, "Plan B savings rate has to be between 0% and 100%.", "savings_rate"],
    ["b-spend", parseMoney, (v) => v >= 0, "Enter Plan B spending as a yearly dollar amount.", "retirement_spending"],
    ["b-eq", (s) => parsePercent(s), (v) => v >= 0 && v <= 1, "Plan B stocks at retirement has to be between 0% and 100%.", "equity_at_retirement"],
    ["b-fee", parsePercent, (v) => v >= 0 && v <= 0.05, "Plan B fees have to be between 0% and 5%.", "total_fee"],
  ];
  for (const [id, parse, ok, msg, key] of checks) {
    const v = parse($(id).value);
    const good = Number.isFinite(v) && ok(v);
    $(id).setAttribute("aria-invalid", good ? "false" : "true");
    if (!good) return msg;
    bState[key] = v;
  }
  bState.spending_rule = $("b-rule").value;
  return null;
}
function bInputs() {
  const fund = Math.min(state.fund_fee, bState.total_fee);
  return makeInputs({ ...current.inp, retirement_age: bState.retirement_age, savings_rate: bState.savings_rate,
    retirement_spending: bState.retirement_spending, equity_at_retirement: bState.equity_at_retirement,
    fund_fee: fund, advisory_fee: Math.max(bState.total_fee - fund, 0), spending_rule: bState.spending_rule });
}

async function renderCompareTab(id, firstTime) {
  if (!bState) {
    bState = bFromA();
    bState.savings_rate = Math.min(0.75, Math.round((state.savings_rate + 0.03) * 1000) / 1000);
    syncBForm();
  }
  const err = readBForm();
  $("b-error").textContent = err || "";
  if (err) return true;
  await nextFrame();
  if (id !== runId) return false;
  const aRes = current.res;
  let bRes;
  try { bRes = simulate(bInputs(), A); } catch (e) { $("b-error").textContent = e.message; return true; }
  const signed = (d, text) => (d > 0 ? "+" : "−") + text;
  const dMoney = (d) => signed(d, money(Math.abs(d)));
  const metrics = [
    ["Chance money lasts", (r) => r.successProbability, (v) => pct(v), true, 0.005, (d) => pts(d)],
    ["Median at retirement", (r) => atRetirement(r, 50), money, true, 1, dMoney],
    ["Bad market at retirement (10th pct)", (r) => atRetirement(r, 10), money, true, 1, dMoney],
    ["Typical yearly spending in retirement", (r) => medianSpending(r), money, true, 1, dMoney],
    ["Median left at plan end", (r) => percentile(r.balances.at(-1), 50), money, true, 1, dMoney],
    ["Withdrawal rate once Social Security starts", (r) => sustainedWithdrawalRate(r), (v) => (Number.isFinite(v) ? pct(v, 1) : "n/a"), false,
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
    const dText = moved ? fmtDelta(d) : "same";
    tr.append(el("td", {}, label), el("td", {}, fmt(a)), el("td", {}, fmt(b)), el("td", { class: `delta ${good ? "up" : bad ? "down" : ""}` }, dText));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const ages = aRes.balances.map((_, t) => state.current_age + t);
  const a50 = percentilePaths(aRes, [50])[50], b50 = percentilePaths(bRes, [50])[50];
  drawChart($("compare-chart"), {
    x: ages, xLabel: "Age", animate: firstTime, endLabels: true, startIndex: state.retirement_age - state.current_age,
    lines: [{ values: a50, stroke: "var(--green)", label: "A" }, { values: b50, stroke: "var(--brass)", label: "B" }],
    tip: (i) => ({ title: `Age ${ages[i]}`, rows: [["Plan A median", money(a50[i])], ["Plan B median", money(b50[i])]] }),
  });
  return true;
}
for (const id of ["b-retire", "b-rate", "b-spend", "b-eq", "b-fee", "b-rule"]) {
  $(id).addEventListener(id === "b-rule" ? "change" : "input", () => {
    clearTimeout(bTimer);
    bTimer = setTimeout(() => { dirty.add("compare"); renderTab("compare", runId); }, 250);
  });
}
let bTimer = null;
$("b-form").addEventListener("submit", (e) => e.preventDefault());
$("b-reset").addEventListener("click", () => { bState = bFromA(); syncBForm(); dirty.add("compare"); renderTab("compare", runId); });
$("b-apply").addEventListener("click", () => {
  if (readBForm()) return;
  const fund = Math.min(state.fund_fee, bState.total_fee);
  Object.assign(state, { retirement_age: bState.retirement_age, savings_rate: bState.savings_rate, retirement_spending: bState.retirement_spending,
    equity_at_retirement: bState.equity_at_retirement, fund_fee: fund, advisory_fee: Math.max(bState.total_fee - fund, 0), spending_rule: bState.spending_rule });
  spendingExplicit = true;
  fillStory();
  syncSettings();
  selectTab("plan");
  schedule(0);
});

// =====================================================================================
// About tab
// =====================================================================================
let aboutReady = false;
function renderAbout() {
  if (aboutReady) return;
  aboutReady = true;
  const list = $("findings");
  const items = [];
  const wait = CASE.cost_of_waiting?.rows;
  if (wait) {
    const r = Object.fromEntries(wait.map((x) => [x.start_age, x.required_savings_rate]));
    items.push({ value: r[32] * 100, fmt: (v) => v.toFixed(1) + "%", title: "of income to save if you start ten years late",
      text: `For the same retirement goal, a saver who starts at 22 needs ${pct(r[22], 1)}. Starting at 42 takes ${pct(r[42], 1)}.` });
  }
  const fees = CASE.fees?.rows;
  if (fees) {
    const t = fees.find((x) => x.key === "traditional"), d = fees.find((x) => x.key === "diy_index");
    items.push({ value: t.cost_vs_lowest / 1000, fmt: (v) => "$" + Math.round(v) + "K", title: "lost to a 1.65% all-in advisory cost",
      text: `A 35-year-old's median wealth at retirement versus 0.05% index funds. The chance of success falls from ${pct(d.success_probability)} to ${pct(t.success_probability)}.` });
  }
  const o = CASE.outlook;
  if (o) {
    items.push({ value: Math.round((o.jpm_2026.success - o.vanguard_2026.success) * 100), fmt: (v) => "−" + Math.round(v) + " pts", title: "from planning on cautious market forecasts",
      text: `A new grad's plan succeeds ${pct(o.jpm_2026.success)} of the time on J.P. Morgan's forecasts and ${pct(o.vanguard_2026.success)} on Vanguard's.` });
  }
  const ss = CASE.social_security?.rows;
  if (ss) {
    const a62 = ss.find((x) => x.claim_age === 62), a70 = ss.find((x) => x.claim_age === 70);
    items.push({ value: Math.round((a70.success - a62.success) * 100), fmt: (v) => "+" + Math.round(v) + " pts", title: "from claiming Social Security at 70 instead of 62",
      text: `For a client retiring at 62. A benefit cut in 2034 would take that from ${pct(a70.success)} to ${pct(a70.success_with_haircut)}.` });
  }
  for (const it of items) {
    const li = el("li", { class: "finding" });
    const fig = el("div", { class: "finding-figure" }, it.fmt(it.value));
    const body = el("div");
    body.append(el("h3", {}, it.title), el("p", {}, it.text));
    li.append(fig, body);
    list.append(li);
    if (animate && ST && RB.countUp) {
      requestAnimationFrame(() => {
        if (li.getBoundingClientRect().top < window.innerHeight * 0.88) return; // already on screen: keep the final value
        fig.textContent = it.fmt(0);
        ST.create({ trigger: li, start: "top 88%", once: true, onEnter: () => RB.countUp(fig, it.value, { duration: 1.4, easing: "expo", from: 0, format: it.fmt }) });
      });
    }
  }
  if (RB.scrollReveal) RB.scrollReveal($("statement"), { baseOpacity: 0.12, enableBlur: true, blurStrength: 5, baseRotation: 2, wordAnimationEnd: "bottom 60%" });
}

// =====================================================================================
// Tabs
// =====================================================================================
const tablist = $("tablist");
const tabButtons = TABS.map((t) => $(`tab-${t}`));
const indicator = $("tab-indicator");
let activeTab = "plan";
const rendered = new Set();
const dirty = new Set(TABS);

function moveIndicator(btn, instant) {
  const cs = getComputedStyle(btn);
  const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
  const x = btn.offsetLeft + padL, w = btn.offsetWidth - padL - padR;
  if (animate && !instant) gsap.to(indicator, { x, width: w, duration: 0.45, ease: "power3.out" });
  else { indicator.style.transform = `translateX(${x}px)`; indicator.style.width = w + "px"; if (gsap) gsap.set(indicator, { x, width: w }); }
}

function selectTab(name, { focus = false, scroll = true, initial = false } = {}) {
  if (!TABS.includes(name)) name = "plan";
  const prev = activeTab;
  activeTab = name;
  tabButtons.forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const btn = $(`tab-${name}`);
  if (focus) btn.focus();
  // Keep the selected tab visible inside the (horizontally scrolling) tab list without moving the page.
  const left = btn.offsetLeft, right = left + btn.offsetWidth;
  if (left < tablist.scrollLeft) tablist.scrollTo({ left: Math.max(left - 16, 0), behavior: animate ? "smooth" : "auto" });
  else if (right > tablist.scrollLeft + tablist.clientWidth) tablist.scrollTo({ left: right - tablist.clientWidth + 32, behavior: animate ? "smooth" : "auto" });
  moveIndicator(btn, initial);
  for (const t of TABS) $(`panel-${t}`).hidden = t !== name;
  const panel = $(`panel-${name}`);
  if (animate && !initial && prev !== name) gsap.fromTo(panel, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: "power3.out" });
  if (!initial) {
    try { history.replaceState(null, "", "#" + name); } catch { /* sandboxed frames */ }
    if (scroll) {
      const bar = $("tabs");
      const top = bar.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.6 || top < -1) {
        const target = window.scrollY + top;
        if (lenis) lenis.scrollTo(target, { duration: 0.9 }); else window.scrollTo({ top: target, behavior: animate ? "smooth" : "auto" });
      }
    }
  }
  if (name === "about") renderAbout();
  if (name === "assumptions") dirty.delete("assumptions");
  if (current.res) renderTab(name, runId);
  if (ST) requestAnimationFrame(() => ST.refresh());
}

tabButtons.forEach((b, k) => {
  b.addEventListener("click", () => selectTab(b.dataset.tab));
  b.addEventListener("keydown", (e) => {
    let j = null;
    if (e.key === "ArrowRight") j = (k + 1) % TABS.length;
    else if (e.key === "ArrowLeft") j = (k - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = TABS.length - 1;
    if (j === null) return;
    e.preventDefault();
    selectTab(TABS[j], { focus: true, scroll: false });
  });
});
window.addEventListener("hashchange", () => {
  const t = (location.hash || "").replace("#", "");
  if (TABS.includes(t) && t !== activeTab) selectTab(t);
});
document.querySelectorAll("[data-tab-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); selectTab(a.dataset.tabLink); }));

const inflight = new Map();
async function renderTab(name, id) {
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
    if (name === "plan") done = await renderPlanTab(id, firstTime);
    else if (name === "stress") done = await renderStressTab(id, firstTime);
    else if (name === "spending") done = await renderSpendingTab(id, firstTime);
    else if (name === "ss") done = await renderSSTab(id, firstTime);
    else if (name === "compare") done = await renderCompareTab(id, firstTime);
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
let timer = null, runId = 0;
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
  renderHero(current.res);
  TABS.forEach((t) => dirty.add(t));
  dirty.delete("assumptions");
  dirty.delete("about");
  renderTab(activeTab, id);
}

// =====================================================================================
// Motion: Lenis smooth scrolling, the engraved Waves background, the intro sequence
// =====================================================================================
let lenis = null;
if (animate && window.Lenis) {
  try {
    lenis = new window.Lenis({ autoRaf: false, lerp: 0.12, smoothWheel: true, anchors: false });
    if (ST) lenis.on("scroll", ST.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  } catch (e) { lenis = null; }
}

const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
const isDark = () => {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : Boolean(darkQuery?.matches);
};
const wavesOptions = () => {
  const dark = isDark();
  return {
    lineColor: dark ? "#3f9d7e" : "#1f5c4a", accentColor: dark ? "#d8a943" : "#a47b1f",
    spacing: 12, lineWidth: 1, amplitude: 34, scale: 1.5, twist: 0.6, speed: motionOK ? 0.22 : 0,
    rotation: -12, mouseRadius: 180, mouseStrength: 0.9, opacity: dark ? 0.5 : 0.42, fade: 0.25,
    lightMode: !dark, intro: motionOK, clickRipple: motionOK, mouseInteraction: motionOK,
  };
};
let waves = null;
try { if (RB.mountWaves) waves = RB.mountWaves($("hero-bg"), wavesOptions()); } catch (e) { waves = null; }
darkQuery?.addEventListener?.("change", () => waves?.set(wavesOptions()));
new MutationObserver(() => waves?.set(wavesOptions())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

function intro() {
  document.documentElement.classList.remove("intro");
  if (!animate) return;
  const h1 = $("hero-title");
  if (RB.splitText) RB.splitText(h1, { splitType: "chars", delay: 26, duration: 1.15, effect: "rise", hoverEffect: "lift", trigger: "load" });
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.fromTo(".site-header", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 }, 0)
    .fromTo("#lede", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.45)
    .fromTo("#story", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.6)
    .fromTo("#answer", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.8)
    .fromTo("#tabs", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7 }, 1.0)
    .fromTo(".panels", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 1.05);
}

// =====================================================================================
// Boot
// =====================================================================================
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    moveIndicator($(`tab-${activeTab}`), true);
    for (const id of ["fan-chart", "seq-chart", "spend-chart", "ss-chart", "compare-chart"]) {
      const host = $(id);
      if (host._chartOpts && !host.closest("[hidden]")) drawChart(host, { ...host._chartOpts, animate: false, fade: false });
    }
    for (const f of Object.values(story)) autosize(f.el);
  }, 150);
});
$("print-plan")?.addEventListener("click", () => window.print());
window.addEventListener("beforeprint", () => { document.querySelectorAll(".chart").forEach(hideTip); document.activeElement?.blur?.(); });
$("print-date").textContent = "Plan prepared " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

initSettings();
syncSettings();
renderSources();
fillStory();
const startTab = (location.hash || "").replace("#", "");
selectTab(TABS.includes(startTab) ? startTab : "plan", { initial: true });
intro();
run();
document.fonts?.ready?.then(() => { for (const f of Object.values(story)) autosize(f.el); moveIndicator($(`tab-${activeTab}`), true); });
