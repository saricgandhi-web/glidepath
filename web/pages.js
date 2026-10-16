// Insights (the case study, charted), How it works (method and sources) and About.
import {
  $, A, CASE, RB, ST, TARGET, animate, drawChart, el, gsap, money, pct, rosette, scrollToEl,
} from "./ui.js";

// A page helper: one gsap.context per visit, reverted when the visitor leaves.
function pageScope(rootId, setup) {
  let ctx = null;
  return {
    enter() { if (gsap) ctx = gsap.context(setup, $(rootId)); else setup(); },
    leave() { ctx?.revert(); ctx = null; },
  };
}
function tocFollow(navId) {
  if (!ST) return;
  const links = [...document.querySelectorAll(`#${navId} [data-scroll-to]`)];
  links.forEach((b) => {
    const target = $(b.dataset.scrollTo);
    if (!target) return;
    ST.create({ trigger: target, start: "top 45%", end: "bottom 45%",
      onToggle: (self) => { if (self.isActive) links.forEach((l) => l.toggleAttribute("aria-current", l === b)); } });
  });
}

// =====================================================================================
// Insights
// =====================================================================================
const CLIENTS = [
  { key: "maya", name: "Maya, 22", story: "New graduate earning $78,000 and saving 10%." },
  { key: "jordan", name: "Jordan, 35", story: "Earns $120,000 and pays a traditional advisor 1.65% a year, all in." },
  { key: "lee", name: "Lee, 52", story: "Has $650,000 saved and wants to retire at 62." },
];
let insightsBuilt = false;
function buildInsights() {
  if (insightsBuilt) return;
  insightsBuilt = true;
  const host = $("clients");
  const clients = CASE.clients || {};
  for (const c of CLIENTS) {
    const d = clients[c.key];
    if (!d) continue;
    const card = el("article", { class: "client" });
    card.append(el("h3", {}, c.name), el("p", { class: "client-story" }, c.story));
    const odds = el("div", { class: "client-odds" });
    odds.append(el("strong", {}, pct(d.success_probability)), el("span", {}, "chance of success today"));
    const dl = el("dl", { class: "client-facts" });
    for (const [k, v] of [["Median at retirement", money(d.median_at_retirement)], ["Savings rate for 85%", d.required_savings_rate === null ? "n/a" : pct(d.required_savings_rate, 1)],
      ["Sustainable spending at 85%", money(Math.round(d.max_spending / 10) * 10) + " a year"]]) {
      const row = el("div");
      row.append(el("dt", {}, k), el("dd", {}, v));
      dl.append(row);
    }
    card.append(odds, dl);
    host.append(card);
  }
  // Chapter figures and text come straight from the case-study results.
  const figure = (id, value, { prefix = "", suffix = "", decimals = 0 } = {}) => {
    const f = $(id);
    Object.assign(f.dataset, { value: String(value), prefix, suffix, decimals: String(decimals) });
    f.textContent = prefix + Number(value).toFixed(decimals) + suffix;
  };
  const wait = CASE.cost_of_waiting;
  if (wait) {
    const r = Object.fromEntries(wait.rows.map((x) => [x.start_age, x.required_savings_rate]));
    figure("cf-waiting", r[42] * 100, { suffix: "%", decimals: 1 });
    $("cp-waiting").textContent = `Holding the same spending goal (${money(wait.spending_goal)} a year), a saver who starts at 22 with nothing saved needs to set aside ${pct(r[22], 1)} of income to reach 85% confidence. Waiting until 32 raises that to ${pct(r[32], 1)}, and starting at 42 takes ${pct(r[42], 1)}.`;
  }
  const fees = CASE.fees?.rows;
  if (fees) {
    const t = fees.find((x) => x.key === "traditional"), d = fees.find((x) => x.key === "diy_index");
    figure("cf-fees", Math.round(t.cost_vs_lowest / 1000), { prefix: "$", suffix: "K" });
    $("cp-fees").textContent = `For Jordan, a ${pct(t.total_fee, 2)} all-in cost leaves a median ${money(t.median_at_retirement)} at retirement, versus ${money(d.median_at_retirement)} with ${pct(d.total_fee, 2)} index funds. The chance of success falls from ${pct(d.success_probability)} to ${pct(t.success_probability)}.`;
  }
  const o = CASE.outlook;
  if (o) {
    figure("cf-outlook", Math.round((o.jpm_2026.success - o.vanguard_2026.success) * 100), { prefix: "−", suffix: " pts" });
    $("cp-outlook").textContent = `On J.P. Morgan's base case, Maya's plan succeeds ${pct(o.jpm_2026.success)} of the time. On Vanguard's more cautious outlook it succeeds ${pct(o.vanguard_2026.success)} of the time, and the savings rate she needs rises from ${pct(o.jpm_2026.required_savings_rate, 1)} to ${pct(o.vanguard_2026.required_savings_rate, 1)}.`;
  }
  const ss = CASE.social_security?.rows;
  if (ss) {
    const a62 = ss.find((x) => x.claim_age === 62), a70 = ss.find((x) => x.claim_age === 70);
    figure("cf-ss", Math.round((a70.success - a62.success) * 100), { prefix: "+", suffix: " pts" });
    $("cp-ss").textContent = `Lee retires at 62. Claiming right away brings in ${money(a62.benefit)} a year; waiting until 70 brings in ${money(a70.benefit)}, and the chance of success rises from ${pct(a62.success)} to ${pct(a70.success)}. If benefits are cut to 83% in 2034, claiming at 70 still gives ${pct(a70.success_with_haircut)}.`;
  }
}
const insightCharts = {
  waiting() {
    const rows = CASE.cost_of_waiting?.rows || [];
    drawChart($("ch-waiting-chart"), {
      x: rows.map((r) => `Start at ${r.start_age}`), animate: true, height: 300, yFormat: (v) => pct(v), yMax: 0.5, yStep: 0.1,
      bars: { values: rows.map((r) => r.required_savings_rate), highlight: (i) => rows[i].start_age === 32, labels: (i) => pct(rows[i].required_savings_rate, 1) },
      ariaLabel: "Savings rate needed for 85% confidence by starting age: " + rows.map((r) => `${r.start_age}: ${pct(r.required_savings_rate, 1)}`).join(", "),
      tip: (i) => ({ title: `Start saving at ${rows[i].start_age}`, value: pct(rows[i].required_savings_rate, 1), valueLabel: "of income, to reach 85%" }),
    });
  },
  fees() {
    const rows = CASE.fees?.rows || [];
    const names = { diy_index: "Index funds", robo: "Robo-advisor", traditional: "Traditional advisor" };
    drawChart($("ch-fees-chart"), {
      x: rows.map((r) => names[r.key]), animate: true, height: 300, yFormat: (v) => "$" + (v / 1e6).toFixed(1) + "M",
      bars: { values: rows.map((r) => r.median_at_retirement), highlight: (i) => rows[i].key === "traditional", labels: (i) => "$" + (rows[i].median_at_retirement / 1e6).toFixed(2) + "M" },
      ariaLabel: "Median wealth at retirement by fee level: " + rows.map((r) => `${names[r.key]} ${money(r.median_at_retirement)}`).join(", "),
      tip: (i) => ({ title: `${names[rows[i].key]}, ${pct(rows[i].total_fee, 2)} a year`, value: money(rows[i].median_at_retirement), valueLabel: "median at retirement",
        rows: [["Chance of success", pct(rows[i].success_probability)], ["Cost versus index funds", money(rows[i].cost_vs_lowest)]] }),
    });
  },
  outlook() {
    const o = CASE.outlook;
    if (!o) return;
    const rows = [["J.P. Morgan 2026", o.jpm_2026], ["Vanguard (cautious)", o.vanguard_2026]];
    drawChart($("ch-outlook-chart"), {
      x: rows.map((r) => r[0]), animate: true, height: 280, yFormat: (v) => pct(v), yMax: 1, yStep: 0.25,
      bars: { values: rows.map((r) => r[1].success), highlight: (i) => i === 1, labels: (i) => pct(rows[i][1].success) },
      ariaLabel: `Chance of success: J.P. Morgan assumptions ${pct(o.jpm_2026.success)}, Vanguard ${pct(o.vanguard_2026.success)}.`,
      tip: (i) => ({ title: rows[i][0], value: pct(rows[i][1].success), valueLabel: "chance of success",
        rows: [["Savings rate for 85%", pct(rows[i][1].required_savings_rate, 1)], ["Sustainable spending", money(rows[i][1].max_spending)]] }),
    });
  },
  ss() {
    const rows = CASE.social_security?.rows || [];
    drawChart($("ch-ss-chart"), {
      x: rows.map((r) => r.claim_age), xEvery: 1, animate: true, points: true, height: 300, yMin: 0.3, yMax: 0.6, yStep: 0.1, yFormat: (v) => pct(v),
      lines: [{ values: rows.map((r) => r.success), stroke: "var(--green)" }, { values: rows.map((r) => r.success_with_haircut), stroke: "var(--brass)" }],
      ariaLabel: "Chance of success by Social Security claiming age, with and without a 2034 benefit cut.",
      tip: (i) => ({ title: `Claim at ${rows[i].claim_age}`, value: pct(rows[i].success), valueLabel: "chance of success",
        rows: [["With the 2034 cut", pct(rows[i].success_with_haircut)], ["Benefit", money(rows[i].benefit) + " a year"]] }),
    });
  },
};
export const insights = pageScope("page-insights", () => {
  buildInsights();
  for (const [key, draw] of Object.entries(insightCharts)) {
    const host = $(`ch-${key}-chart`);
    if (!host) continue;
    if (ST && animate) ST.create({ trigger: host, start: "top 85%", once: true, onEnter: draw });
    else draw();
  }
  if (ST && animate) {
    document.querySelectorAll("#page-insights .chapter-figure").forEach((f) => {
      const v = Number(f.dataset.value), d = Number(f.dataset.decimals || 0), pre = f.dataset.prefix || "", suf = f.dataset.suffix || "";
      ST.create({ trigger: f, start: "top 88%", once: true, onEnter: () => RB.countUp?.(f, v, { duration: 1.4, easing: "expo", from: 0, format: (x) => pre + x.toFixed(d) + suf }) });
    });
  }
  tocFollow("insights-toc");
});

// =====================================================================================
// How it works
// =====================================================================================
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
let methodBuilt = false;
export const method = pageScope("page-method", () => {
  if (!methodBuilt) {
    methodBuilt = true;
    renderSources();
    const j = A.markets.jpm_2026;
    $("m-equity").textContent = pct(j.equity_return, 1);
    $("m-bond").textContent = pct(j.bond_return, 1);
    $("m-infl").textContent = pct(j.inflation, 1);
  }
  if (ST && animate) {
    gsap.fromTo("#pipeline .pipe-step", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.1,
      scrollTrigger: { trigger: "#pipeline", start: "top 80%", once: true } });
    gsap.fromTo("#pipeline .pipe-link", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power2.out", stagger: 0.1, delay: 0.25,
      scrollTrigger: { trigger: "#pipeline", start: "top 80%", once: true } });
  }
  tocFollow("method-toc");
});

// =====================================================================================
// About
// =====================================================================================
export const about = pageScope("page-about", () => {
  if (RB.scrollReveal && animate) RB.scrollReveal($("about-statement"), { baseOpacity: 0.14, enableBlur: true, blurStrength: 5, baseRotation: 2, wordAnimationEnd: "bottom 65%" });
});

// Shared: rosettes on every page header, and in-page scroll buttons.
export function initPages() {
  document.querySelectorAll(".page-rosette").forEach((s) => rosette(s, { size: 520, rings: [[0.9, 0.05, 16, 16], [0.7, 0.06, 11, 14], [0.5, 0.07, 8, 12]] }));
  document.querySelectorAll(".page:not(#page-home) [data-scroll-to]").forEach((b) => b.addEventListener("click", () => scrollToEl($(b.dataset.scrollTo), -90)));
}
