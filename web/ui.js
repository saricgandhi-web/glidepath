// Shared helpers for every page: data, formatting, DOM and SVG builders, the chart renderer,
// the guilloché rosette and the motion settings.

// ---------- data ----------
export const A = JSON.parse(document.getElementById("assumptions").textContent);
let caseData = {};
try { caseData = JSON.parse(document.getElementById("case-study")?.textContent || "{}"); } catch { caseData = {}; }
export const CASE = caseData;
export const TARGET = A.benchmarks.target_success_probability;

// ---------- motion ----------
export const gsap = window.gsap;
export const ST = window.ScrollTrigger;
export const RB = window.ReactBits || {};
export const motionOK = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
export const animate = Boolean(gsap) && motionOK;
if (gsap && ST) gsap.registerPlugin(ST);
// Shared, mutable runtime handles (set by site.js).
export const runtime = { lenis: null };

export function scrollToY(y, { immediate = false, duration = 1.0 } = {}) {
  if (runtime.lenis) runtime.lenis.scrollTo(y, { immediate: immediate || !animate, duration, force: true });
  else window.scrollTo({ top: y, behavior: immediate || !animate ? "auto" : "smooth" });
}
export function scrollToEl(node, offset = -80) {
  if (!node) return;
  scrollToY(window.scrollY + node.getBoundingClientRect().top + offset);
}

// ---------- names ----------
export const RULE_NAMES = { fixed: "Fixed", guardrails: "Guardrails", percent: "Percent of portfolio" };
export const FEE_NAMES = { diy_index: "Index funds", robo: "Robo-advisor", traditional: "Traditional advisor" };

// ---------- formatting ----------
export const MINUS = "−";
export const money = (x) => (x < 0 ? MINUS : "") + "$" + Math.round(Math.abs(x)).toLocaleString("en-US");
export const pct = (x, d = 0) => (100 * x).toFixed(d).replace(/\.0+$/, "") + "%";
export const percentOrNA = (v) => (Number.isFinite(v) ? pct(v, 1) : "n/a");
export const pts = (x) => {
  const n = Math.abs(Math.round(100 * x));
  return (n === 0 ? "" : x > 0 ? "+" : MINUS) + n + (n === 1 ? " pt" : " pts");
};
export function compact(x) {
  const a = Math.abs(x);
  if (a >= 1e6) return "$" + (x / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  if (a >= 1e3) return "$" + Math.round(x / 1e3) + "K";
  return "$" + Math.round(x);
}
export function words(x) {
  if (x >= 1e6) return "$" + (x / 1e6).toFixed(2).replace(/0$/, "") + " million";
  return money(Math.round(x / 1000) * 1000);
}
export function parseMoney(s) {
  const t = String(s).trim().toLowerCase().replace(/[$,\s]/g, "");
  const m = t.match(/^(-?\d*\.?\d+)([km]?)$/);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
}
export function parsePercent(s) {
  const t = String(s).trim().replace(/[%\s]/g, "");
  return t === "" || isNaN(Number(t)) ? NaN : Number(t) / 100;
}
export function parseAge(s) {
  const t = String(s).trim();
  return /^\d{1,3}$/.test(t) ? Number(t) : NaN;
}

// ---------- DOM ----------
export const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
export function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
export function svg(tag, attrs = {}, text) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- status ----------
export function statusFor(p) {
  if (p >= TARGET) return { label: "On track", color: "var(--good)", icon: "check" };
  if (p >= 0.7) return { label: "Close", color: "var(--warning)", icon: "alert" };
  return { label: "At risk", color: "var(--critical)", icon: "cross" };
}
export function statusIcon(kind, color) {
  const s = svg("svg", { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": "true" });
  s.append(svg("circle", { cx: 9, cy: 9, r: 9, fill: color }));
  const d = { check: "M5 9.5l2.5 2.5L13 6.5", alert: "M9 4.5v5.5M9 13v.5", cross: "M6 6l6 6M12 6l-6 6" }[kind];
  s.append(svg("path", { d, stroke: kind === "alert" ? "#15241e" : "#fff", "stroke-width": 2, "stroke-linecap": "round", fill: "none" }));
  return s;
}

// =====================================================================================
// Charts (SVG, drawn by hand so the page needs no chart library)
// =====================================================================================
export function niceScale(v, ticks = 4) {
  if (!(v > 0)) return { max: 1, step: 0.25 };
  const raw = v / ticks, exp = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((s) => s >= raw);
  return { max: Math.ceil(v / step) * step, step };
}
let clipSeq = 0;

// opts: { x: [labels], bands: [{lo, hi, fill}], lines: [{values, stroke, width, label, dash}],
//         bars: {values, fill, highlight}, points, vmark: {x, label}, hline: {y, label},
//         yFormat, yMin, yMax, yStep, height, endLabels, xEvery, xLabel,
//         tip: (i) => ({title, value, valueLabel, rows}), animate, ariaLabel, startIndex }
export function drawChart(host, opts) {
  host._chartOpts = opts;
  const W = Math.max(host.clientWidth || 0, 280);
  const H = opts.height ?? (W < 560 ? 250 : 330);
  const m = { l: opts.marginLeft ?? 58, r: opts.endLabels ? 70 : 14, t: 18, b: 30 };
  const xs = opts.x;
  const all = [...(opts.bands || []).flatMap((b) => b.hi), ...(opts.lines || []).flatMap((l) => l.values), ...(opts.bars?.values || [])];
  if (opts.hline) all.push(opts.hline.y);
  const yMin = opts.yMin ?? 0;
  const span = niceScale(Math.max(...all) - yMin);
  const yMax = opts.yMax ?? yMin + span.max;
  const step = opts.yStep ?? (opts.yMax ? (opts.yMax - yMin) / 4 : span.step);
  const n = xs.length;
  const barMode = Boolean(opts.bars);
  const x = barMode
    ? (i) => m.l + ((i + 0.5) / n) * (W - m.l - m.r)
    : (i) => m.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const fmt = opts.yFormat || compact;

  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" });
  for (let v = yMin; v <= yMax + 1e-9; v += step) {
    s.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: "var(--rule)", "stroke-width": 1 }));
    s.append(svg("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, fmt(v)));
  }
  const every = opts.xEvery ?? (n > 50 ? 10 : n > 14 ? 5 : 1);
  xs.forEach((a, i) => {
    const show = opts.xEvery === 1 || barMode || (typeof a === "number" ? a % every === 0 : i % every === 0);
    // The last label sits flush with the plot's right edge, so anchor it at its end.
    const last = !barMode && i === n - 1;
    if (show && x(i) <= W - m.r - (opts.xLabel ? 30 : 0) + 0.5) {
      s.append(svg("text", { x: last ? x(i) + 4 : x(i), y: H - 8, "text-anchor": last ? "end" : "middle" }, String(a)));
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
  const barEls = [];
  if (barMode) {
    const bw = Math.min(56, ((W - m.l - m.r) / n) * 0.62);
    opts.bars.values.forEach((v, i) => {
      const hi = opts.bars.highlight?.(i);
      const r = svg("rect", { x: x(i) - bw / 2, y: y(v), width: bw, height: Math.max(y(yMin) - y(v), 0), rx: 3,
        fill: hi ? "var(--brass)" : opts.bars.fill || "var(--green)" });
      s.append(r);
      barEls.push(r);
      if (opts.bars.labels) s.append(svg("text", { x: x(i), y: y(v) - 7, "text-anchor": "middle", class: "bar-label" }, opts.bars.labels(i)));
    });
  }
  if (opts.hline) {
    s.append(svg("line", { x1: m.l, x2: W - m.r, y1: y(opts.hline.y), y2: y(opts.hline.y), stroke: "var(--brass)", "stroke-width": 2, "stroke-dasharray": opts.hline.dash || null }));
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
    if (l.dash) p.setAttribute("stroke-dasharray", l.dash);
    s.append(p);
    if (!l.dash) lineEls.push(p);
    if (opts.points) {
      l.values.forEach((v, i) => s.append(svg("circle", { cx: x(i), cy: y(v), r: 4.5, fill: l.stroke, stroke: "var(--chart-bg, var(--paper))", "stroke-width": 2 })));
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
  const dot = svg("circle", { r: 5, fill: dotLine?.stroke || "var(--green)", stroke: "var(--chart-bg, var(--paper))", "stroke-width": 2, visibility: "hidden" });
  s.append(cross, dot);

  host.textContent = "";
  host.append(s);
  const tip = el("div", { class: "tooltip", hidden: "" });
  host.append(tip);
  if (opts.ariaLabel) host.setAttribute("aria-label", opts.ariaLabel);
  host._chart = { xs, x, y, W, m, cross, dot, tip, opts, idx: opts.startIndex ?? 0, barMode };
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
    if (barEls.length) {
      gsap.fromTo(barEls, { scaleY: 0, transformOrigin: "50% 100%", transformBox: "fill-box" },
        { scaleY: 1, duration: 0.9, ease: "power3.out", stagger: 0.05 });
    }
  } else if (animate && opts.fade !== false) {
    gsap.fromTo(s, { opacity: 0.4 }, { opacity: 1, duration: 0.35, ease: "power1.out" });
  }
}

export function showTip(host, i) {
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
export function hideTip(host) {
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
    const n = c.xs.length;
    showTip(host, c.barMode ? Math.floor(frac * n) : Math.round(frac * (n - 1)));
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
export function redrawCharts(root = document) {
  root.querySelectorAll(".chart").forEach((host) => {
    if (host._chartOpts && !host.closest("[hidden]")) drawChart(host, { ...host._chartOpts, animate: false, fade: false });
  });
}

export function growBars(nodes) {
  if (!animate || !nodes.length) return;
  gsap.fromTo(nodes, { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power3.out", stagger: 0.06 });
}

// =====================================================================================
// Guilloché rosette: interlaced sine rings, the security pattern printed on banknotes
// and bond certificates. Draws into an <svg> and returns its paths.
// =====================================================================================
export function rosette(host, { size = 600, rings = [[0.92, 0.05, 18, 18], [0.74, 0.06, 13, 16], [0.56, 0.07, 9, 14], [0.38, 0.08, 7, 12]],
  steps = 540 } = {}) {
  if (!host) return [];
  const c = size / 2;
  host.setAttribute("viewBox", `0 0 ${size} ${size}`);
  host.setAttribute("aria-hidden", "true");
  host.textContent = "";
  const paths = [];
  // Each ring: [radius as share of half-size, amplitude share, lobes, strands]
  rings.forEach(([rad, amp, lobes, strands], ri) => {
    const g = svg("g", { class: `rosette-ring r${ri}` });
    for (let j = 0; j < strands; j++) {
      const phase = (2 * Math.PI * j) / strands;
      let d = "";
      for (let k = 0; k <= steps; k++) {
        const t = (2 * Math.PI * k) / steps;
        const r = c * (rad + amp * Math.sin(lobes * t + phase) + amp * 0.35 * Math.sin((lobes * 2 + 1) * t - phase));
        d += (k ? "L" : "M") + (c + r * Math.cos(t)).toFixed(1) + "," + (c + r * Math.sin(t)).toFixed(1);
      }
      const p = svg("path", { d: d + "Z", pathLength: 1 });
      g.append(p);
      paths.push(p);
    }
    host.append(g);
  });
  return paths;
}
