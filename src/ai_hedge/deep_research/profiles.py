from __future__ import annotations

import re
from enum import Enum

from .snapshot import CompanySnapshot


class ValuationProfile(str, Enum):
    GENERIC = "generic"
    BROKER = "broker"


_BROKER_SIGNALS = (
    r"\bbroker(?:age)?\b",
    r"\bmargin loans?\b",
    r"\bclient credit balances?\b",
    r"\bdarts?\b",
    r"\bdaily average revenue trades?\b",
    r"\bnet interest income\b",
    r"\bsecurities commissions?\b",
)


def detect_valuation_profile(
    snapshot: CompanySnapshot,
    report: str,
    *,
    requested: str = "auto",
) -> ValuationProfile:
    """Select a valuation contract without using any target or recommendation.

    An explicit profile always wins. Automatic routing requires multiple broker
    economics signals, which avoids routing an ordinary company to the broker
    contract merely because its report mentions a broker or interest income.
    """

    normalized = str(requested or "auto").strip().lower()
    if normalized in {profile.value for profile in ValuationProfile}:
        return ValuationProfile(normalized)
    if normalized != "auto":
        raise ValueError(f"Unsupported valuation profile: {requested!r}")

    text = f"{snapshot.company_name}\n{report}".lower()
    matches = sum(bool(re.search(pattern, text)) for pattern in _BROKER_SIGNALS)
    return ValuationProfile.BROKER if matches >= 2 else ValuationProfile.GENERIC
