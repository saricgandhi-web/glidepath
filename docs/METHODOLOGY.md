# Methodology

This document describes exactly what the engine computes. The code in `planner/` is the reference
implementation; `web/engine.js` is a line-for-line port verified by parity tests.

## 1. Units and timing

- The model runs in **annual steps** from the client's current age to the plan-to age (default 95).
- Everything is in **real (today's) dollars**. Income growth, spending and Social Security are
  entered and reported after inflation, and returns are deflated by the inflation assumption.
- Within each year: contributions arrive at the start of the year, retirement withdrawals are taken at
  the start of the year, then the remaining balance earns that year's return.

## 2. Returns

For each asset class with forecast compound return *g* and volatility *σ*, annual gross returns are
lognormal, `1 + R = exp(μ + s·Z)`, with

```
μ = ln(1 + g)
u = (1 + sqrt(1 + 4σ² / (1 + g)²)) / 2
s = sqrt(ln u)
```

This makes the **median** gross return exactly `1 + g` (so the long-run compound growth rate matches the
forecast) and the **standard deviation** of `R` exactly `σ`. A unit test checks both on one million
draws.

Stock and bond shocks are correlated through `Z_bond = ρ·Z_stock + sqrt(1 − ρ²)·Z₂`. The portfolio is
rebalanced annually to the glide-path weight *w*:

```
R_portfolio = w·R_stock + (1 − w)·R_bond
R_after_fees = (1 + R_portfolio)·(1 − fee) − 1
R_real = (1 + R_after_fees) / (1 + inflation) − 1
```

The glide path moves linearly from `equity_now` to `equity_at_retirement` over the working years and
stays flat in retirement.

### Capital market assumptions

| Set | Stocks | Bonds | Source |
|---|---|---|---|
| Base case | 6.7% | 4.8% | J.P. Morgan 2026 Long-Term Capital Market Assumptions |
| Conservative | 5.2% | 4.3% | Vanguard Capital Markets Model (June 2026 run) and 2026 outlook, midpoints of published ranges |

Volatility is 16.4% for stocks and 6.4% for bonds (Vanguard Capital Markets Model), inflation 2.5%
(J.P. Morgan), and stock-bond correlation 0.10 (a project assumption, adjustable).

## 3. Cash flows

- **Income** grows at `real_income_growth` per year until retirement.
- **Contributions** are `savings_rate × income`, including any employer match.
- **Retirement spending** is either entered directly or defaults to `replacement_ratio` (70%) of income
  in the final working year.
- **Portfolio withdrawals** are `max(spending − Social Security, 0)` in each retirement year, adjusted
  by the spending rule below.

### Spending rules

Real retirees rarely spend the same amount no matter what markets do. The engine supports three rules
for the portfolio withdrawal `W` in each retirement year (Social Security is paid on top):

| Rule | Withdrawal in year *t* | Trade-off |
|---|---|---|
| **Fixed** (default) | `W = need` every year | Steady income; the whole risk is running out. |
| **Guardrails** | `W = need × m`, where `m` starts at 1 | Small, rare pay cuts in exchange for a much lower chance of running out. |
| **Percent of portfolio** | `W = need × balance / balance at retirement` | Can never run out, but income moves with every market swing. |

The guardrails rule is a simplified version of Guyton and Klinger (2006). Each year after the first,
the engine compares the current withdrawal rate with the rate at retirement. If it is more than 120% of
the starting rate, spending is cut 10%; if it is below 80%, spending is raised 10%. The multiplier `m`
stays between 50% and 150% of the goal.

Because flexible rules trade running out for spending cuts, success alone no longer tells the whole
story. The engine also reports, across paths:

- **median spending**, the median of each path's average retirement spending;
- **lean-year spending**, the 10th percentile of each path's lowest year of spending;
- **chance of a deep cut**, the share of paths where spending falls below 80% of the goal in any year.

## 4. Social Security

The estimate follows the SSA's primary insurance amount (PIA) formula:

1. Build an earnings record from age 22 to retirement. Past years are back-cast from current income at
   the same growth rate; each year is capped at the taxable maximum ($192,300).
2. Average the highest 35 years (missing years count as zero) to get average indexed monthly earnings (AIME).
3. `PIA = 90% of AIME up to $1,340 + 32% from $1,340 to $8,077 + 15% above $8,077`.
4. Adjust for claiming age against a full retirement age of 67: −5/9% per month for the first 36 months
   early, −5/12% per month beyond that, and +8% per year of delay up to 70.

Because SSA wage-indexes both past earnings and the bend points, applying current bend points to a real
earnings record is a reasonable approximation. Users can override it with the figure on their SSA
statement.

The optional **trust fund stress test** multiplies benefits by 83% from 2034 onward, the share of
scheduled benefits the 2026 Trustees Report projects to be payable after the combined reserves are
depleted.

## 5. Success and other outputs

A path **succeeds** if every retirement withdrawal is paid in full through the plan-to age. The engine
also reports:

- percentile paths (10th, 25th, 50th, 75th, 90th) of the balance by age;
- the median and 10th-percentile balance at retirement;
- the **funded ratio**, the share of total retirement withdrawals actually paid on each path;
- the **sustained withdrawal rate**, the portfolio withdrawal once Social Security has started divided by
  the median balance at retirement, compared with Morningstar's 3.9% safe starting withdrawal rate.

## 6. Solvers

The three levers answer the questions clients ask most:

| Solver | Holds fixed | Method |
|---|---|---|
| Required savings rate | spending goal (today's $) | bisection on [0%, 75%], tolerance 0.05 pts |
| Max sustainable spending | savings rate | bisection, tolerance $50 |
| Earliest retirement age | spending goal (today's $) | walk outward from the planned age |

The savings and spending solvers reuse one matrix of simulated returns (common random numbers). With the
draws held fixed, success can only rise as savings rise or spending falls, so bisection converges to a
clean boundary, and applying the solved value in the app lands exactly on the target.

### Odds map (web app, Pro demo)

The odds map runs the plan for each combination of retirement age (your age ±5 years; ±3 on phones)
and savings rate (2.5-point steps around yours), holding the spending goal at its current dollar amount.
Simulated returns depend on the retirement age through the glide path but not on the savings rate,
so each column reuses one return matrix drawn from the same seed as the main run. The square for your
current plan therefore matches the headline probability exactly, and differences between squares come
from the two choices alone. Squares are compared with the target on the whole percent they display.

## 7. Stress tests

The web app reruns the plan under seven scenarios with the same random draws, so each change in the
probability of success comes from the scenario alone:

| Scenario | Change to the plan |
|---|---|
| A crash right after you retire | Real portfolio returns of −25% and −10% in the first two retirement years, overriding the simulated returns on every path (sequence-of-returns risk) |
| Weaker markets for good | Vanguard's cautious capital market assumptions instead of J.P. Morgan's |
| Social Security is cut in 2034 | Benefits multiplied by 83% from 2034 |
| You live to 100 | Plan-to age extended to 100 (or five years past the plan, whichever is later) |
| You stop working 3 years early | Retirement age three years earlier, with the spending goal held at its original level |
| You pay 1% more in fees | Advisory fee raised by one percentage point |
| All three market risks at once | The crash, the cautious outlook and the benefit cut together |

The Python engine supports the crash scenario through `retirement_shock` (CLI flag `--crash`).

## 8. Verification

- **Closed-form checks.** With constant returns the accumulation phase must equal the annuity-due formula;
  a portfolio with exactly enough money must end at zero; running out must be detected in the right year.
- **Formula checks.** PIA bend points, claiming adjustments at 62, 65, 67 and 70, and the taxable maximum cap.
- **Property checks.** More saving never lowers success; higher fees lower returns one-for-one; the
  conservative outlook produces less wealth; the same seed reproduces the same answer.
- **Solver checks.** Each solved value meets the target and a slightly worse value does not.
- **Spending-rule checks.** The percent rule never runs out and tracks the portfolio; guardrails cut
  spending and last longer in bad markets, raise it in good markets up to the cap, and pay the goal in
  the first year; a retirement shock overrides exactly the right years without altering the caller's data.
- **Cross-language parity.** `scripts/make_parity_fixtures.py` saves Python outputs for fixed return
  matrices under all three spending rules and with a retirement shock. The JavaScript engine must
  reproduce every balance, spending path, depletion age and funded ratio to within floating-point tolerance, and its own random simulations must agree with Python's to within 2 points.

## 9. Limits

Not modeled: taxes and account types, pensions and annuities, home equity, health-care shocks and
couples. The guardrails rule is simplified (no inflation-skip rule and no end-of-plan exemption).
Returns are independent from year to year, so the model does not capture momentum, mean reversion or regime changes, and the lognormal tails may understate crash risk.
