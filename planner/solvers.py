"""Goal-seek solvers: the three questions every client asks.

* How much do I need to save?            -> ``required_savings_rate``
* How much can I spend in retirement?    -> ``max_sustainable_spending``
* When can I retire?                     -> ``earliest_retirement_age``

The savings and spending solvers reuse one matrix of simulated returns
(common random numbers), so success probability rises monotonically with the
lever being solved for and bisection converges cleanly.
"""

from __future__ import annotations

from .model import PlanInputs, retirement_spending, simulate, simulate_returns


def _bisect(fn, lo: float, hi: float, target: float, tol: float, increasing: bool = True, max_iter: int = 60) -> float:
    """Find x in [lo, hi] where fn(x) crosses target."""
    for _ in range(max_iter):
        if hi - lo <= tol:
            break
        mid = (lo + hi) / 2.0
        ok = fn(mid) >= target
        if ok == increasing:
            hi = mid
        else:
            lo = mid
    return hi if increasing else lo


def required_savings_rate(inputs: PlanInputs, target: float = 0.85, max_rate: float = 0.75) -> float | None:
    """Lowest savings rate (share of income) that reaches ``target`` success.

    Returns ``None`` if even ``max_rate`` falls short.
    """
    returns = simulate_returns(inputs)
    spend = retirement_spending(inputs)
    base = inputs.with_(retirement_spending=spend)  # hold the spending goal fixed

    def prob(rate: float) -> float:
        return simulate(base.with_(savings_rate=rate), returns).success_probability

    if prob(0.0) >= target:
        return 0.0
    if prob(max_rate) < target:
        return None
    return _bisect(prob, 0.0, max_rate, target, tol=0.0005, increasing=True)


def max_sustainable_spending(inputs: PlanInputs, target: float = 0.85) -> float:
    """Highest retirement spending (today's $/yr) that keeps ``target`` success."""
    returns = simulate_returns(inputs)

    def prob(spend: float) -> float:
        return simulate(inputs.with_(retirement_spending=spend), returns).success_probability

    hi = max(retirement_spending(inputs), 10_000.0)
    while prob(hi) >= target and hi < 1e8:
        hi *= 2.0
    return _bisect(prob, 0.0, hi, target, tol=50.0, increasing=False)


def earliest_retirement_age(inputs: PlanInputs, target: float = 0.85, max_age: int = 75) -> int | None:
    """Earliest retirement age with at least ``target`` success, holding the
    spending goal fixed in today's dollars.

    Walks outward from the planned age: down while the plan still works, or up
    until it starts working. Success rises with each extra working year, so this
    finds the boundary without simulating every age.
    """
    spend = retirement_spending(inputs)
    base = inputs.with_(retirement_spending=spend)
    upper = min(max_age, inputs.plan_to_age - 1)

    def works(age: int) -> bool:
        return simulate(base.with_(retirement_age=age)).success_probability >= target

    age = inputs.retirement_age
    if works(age):
        while age - 1 > inputs.current_age and works(age - 1):
            age -= 1
        return age
    for age in range(inputs.retirement_age + 1, upper + 1):
        if works(age):
            return age
    return None
