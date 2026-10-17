// The home page: a live demo on a split-flap board, then the case for the planner told with
// the same engine running on an example saver.
import {
  atRetirement, compareFeeProfiles, earliestRetirementAge, makeInputs, maxSustainableSpending, percentilePaths,
  requiredSavingsRate, simulate,
} from "./engine.js";
import {
  $, A, CASE, MINUS, RB, ST, TARGET, animate, el, gsap, money, motionOK, nextFrame, pct, rosette, scrollToEl, svg, words,
} from "./ui.js";

// The example saver used everywhere on this page.
const SAMPLE = { current_age: 35, current_savings: 90000, annual_income: 110000, savings_rate: 0.12, retirement_spending: 75000, n_sims: 1500, seed: 7 };
const BASE_AGE = 62;
const BOARD_AGES = [58, 60, 62, 64, 65, 67];
const sampleAt = (mods = {}) => simulate(makeInputs({ ...SAMPLE, ...mods }), A);

let ready = false;
let ctx = null;          // gsap.context for this page's scroll-driven animation
let mm = null;           // gsap.matchMedia for layout-dependent animation
const cache = new Map(); // retirement age -> result

// =====================================================================================
// Hero: the split-flap board
// =====================================================================================
const board = { flapAge: null, flapOdds: null, scrub: null, age: BASE_AGE, timer: null, pausedUntil: 0, index: BOARD_AGES.indexOf(BASE_AGE), chart: null };

function boardResult(age) {
  if (!cache.has(age)) cache.set(age, sampleAt({ retirement_age: age }));
  return cache.get(age);
}

// One fixed scale for every age, so the chart morphs instead of rescaling.
const BW = 560, BH = 210, BM = { l: 8, r: 8, t: 10, b: 24 };
function boardGeometry(res) {
  const paths = percentilePaths(res, [10, 25, 50, 75, 90]);
  const n = paths[50].length;
  const x = (i) => BM.l + (i / (n - 1)) * (BW - BM.l - BM.r);
  const y = (v) => BM.t + (1 - Math.min(v, board.yMax) / board.yMax) * (BH - BM.t - BM.b);
  const band = (lo, hi) => hi.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ") + " " +
    lo.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse().join(" ");
  return {
    outer: band(paths[10], paths[90]), inner: band(paths[25], paths[75]),
    median: paths[50].map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "),
    x,
  };
}
function buildBoardChart() {
  const host = $("board-chart");
  const s = svg("svg", { viewBox: `0 0 ${BW} ${BH}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  const outer = svg("polygon", { class: "bc-outer" }), inner = svg("polygon", { class: "bc-inner" });
  const median = svg("polyline", { class: "bc-median", fill: "none" });
  const mark = svg("line", { class: "bc-mark", y1: BM.t, y2: BH - BM.b });
  const axis = svg("line", { class: "bc-axis", x1: BM.l, x2: BW - BM.r, y1: BH - BM.b, y2: BH - BM.b });
  s.append(outer, inner, axis, mark, median);
  const n = SAMPLE.current_age;
  for (const a of [35, 45, 55, 65, 75, 85, 95]) {
    const xi = BM.l + ((a - n) / (95 - n)) * (BW - BM.l - BM.r);
    s.append(svg("text", { x: xi, y: BH - 6, "text-anchor": a === 35 ? "start" : a === 95 ? "end" : "middle", class: "bc-tick" }, String(a)));
  }
  host.append(s);
  board.chart = { outer, inner, median, mark };
}
function showAge(age, { instant = false } = {}) {
  board.age = age;
  const res = boardResult(age);
  const p = Math.round(res.successProbability * 100);
  board.flapAge?.set(String(age), `Retire at ${age}`);
  board.flapOdds?.set(String(p), `${p} percent chance the money lasts`);
  if (!board.flapAge) { $("flap-age").textContent = age; $("flap-odds").textContent = p; }
  board.scrub?.set(age);
  $("board-verdict").textContent = p >= TARGET * 100 ? "On track" : p >= 70 ? "Close" : "At risk";
  $("board-verdict").dataset.tone = p >= TARGET * 100 ? "good" : p >= 70 ? "warn" : "bad";
  const g = boardGeometry(res);
  const xMark = g.x(age - SAMPLE.current_age).toFixed(1);
  const c = board.chart;
  if (animate && !instant) {
    gsap.to(c.outer, { attr: { points: g.outer }, duration: 0.9, ease: "power3.inOut" });
    gsap.to(c.inner, { attr: { points: g.inner }, duration: 0.9, ease: "power3.inOut" });
    gsap.to(c.median, { attr: { points: g.median }, duration: 0.9, ease: "power3.inOut" });
    gsap.to(c.mark, { attr: { x1: xMark, x2: xMark }, duration: 0.9, ease: "power3.inOut" });
  } else {
    c.outer.setAttribute("points", g.outer); c.inner.setAttribute("points", g.inner); c.median.setAttribute("points", g.median);
    c.mark.setAttribute("x1", xMark); c.mark.setAttribute("x2", xMark);
  }
}
function cycleBoard() {
  clearTimeout(board.timer);
  if (!motionOK) return;
  board.timer = setTimeout(() => {
    if (Date.now() >= board.pausedUntil && !document.hidden && !$("page-home").hidden) {
      board.index = (board.index + 1) % BOARD_AGES.length;
      showAge(BOARD_AGES[board.index]);
    }
    cycleBoard();
  }, 3400);
}
function initBoard() {
  // A fixed y-scale: the 90th percentile at its highest point across the ages the board can show.
  board.yMax = 0;
  for (const age of [55, 72]) {
    const p = percentilePaths(boardResult(age), [90])[90];
    board.yMax = Math.max(board.yMax, ...p);
  }
  board.yMax *= 0.82;
  buildBoardChart();
  if (RB.splitFlap) {
    board.flapAge = RB.splitFlap($("flap-age"), { width: 2, charset: "numeric", flipsPerChar: 6, stagger: 0.07, align: "right" });
    board.flapOdds = RB.splitFlap($("flap-odds"), { width: 3, charset: "numeric", flipsPerChar: 9, stagger: 0.06, align: "right" });
  }
  if (RB.scrubField) {
    board.scrub = RB.scrubField($("board-scrub"), {
      label: "Retire at", min: 55, max: 72, step: 1, sensitivity: 10, value: BASE_AGE, id: "board-age",
      format: (v) => String(Math.round(v)),
      onChange: (v) => { board.pausedUntil = Date.now() + 15000; if (v !== board.age) showAge(v); },
    });
  }
  $("board").addEventListener("pointerenter", () => { board.pausedUntil = Date.now() + 8000; });
  showAge(BASE_AGE, { instant: true });
}

// =====================================================================================
// Ribbon of facts that drifts with scroll velocity
// =====================================================================================
function star() {
  const s = svg("svg", { viewBox: "0 0 20 20", class: "ribbon-star", "aria-hidden": "true" });
  s.append(svg("path", { d: "M10 1.5c.9 4.6 3.9 7.6 8.5 8.5-4.6.9-7.6 3.9-8.5 8.5-.9-4.6-3.9-7.6-8.5-8.5 4.6-.9 7.6-3.9 8.5-8.5z" }));
  return s;
}
function initRibbon() {
  const facts = ["5,000 simulated markets", "Free, with no sign-up", "Nothing leaves your browser", "Open source on GitHub",
    "Assumptions from J.P. Morgan, Vanguard, the SSA and the IRS", "Stress tests, spending rules and Social Security timing"];
  const row = el("span", { class: "ribbon-row" });
  for (const f of facts) { row.append(el("span", { class: "ribbon-item" }, f), star()); }
  const host = $("ribbon");
  if (RB.scrollVelocity && motionOK) {
    RB.scrollVelocity(host, { rows: [row], velocity: 36, numCopies: 3, mapping: { input: [0, 1000], output: [0, 3] }, skewWithVelocity: 4 });
    host.setAttribute("aria-label", facts.join(". "));
  } else {
    host.append(row);
  }
}

// =====================================================================================
// The questions an advisor would ask, answered for the example saver
// =====================================================================================
const QV = 320, QH = 150;
function qSvg(host) {
  const s = svg("svg", { viewBox: `0 0 ${QV} ${QH}`, "aria-hidden": "true", class: "q-svg" });
  host.textContent = "";
  host.append(s);
  return s;
}
function qLine(values, yMax, cls) {
  const n = values.length;
  const pts = values.map((v, i) => `${(6 + (i / (n - 1)) * (QV - 12)).toFixed(1)},${(8 + (1 - Math.min(v, yMax) / yMax) * (QH - 24)).toFixed(1)}`).join(" ");
  return svg("polyline", { points: pts, class: cls, fill: "none" });
}
function qBand(lo, hi, yMax, cls) {
  const n = hi.length;
  const p = (v, i) => `${(6 + (i / (n - 1)) * (QV - 12)).toFixed(1)},${(8 + (1 - Math.min(v, yMax) / yMax) * (QH - 24)).toFixed(1)}`;
  return svg("polygon", { points: hi.map(p).join(" ") + " " + lo.map(p).reverse().join(" "), class: cls });
}
function qBars(host, items, fmt) {
  const s = qSvg(host);
  const max = Math.max(...items.map((d) => d.v));
  const bh = 22, gap = 18, top = (QH - items.length * bh - (items.length - 1) * gap) / 2;
  items.forEach((d, i) => {
    const y = top + i * (bh + gap);
    const w = Math.max(4, (d.v / max) * (QV - 130));
    s.append(svg("text", { x: 0, y: y - 5, class: "q-label" }, d.label));
    const r = svg("rect", { x: 0, y, width: w, height: bh - 6, rx: 3, class: d.hi ? "q-bar hi" : "q-bar" });
    s.append(r, svg("text", { x: w + 8, y: y + bh - 10, class: "q-value" }, fmt(d.v)));
  });
}
function qDots(host, values, labels, best) {
  const s = qSvg(host);
  const lo = Math.min(...values) - 0.04, hi = Math.max(...values) + 0.04;
  const n = values.length;
  const x = (i) => 14 + (i / (n - 1)) * (QV - 28), y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (QH - 40);
  s.append(svg("polyline", { points: values.map((v, i) => `${x(i)},${y(v)}`).join(" "), class: "q-line", fill: "none" }));
  values.forEach((v, i) => {
    s.append(svg("circle", { cx: x(i), cy: y(v), r: i === best ? 6 : 3.5, class: i === best ? "q-dot hi" : "q-dot" }));
    s.append(svg("text", { x: x(i), y: QH - 6, "text-anchor": "middle", class: "q-tick" }, labels[i]));
  });
}
let questionsBuilt = false;
async function buildQuestions() {
  if (questionsBuilt) return;
  questionsBuilt = true;
  const base = boardResult(BASE_AGE);
  const p0 = base.successProbability;
  const paths = percentilePaths(base);
  const yMax = Math.max(...paths[90]) * 0.85;
  const inp = makeInputs({ ...SAMPLE, retirement_age: BASE_AGE });

  // Am I saving enough?
  {
    const s = qSvg($("qv-overview"));
    s.append(qBand(paths[10], paths[90], yMax, "q-band"), qBand(paths[25], paths[75], yMax, "q-band2"), qLine(paths[50], yMax, "q-line"));
    await nextFrame();
    const rate = requiredSavingsRate(inp, A, TARGET);
    $("qa-overview").textContent = `Saving 12% of income funds every year of retirement in ${pct(p0)} of simulated markets. ` +
      (rate === null ? "Saving more alone won't reach 85%." : `Saving ${pct(Math.ceil(rate * 1000) / 1000, 1)} gets to ${pct(TARGET)}.`);
  }
  await nextFrame();
  // A crash the year you retire
  {
    const crash = sampleAt({ retirement_age: BASE_AGE, retirement_shock: [-0.25, -0.10] });
    const c50 = percentilePaths(crash, [50])[50];
    const s = qSvg($("qv-stress"));
    s.append(qLine(paths[50], yMax, "q-line"), qLine(c50, yMax, "q-line brass"));
    $("qa-stress").textContent = `Returns of ${MINUS}25% and ${MINUS}10% in the first two years of retirement take the odds from ${pct(p0)} to ${pct(crash.successProbability)}.`;
  }
  await nextFrame();
  // Spending rules
  {
    const g = sampleAt({ retirement_age: BASE_AGE, spending_rule: "guardrails" });
    const pr = sampleAt({ retirement_age: BASE_AGE, spending_rule: "percent" });
    qBars($("qv-spending"), [{ label: "Fixed", v: p0 }, { label: "Guardrails", v: g.successProbability, hi: true }, { label: "Percent of portfolio", v: pr.successProbability }], (v) => pct(v));
    $("qa-spending").textContent = `Trimming spending 10% in bad years (guardrails) lifts the odds from ${pct(p0)} to ${pct(g.successProbability)}.`;
  }
  await nextFrame();
  // Social Security timing
  {
    const ages = [62, 63, 64, 65, 66, 67, 68, 69, 70];
    const vals = [];
    for (const a of ages) { vals.push(sampleAt({ retirement_age: BASE_AGE, ss_claim_age: a }).successProbability); await nextFrame(); }
    const best = vals.indexOf(Math.max(...vals));
    qDots($("qv-ss"), vals, ages.map(String), best);
    $("qa-ss").textContent = `Claiming at ${ages[best]} gives the best odds, ${pct(vals[best])}, versus ${pct(vals[0])} at 62 and ${pct(vals[5])} at 67.`;
  }
  await nextFrame();
  // Fees
  {
    const rows = compareFeeProfiles(inp, A);
    qBars($("qv-fees"), rows.map((r, i) => ({ label: ["Index funds", "Robo-advisor", "Traditional advisor"][i], v: r.medianAtRetirement, hi: i === 2 })),
      (v) => "$" + (v / 1e6).toFixed(2) + "M");
    const t = rows[rows.length - 1];
    $("qa-fees").textContent = `A ${pct(t.totalFee, 2)} all-in advisory cost leaves about ${words(t.costVsLowest)} less at retirement than index funds.`;
  }
  await nextFrame();
  // Work two more years
  {
    const b = boardResult(BASE_AGE + 2);
    const b50 = percentilePaths(b, [50])[50];
    const s = qSvg($("qv-compare"));
    s.append(qLine(paths[50], yMax, "q-line"), qLine(b50, yMax, "q-line brass"));
    $("qa-compare").textContent = `Retiring at ${BASE_AGE + 2} instead of ${BASE_AGE}: ${pct(b.successProbability)} instead of ${pct(p0)}, with ${words(atRetirement(b, 50))} at the start of retirement.`;
  }
}

// =====================================================================================
// How it works: real simulated lifetimes, drawn as you scroll
// =====================================================================================
const PW = 640, PH = 380, PM = { l: 10, r: 10, t: 12, b: 30 };
let stageBuilt = false, leversBuilt = false;
function buildStage() {
  if (stageBuilt) return;
  stageBuilt = true;
  const res = boardResult(BASE_AGE);
  const host = $("stage-paths");
  host.setAttribute("viewBox", `0 0 ${PW} ${PH}`);
  const T = res.balances.length;
  const n = res.balances[0].length;
  const peak = percentilePaths(res, [90])[90];
  const yMax = Math.max(...peak) * 0.9;
  const x = (t) => PM.l + (t / (T - 1)) * (PW - PM.l - PM.r);
  const y = (v) => PM.t + (1 - Math.min(v, yMax * 1.4) / yMax) * (PH - PM.t - PM.b);
  const clipId = "stage-clip";
  const defs = svg("defs");
  const clip = svg("clipPath", { id: clipId });
  clip.append(svg("rect", { x: 0, y: PM.t, width: PW, height: PH - PM.t - PM.b }));
  defs.append(clip);
  host.append(defs);
  const g = svg("g", { "clip-path": `url(#${clipId})`, class: "stage-lines" });
  const COUNT = 90;
  const lines = [];
  for (let k = 0; k < COUNT; k++) {
    const i = Math.floor((k * n) / COUNT);
    const pts = [];
    for (let t = 0; t < T; t++) pts.push(`${x(t).toFixed(1)},${y(res.balances[t][i]).toFixed(1)}`);
    const p = svg("polyline", { points: pts.join(" "), class: res.success[i] ? "path ok" : "path short", fill: "none", pathLength: 1 });
    g.append(p);
    lines.push(p);
  }
  host.append(g);
  const ri = BASE_AGE - SAMPLE.current_age;
  host.append(svg("line", { x1: x(ri), x2: x(ri), y1: PM.t, y2: PH - PM.b, class: "stage-mark" }));
  host.append(svg("text", { x: x(ri) + 6, y: PM.t + 12, class: "stage-tick" }, `Retire at ${BASE_AGE}`));
  const med = percentilePaths(res, [50])[50];
  const median = svg("polyline", { points: med.map((v, t) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" "), class: "stage-median", fill: "none", pathLength: 1 });
  host.append(median);
  host.append(svg("line", { x1: PM.l, x2: PW - PM.r, y1: PH - PM.b, y2: PH - PM.b, class: "stage-axis" }));
  for (const a of [35, 45, 55, 65, 75, 85, 95]) {
    host.append(svg("text", { x: x(a - SAMPLE.current_age), y: PH - 8, "text-anchor": a === 35 ? "start" : a === 95 ? "end" : "middle", class: "stage-tick" }, String(a)));
  }
  const short = res.success.filter((s) => !s).length / n;
  $("stage-legend").textContent = `Each line is one simulated lifetime. Green lines pay for every year of retirement; brass lines run out of money (${pct(short)} of all 1,500).`;
  board.stage = { lines, median };
}
async function buildLevers() {
  if (leversBuilt) return;
  leversBuilt = true;
  await nextFrame();
  const inp = makeInputs({ ...SAMPLE, retirement_age: BASE_AGE });
  const rate = requiredSavingsRate(inp, A, TARGET);
  await nextFrame();
  const spend = maxSustainableSpending(inp, A, TARGET);
  await nextFrame();
  const age = earliestRetirementAge(inp, A, TARGET);
  const list = $("stage-levers-list");
  list.textContent = "";
  const add = (main, sub) => { const li = el("li"); li.append(el("strong", {}, main), el("span", {}, sub)); list.append(li); };
  if (rate !== null) add(`Save ${pct(Math.ceil(rate * 1000) / 1000, 1)} of income`, "instead of 12%");
  add(`Spend ${money(Math.floor(spend / 100) * 100)} a year`, "instead of $75,000");
  if (age !== null) add(`Retire at ${age}`, `instead of ${BASE_AGE}`);
  $("stage-levers-title").textContent = `Any one of these reaches ${pct(TARGET)}:`;
}

// =====================================================================================
// Case-study findings
// =====================================================================================
export function findingItems() {
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
    items.push({ value: Math.round((o.jpm_2026.success - o.vanguard_2026.success) * 100), fmt: (v) => MINUS + Math.round(v) + " pts", title: "from planning on cautious market forecasts",
      text: `A new grad's plan succeeds ${pct(o.jpm_2026.success)} of the time on J.P. Morgan's forecasts and ${pct(o.vanguard_2026.success)} on Vanguard's.` });
  }
  const ss = CASE.social_security?.rows;
  if (ss) {
    const a62 = ss.find((x) => x.claim_age === 62), a70 = ss.find((x) => x.claim_age === 70);
    items.push({ value: Math.round((a70.success - a62.success) * 100), fmt: (v) => "+" + Math.round(v) + " pts", title: "from claiming Social Security at 70 instead of 62",
      text: `For a client retiring at 62. A benefit cut in 2034 would take that from ${pct(a70.success)} to ${pct(a70.success_with_haircut)}.` });
  }
  return items;
}
function buildFindings() {
  const list = $("findings");
  for (const it of findingItems()) {
    const li = el("li", { class: "finding" });
    const fig = el("div", { class: "finding-figure" }, it.fmt(it.value));
    fig._item = it;
    const body = el("div");
    body.append(el("h3", {}, it.title), el("p", {}, it.text));
    li.append(fig, body);
    list.append(li);
  }
}

// =====================================================================================
// FAQ: details elements that open and close with a height animation
// =====================================================================================
export function initFaq() {
  document.querySelectorAll(".faq-item").forEach((d) => {
    if (d.dataset.faq) return;
    d.dataset.faq = "1";
    const summary = d.querySelector("summary"), body = d.querySelector(".faq-body");
    summary.addEventListener("click", (e) => {
      if (!animate) return;
      e.preventDefault();
      if (d.open) {
        gsap.to(body, { height: 0, opacity: 0, duration: 0.35, ease: "power2.inOut", onComplete: () => { d.open = false; gsap.set(body, { clearProps: "height,opacity" }); } });
      } else {
        d.open = true;
        gsap.fromTo(body, { height: 0, opacity: 0 }, { height: "auto", opacity: 1, duration: 0.45, ease: "power3.out", onComplete: () => gsap.set(body, { clearProps: "height" }) });
      }
      d.classList.toggle("is-open", !d.classList.contains("is-open"));
    });
  });
}

// =====================================================================================
// Scroll-driven animation (created on enter, reverted on leave)
// =====================================================================================
function countUp(fig, opts) {
  if (!RB.countUp || !animate) return;
  const it = fig._item;
  RB.countUp(fig, opts?.value ?? it.value, { duration: 1.4, easing: "expo", from: 0, format: opts?.format ?? it.fmt });
}
function setupScroll() {
  if (!gsap || !ST) return;
  ctx = gsap.context(() => {
    // Statement and ledger
    if (RB.scrollReveal && animate) RB.scrollReveal($("statement"), { baseOpacity: 0.14, enableBlur: true, blurStrength: 5, baseRotation: 2, wordAnimationEnd: "bottom 62%" });
    if (animate) {
      ST.create({ trigger: "#ledger", start: "top 80%", once: true, onEnter: () => {
        document.querySelectorAll(".ledger-figure").forEach((f) => {
          const v = Number(f.dataset.value), d = Number(f.dataset.decimals || 0), suffix = f.dataset.suffix || "";
          if (RB.countUp) RB.countUp(f, v, { duration: 1.6, easing: "expo", from: 0, format: (x) => x.toFixed(d) + suffix });
        });
        gsap.fromTo(".ledger-bar span", { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: "power3.out", stagger: 0.12 });
      } });
      // Findings count up when they arrive
      document.querySelectorAll("#findings .finding-figure").forEach((fig) => {
        ST.create({ trigger: fig, start: "top 88%", once: true, onEnter: () => countUp(fig) });
      });
      // Questions: build their visuals just before they scroll into view
      ST.create({ trigger: "#questions", start: "top bottom+=400", once: true, onEnter: () => buildQuestions() });
      ST.create({ trigger: "#how", start: "top bottom+=600", once: true, onEnter: () => buildLevers() });
    } else {
      buildQuestions();
      buildLevers();
    }
  }, $("page-home"));

  mm = gsap.matchMedia();
  mm.add({ wide: "(min-width: 960px) and (min-height: 640px)", motion: "(prefers-reduced-motion: no-preference)" }, (c) => {
    const { wide, motion } = c.conditions;
    if (!wide || !motion) return undefined;
    // Questions: a horizontal track that moves while the page scrolls.
    const track = $("q-track"), viewport = $("q-viewport");
    const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
    $("questions").classList.add("is-pinned");
    gsap.to(track, {
      x: () => -distance(), ease: "none",
      scrollTrigger: { trigger: "#questions", start: "top top", end: () => "+=" + distance(), pin: true, scrub: 0.8, invalidateOnRefresh: true,
        onUpdate: (self) => { $("q-progress").style.transform = `scaleX(${self.progress.toFixed(3)})`; } },
    });
    // How it works: three steps over one pinned stage.
    $("how").classList.add("is-pinned");
    const steps = gsap.utils.toArray("#steps .step");
    const tl = gsap.timeline({ scrollTrigger: { trigger: "#how", start: "top top", end: "+=2400", pin: true, scrub: 0.6 } });
    tl.set(steps, { opacity: 0.32 }, 0).set(steps[0], { opacity: 1 }, 0)
      .fromTo("#stage-sentence .val", { backgroundColor: "rgba(164,123,31,0)" }, { backgroundColor: "rgba(164,123,31,0.22)", stagger: 0.04, duration: 0.08 }, 0.02)
      .to(steps[0], { opacity: 0.32, duration: 0.04 }, 0.3).to(steps[1], { opacity: 1, duration: 0.04 }, 0.3)
      .to("#stage-sentence", { autoAlpha: 0, y: -20, scale: 0.96, duration: 0.1 }, 0.3)
      .fromTo("#stage-paths .path", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.3, stagger: { each: 0.002 } }, 0.36)
      .fromTo("#stage-paths .stage-median", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.1 }, 0.62)
      .fromTo("#stage-legend", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.06 }, 0.62)
      .to(steps[1], { opacity: 0.32, duration: 0.04 }, 0.72).to(steps[2], { opacity: 1, duration: 0.04 }, 0.72)
      .to("#stage-paths .stage-lines", { opacity: 0.35, duration: 0.08 }, 0.72)
      .fromTo("#stage-levers", { autoAlpha: 0, x: 30 }, { autoAlpha: 1, x: 0, duration: 0.1 }, 0.74)
      .fromTo("#stage-levers li", { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, stagger: 0.04, duration: 0.06 }, 0.78)
      .to({}, { duration: 0.08 });
    return () => { $("questions").classList.remove("is-pinned"); $("how").classList.remove("is-pinned"); gsap.set(track, { x: 0 }); };
  });
}

// =====================================================================================
// Page lifecycle
// =====================================================================================
function init() {
  if (ready) return;
  ready = true;
  rosette($("hero-rosette"), { size: 640 });
  rosette($("cta-rosette"), { size: 300, rings: [[0.62, 0.06, 12, 14], [0.44, 0.07, 9, 12], [0.28, 0.08, 7, 10]] });
  initBoard();
  buildStage();
  initRibbon();
  buildFindings();
  if (RB.circularText) RB.circularText($("seal"), { text: "FREE AND OPEN SOURCE ✦ RUNS IN YOUR BROWSER ✦ ", spinDuration: 28, onHover: "speedUp", draggable: true, label: "Free and open source. Runs in your browser." });
  document.querySelectorAll("[data-scroll-to]").forEach((b) => b.addEventListener("click", () => scrollToEl($(b.dataset.scrollTo), 0)));
  document.querySelectorAll(".q-card").forEach((card) => RB.spotlight?.(card, { color: "#d6ae52", intensity: 0.14, size: 320, borderGlow: 0.8, proximity: 120 }));
}

export function homeIntro() {
  if (!animate) return;
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  const h1 = $("hero-title");
  if (RB.splitText) RB.splitText(h1, { splitType: "chars", delay: 24, duration: 1.1, effect: "rise", hoverEffect: "lift", trigger: "load" });
  tl.fromTo("#hero-lede", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.35)
    .fromTo("#hero-ctas > *", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08 }, 0.5)
    .fromTo("#hero-fine", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 }, 0.75)
    .fromTo("#board", { autoAlpha: 0, y: 30, rotateX: 8 }, { autoAlpha: 1, y: 0, rotateX: 0, duration: 1.1 }, 0.4);
  const paths = $("hero-rosette").querySelectorAll("path");
  tl.fromTo(paths, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 2.4, ease: "power2.inOut", stagger: 0.01 }, 0.1);
}

export const home = {
  enter({ initial = false } = {}) {
    init();
    setupScroll();
    if (!initial) showAge(board.age, { instant: true });
    cycleBoard();
  },
  leave() {
    clearTimeout(board.timer);
    ctx?.revert(); ctx = null;
    mm?.revert(); mm = null;
  },
};
