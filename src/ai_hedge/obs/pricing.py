"""DeepSeek V4 token-cost computation.

Rates are USD per million tokens from the official pricing page as of
2026-08-21. DeepSeek defines peak windows in UTC; all other times receive the
off-peak rates. Cache-hit and cache-miss prompt tokens are priced separately.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


_ALIASES = {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-pro",
}

_PRICES = {
    "deepseek-v4-flash": {
        "peak": {"cache_hit": 0.014, "cache_miss": 0.44, "output": 1.32},
        "off_peak": {"cache_hit": 0.007, "cache_miss": 0.22, "output": 0.66},
    },
    "deepseek-v4-pro": {
        "peak": {"cache_hit": 0.044, "cache_miss": 1.32, "output": 3.96},
        "off_peak": {"cache_hit": 0.022, "cache_miss": 0.66, "output": 1.98},
    },
}


def is_off_peak_utc(value: datetime | None = None) -> bool:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    minute = current.hour * 60 + current.minute
    is_peak = (60 <= minute < 240) or (360 <= minute < 600)
    return not is_peak


def cost_usd(
    model: Optional[str],
    tokens_in: Optional[int],
    tokens_out: Optional[int],
    *,
    prompt_cache_hit_tokens: Optional[int] = None,
    prompt_cache_miss_tokens: Optional[int] = None,
    at: datetime | None = None,
) -> Optional[float]:
    if not model or tokens_out is None:
        return None
    key = _ALIASES.get(str(model).strip().lower(), str(model).strip().lower())
    if key.startswith("deepseek-v4-flash"):
        key = "deepseek-v4-flash"
    elif key.startswith("deepseek-v4-pro"):
        key = "deepseek-v4-pro"
    model_prices = _PRICES.get(key)
    if model_prices is None:
        return None

    total_in = max(0, int(tokens_in or 0))
    hit = max(0, int(prompt_cache_hit_tokens or 0))
    if prompt_cache_miss_tokens is None:
        miss = max(0, total_in - hit)
    else:
        miss = max(0, int(prompt_cache_miss_tokens))
    # Provider usage occasionally omits aggregate prompt_tokens. Never price
    # fewer prompt tokens than the explicit hit/miss counters report.
    if hit + miss < total_in:
        miss += total_in - hit - miss

    period = "off_peak" if is_off_peak_utc(at) else "peak"
    rates = model_prices[period]
    value = (
        (hit / 1_000_000.0) * rates["cache_hit"]
        + (miss / 1_000_000.0) * rates["cache_miss"]
        + (max(0, int(tokens_out)) / 1_000_000.0) * rates["output"]
    )
    return round(value, 6)
