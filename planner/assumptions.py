"""Capital market, fee, tax-limit and Social Security assumptions.

Every number lives in ``data/assumptions.json`` with its source, so the Python
engine and the web app read exactly the same inputs.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent / "data" / "assumptions.json"


@dataclass(frozen=True)
class MarketAssumptions:
    """Nominal compound annual returns and volatilities for a two-asset portfolio."""

    key: str
    label: str
    equity_return: float
    bond_return: float
    equity_vol: float
    bond_vol: float
    correlation: float
    inflation: float


@dataclass(frozen=True)
class FeeProfile:
    """Annual cost of a way of investing, as a fraction of assets."""

    key: str
    label: str
    advisory_fee: float
    fund_fee: float

    @property
    def total(self) -> float:
        return self.advisory_fee + self.fund_fee


@lru_cache(maxsize=1)
def load_raw() -> dict:
    """Return the full assumptions file as a dict (cached)."""
    with DATA_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def market(key: str = "jpm_2026") -> MarketAssumptions:
    raw = load_raw()["markets"]
    if key not in raw:
        raise KeyError(f"Unknown market assumption set '{key}'. Options: {sorted(raw)}")
    m = raw[key]
    return MarketAssumptions(
        key=key,
        label=m["label"],
        equity_return=m["equity_return"],
        bond_return=m["bond_return"],
        equity_vol=m["equity_vol"],
        bond_vol=m["bond_vol"],
        correlation=m["correlation"],
        inflation=m["inflation"],
    )


def fee_profiles() -> dict[str, FeeProfile]:
    raw = load_raw()["fee_profiles"]
    return {
        k: FeeProfile(key=k, label=v["label"], advisory_fee=v["advisory_fee"], fund_fee=v["fund_fee"])
        for k, v in raw.items()
    }


def contribution_limits() -> dict:
    return dict(load_raw()["contribution_limits_2026"])


def social_security() -> dict:
    return dict(load_raw()["social_security"])


def benchmarks() -> dict:
    return dict(load_raw()["benchmarks"])
