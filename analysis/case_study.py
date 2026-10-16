"""Reproduce every number and chart in docs/CASE_STUDY.md.

    python analysis/case_study.py

Writes docs/results.json, docs/images/*.png and docs/CASE_STUDY.md.
All clients are hypothetical; all dollar figures are in today's dollars.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import FuncFormatter, PercentFormatter  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from planner import assumptions as A  # noqa: E402
from planner.fees import compare_fee_profiles, share_of_wealth_lost  # noqa: E402
from planner.model import PlanInputs, simulate  # noqa: E402
from planner.solvers import max_sustainable_spending, required_savings_rate  # noqa: E402

DOCS = ROOT / "docs"
IMG = DOCS / "images"
SIMS = 10_000
TARGET = A.benchmarks()["target_success_probability"]

GREEN, BRASS, INK, INK2, INK3, RULE, PAPER = "#0f7a5c", "#a47b1f", "#15241e", "#44544d", "#6b7a73", "#d8dfda", "#f4f6f3"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 11, "axes.edgecolor": RULE, "axes.labelcolor": INK2,
    "xtick.color": INK3, "ytick.color": INK3, "axes.spines.top": False, "axes.spines.right": False,
    "axes.spines.left": False, "axes.grid": True, "axes.grid.axis": "y", "grid.color": RULE, "grid.linewidth": 0.8, "axes.axisbelow": True,
    "figure.facecolor": "white", "axes.facecolor": "white", "axes.titleweight": "bold", "axes.titlesize": 13,
    "axes.titlecolor": INK, "axes.titlelocation": "left",
})
dollars = FuncFormatter(lambda v, _: f"${v / 1e6:.1f}M" if abs(v) >= 1e6 else (f"${v / 1e3:.0f}K" if v else "$0"))

# ---------- hypothetical clients ----------
MAYA = PlanInputs(current_age=22, current_savings=5_000, annual_income=78_000, savings_rate=0.10, n_sims=SIMS)
JORDAN = PlanInputs(current_age=35, current_savings=90_000, annual_income=120_000, savings_rate=0.12,
                    advisory_fee=0.01, fund_fee=0.0065, n_sims=SIMS)
LEE = PlanInputs(current_age=52, retirement_age=62, current_savings=650_000, annual_income=160_000, savings_rate=0.15,
                 retirement_spending=95_000, equity_now=0.7, equity_at_retirement=0.5, n_sims=SIMS)


def save(fig, name: str) -> str:
    IMG.mkdir(parents=True, exist_ok=True)
    path = IMG / name
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)
    return f"images/{name}"


def money(x: float) -> str:
    return f"${x:,.0f}"


def fan_chart(res, title: str, name: str) -> str:
    p = res.percentile_paths()
    fig, ax = plt.subplots(figsize=(9, 4.2))
    ax.fill_between(res.ages, p[10], p[90], color=GREEN, alpha=0.13, lw=0, label="80% of outcomes")
    ax.fill_between(res.ages, p[25], p[75], color=GREEN, alpha=0.28, lw=0, label="Middle 50%")
    ax.plot(res.ages, p[50], color=GREEN, lw=2, label="Median")
    ax.axvline(res.inputs.retirement_age, color=BRASS, lw=1.6, label="Retirement")
    ax.yaxis.set_major_formatter(dollars)
    ax.set_xlabel("Age")
    ax.set_title(title, pad=28)
    ax.legend(frameon=False, loc="lower left", ncols=4, fontsize=9.5, bbox_to_anchor=(0, 1.0), borderaxespad=0.2)
    ax.set_ylim(0, max(p[90]) * 1.12)
    return save(fig, name)


def finding_cost_of_waiting() -> dict:
    """Same person, same spending goal, starting from $0 at different ages."""
    goal = MAYA.with_(current_savings=0)
    spend = simulate(goal).spending
    rows = []
    for start in (22, 27, 32, 37, 42):
        inp = goal.with_(current_age=start, retirement_spending=spend)
        rate = required_savings_rate(inp, TARGET)
        rows.append({"start_age": start, "required_savings_rate": rate})
    fig, ax = plt.subplots(figsize=(8, 3.8))
    xs = [r["start_age"] for r in rows]
    ys = [r["required_savings_rate"] or 0.75 for r in rows]
    bars = ax.bar([str(x) for x in xs], ys, width=0.5, color=GREEN)
    for b, r in zip(bars, rows):
        label = f"{r['required_savings_rate']:.1%}" if r["required_savings_rate"] is not None else "> 75%"
        ax.annotate(label, (b.get_x() + b.get_width() / 2, b.get_height()), xytext=(0, 4),
                    textcoords="offset points", ha="center", color=INK, fontweight="bold")
    ax.yaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
    ax.set_xlabel("Age you start saving")
    ax.set_title(f"Savings rate needed for {TARGET:.0%} confidence")
    ax.grid(axis="x", visible=False)
    img = save(fig, "cost_of_waiting.png")
    return {"spending_goal": spend, "rows": rows, "image": img}


def finding_fees() -> dict:
    rows = compare_fee_profiles(JORDAN)
    fig, ax = plt.subplots(figsize=(8, 3.2))
    labels = [f"{r.label}\n{r.total_fee:.2%} a year" for r in rows][::-1]
    vals = [r.median_at_retirement for r in rows][::-1]
    bars = ax.barh(labels, vals, height=0.5, color=GREEN)
    for b, r in zip(bars, rows[::-1]):
        ax.annotate(f"{dollars(r.median_at_retirement, None)}  ({r.success_probability:.0%} success)",
                    (b.get_width(), b.get_y() + b.get_height() / 2), xytext=(6, 0), textcoords="offset points",
                    va="center", color=INK, fontsize=10)
    ax.xaxis.set_major_formatter(dollars)
    ax.set_xlim(0, max(vals) * 1.45)
    ax.set_title("Jordan's median portfolio at retirement, by cost of investing")
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", visible=True)
    img = save(fig, "fee_drag.png")
    rule = {yrs: share_of_wealth_lost(yrs, 0.01, annual_return=0.05) for yrs in (20, 30, 40)}
    return {
        "rows": [r.__dict__ for r in rows],
        "one_percent_fee_share_lost": rule,
        "image": img,
    }


def finding_outlook() -> dict:
    out = {}
    for key in ("jpm_2026", "vanguard_2026"):
        inp = MAYA.with_(market=key)
        out[key] = {
            "label": A.market(key).label,
            "success": simulate(inp).success_probability,
            "required_savings_rate": required_savings_rate(inp, TARGET),
            "max_spending": max_sustainable_spending(inp, TARGET),
        }
    return out


def finding_social_security() -> dict:
    rows = []
    for claim in range(62, 71):
        base = LEE.with_(ss_claim_age=claim)
        rows.append({
            "claim_age": claim,
            "success": simulate(base).success_probability,
            "success_with_haircut": simulate(base.with_(ss_haircut=True)).success_probability,
            "benefit": float(simulate(base).social_security.max()),
        })
    fig, ax = plt.subplots(figsize=(8, 3.8))
    ages = [r["claim_age"] for r in rows]
    ax.plot(ages, [r["success"] for r in rows], color=GREEN, lw=2, marker="o", ms=6, mec="white", mew=2,
            label="Full scheduled benefits")
    ax.plot(ages, [r["success_with_haircut"] for r in rows], color=BRASS, lw=2, marker="o", ms=6, mec="white", mew=2,
            label="Benefits cut to 83% from 2034")
    ax.axhline(TARGET, color=INK3, lw=1)
    ax.annotate(f"{TARGET:.0%} target", (62, TARGET), xytext=(2, 4), textcoords="offset points", color=INK3, fontsize=9)
    ax.yaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
    ax.set_xlabel("Age Lee claims Social Security")
    ax.set_title("Lee's chance of success by claiming age", pad=28)
    ax.legend(frameon=False, loc="lower left", ncols=2, fontsize=9.5, bbox_to_anchor=(0, 1.0), borderaxespad=0.2)
    ax.set_ylim(0.3, 0.9)
    img = save(fig, "social_security.png")
    return {"rows": rows, "image": img}


def summarize(inp: PlanInputs) -> dict:
    r = simulate(inp)
    s = r.summary()
    s["required_savings_rate"] = required_savings_rate(inp, TARGET)
    s["max_spending"] = max_sustainable_spending(inp, TARGET)
    return s


def main() -> None:
    results = {
        "settings": {"n_sims": SIMS, "target": TARGET, "assumptions_as_of": A.load_raw()["as_of"]},
        "clients": {"maya": summarize(MAYA), "jordan": summarize(JORDAN), "lee": summarize(LEE)},
        "cost_of_waiting": finding_cost_of_waiting(),
        "fees": finding_fees(),
        "outlook": finding_outlook(),
        "social_security": finding_social_security(),
        "images": {"maya_fan": fan_chart(simulate(MAYA), "Maya's portfolio in today's dollars", "maya_fan.png")},
    }
    DOCS.mkdir(exist_ok=True)
    (DOCS / "results.json").write_text(json.dumps(results, indent=2, default=float))
    (DOCS / "CASE_STUDY.md").write_text(render(results))
    print("wrote docs/results.json, docs/CASE_STUDY.md and", len(list(IMG.glob("*.png"))), "charts")


def render(r: dict) -> str:
    m, j, lee = r["clients"]["maya"], r["clients"]["jordan"], r["clients"]["lee"]
    w = r["cost_of_waiting"]["rows"]
    rate_at = {row["start_age"]: row["required_savings_rate"] for row in w}
    fees = {row["key"]: row for row in r["fees"]["rows"]}
    trad, diy = fees["traditional"], fees["diy_index"]
    o = r["outlook"]
    base, cons = o["jpm_2026"], o["vanguard_2026"]
    ss = {row["claim_age"]: row for row in r["social_security"]["rows"]}
    best_claim = max(ss.values(), key=lambda x: x["success"])
    lost40 = r["fees"]["one_percent_fee_share_lost"][40]

    def rate(x):
        return "more than 75%" if x is None else f"{x:.1%}"

    return f"""# Case study: closing the retirement advice gap

*Every number in this document is produced by `python analysis/case_study.py` ({r['settings']['n_sims']:,}
simulations per scenario, assumptions as of {r['settings']['assumptions_as_of']}). Clients are hypothetical.
Dollar figures are in today's dollars.*

## The problem

Most Americans plan for retirement without professional help. Only about a third of the general
population works with a financial advisor, compared with roughly three quarters of millionaires
(Northwestern Mutual, *Planning & Progress Study 2025*). The gap is partly price: the median advisor
charges about 1% of assets a year on portfolios up to $1 million, and a standalone comprehensive plan
typically costs a few thousand dollars (Kitces Research, 2024). Meanwhile, the Center for Retirement
Research at Boston College estimates that 39% of working-age households are at risk of not maintaining
their standard of living in retirement (*National Retirement Risk Index*, 2022 SCF update).

The core deliverable an advisor provides, a probability-based plan with clear levers, is a computation.
This project makes that computation free, transparent and reproducible.

## The approach

1. **Model the client.** Income, savings, spending goal, Social Security (estimated with the SSA benefit
   formula) and a stock/bond glide path.
2. **Simulate markets.** Correlated lognormal stock and bond returns calibrated to J.P. Morgan's 2026
   Long-Term Capital Market Assumptions, with Vanguard's more cautious outlook as a stress case.
3. **Score the plan.** Probability that every year of retirement spending is fully funded.
4. **Solve for the levers.** Bisection finds the exact savings rate, spending level or retirement age that
   reaches {r['settings']['target']:.0%} confidence.
5. **Prioritize.** Rank recommendations by how much they change the outcome.

## Three clients

| | Maya, 22 | Jordan, 35 | Lee, 52 |
|---|---|---|---|
| Situation | New grad, {money(MAYA.annual_income)} salary, saves {MAYA.savings_rate:.0%} | {money(JORDAN.annual_income)} salary, uses a traditional advisor ({JORDAN.total_fee:.2%} all-in) | {money(LEE.current_savings)} saved, wants to retire at {LEE.retirement_age} |
| Chance of success | **{m['success_probability']:.0%}** | **{j['success_probability']:.0%}** | **{lee['success_probability']:.0%}** |
| Median at retirement | {money(m['median_at_retirement'])} | {money(j['median_at_retirement'])} | {money(lee['median_at_retirement'])} |
| Savings rate for {r['settings']['target']:.0%} | {rate(m['required_savings_rate'])} | {rate(j['required_savings_rate'])} | {rate(lee['required_savings_rate'])} |
| Sustainable spending at {r['settings']['target']:.0%} | {money(m['max_spending'])}/yr | {money(j['max_spending'])}/yr | {money(lee['max_spending'])}/yr |

![Maya's projected portfolio]({r['images']['maya_fan']})

## Findings

### 1. Starting early is the cheapest lever

Holding the same spending goal ({money(r['cost_of_waiting']['spending_goal'])}/yr), a saver who starts at 22
with nothing saved needs to set aside {rate(rate_at[22])} of income to reach {r['settings']['target']:.0%} confidence. Waiting until
32 raises that to {rate(rate_at[32])}, and starting at 42 requires {rate(rate_at[42])}.

![Cost of waiting]({r['cost_of_waiting']['image']})

### 2. Fees compound against you

For Jordan, a {trad['total_fee']:.2%} all-in cost leaves a median {money(trad['median_at_retirement'])} at
retirement versus {money(diy['median_at_retirement'])} with {diy['total_fee']:.2%} index funds, a difference of
{money(trad['cost_vs_lowest'])}. The chance of success moves from {diy['success_probability']:.0%} to
{trad['success_probability']:.0%}. As a rule of thumb, a steady saver earning 5% a year gives up about
{lost40:.0%} of ending wealth to a 1% annual fee over 40 years.

![Fee drag]({r['fees']['image']})

Advice can be worth its cost when it changes behavior (saving more, staying invested in a downturn,
better tax decisions). Know the price, then weigh it against what the advice changes.

### 3. The market outlook matters, so plan on the cautious one

Under the base-case assumptions Maya's plan succeeds {base['success']:.0%} of the time. Under Vanguard's
more cautious outlook it succeeds {cons['success']:.0%} of the time, and the savings rate she needs rises from
{rate(base['required_savings_rate'])} to {rate(cons['required_savings_rate'])}.

### 4. Social Security timing is a planning decision

Lee retires at {LEE.retirement_age}. Claiming at 62 brings in {money(ss[62]['benefit'])}/yr, waiting until 70 brings in
{money(ss[70]['benefit'])}/yr. The best claiming age for this plan is {best_claim['claim_age']}
({best_claim['success']:.0%} success). If benefits are cut to 83% when the trust funds are projected to run out in
2034 (2026 Trustees Report), success at that age falls to {best_claim['success_with_haircut']:.0%}.

![Social Security claiming]({r['social_security']['image']})

## Recommendations

1. **Automate saving early, and raise the rate with each raise.** It is the lever with the biggest effect
   for the least lifestyle change.
2. **Audit total cost, not just the advisory fee.** Add fund expense ratios to the advisory fee and compare
   the result with what the advice changes.
3. **Stress-test with conservative assumptions** and a Social Security haircut before committing to a
   retirement date.
4. **Treat the claiming age as part of the plan.** Model it alongside the retirement age instead of
   deciding it separately.

## Limits

Taxes, account location, pensions, home equity, health-care shocks and dynamic spending rules are not
modeled. Returns are drawn independently each year (no momentum or mean reversion). These are natural
next steps; see the README roadmap.

## Sources

- J.P. Morgan Asset Management, *2026 Long-Term Capital Market Assumptions* (data as of 2025-09-30).
- Vanguard, *Vanguard Capital Markets Model* forecasts (June 30, 2026 run) and *2026 Economic and Market Outlook*.
- Kitces Research, *How Financial Planners Actually Do Financial Planning* (2024); Bob Veres, *Inside Information* fee study.
- Northwestern Mutual, *Planning & Progress Study 2025*.
- Center for Retirement Research at Boston College, *The National Retirement Risk Index: An Update from the 2022 SCF*.
- Social Security Administration, 2026 Trustees Report and 2027 benefit formula.
- IRS, 2026 retirement plan contribution limits.
- Morningstar, *The State of Retirement Income* (December 2025).
"""


if __name__ == "__main__":
    main()
