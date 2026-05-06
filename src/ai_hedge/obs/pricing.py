"""DeepSeek price table for cost computation.

Approximate USD per million tokens as of 2026-05. Edit when DeepSeek prices
change. The wrapper resolves both the requested model name (``deepseek-chat``,
``deepseek-reasoner``) and the actual model name returned post-remap
(``deepseek-v4-flash``, ``deepseek-v4-pro``).
"""
from __future__ import annotations

from typing import Optional, Tuple

# (input_usd_per_mtok, output_usd_per_mtok)
_PRICES: dict[str, Tuple[float, float]] = {
    "deepseek-v4-flash": (0.27, 1.10),
    "deepseek-v4-pro":   (0.55, 2.19),
    # Legacy aliases — same prices, mirror legacy_port's remap.
    "deepseek-chat":     (0.27, 1.10),
    "deepseek-reasoner": (0.55, 2.19),
}


def cost_usd(model: Optional[str], tokens_in: Optional[int], tokens_out: Optional[int]) -> Optional[float]:
    if not model or tokens_in is None or tokens_out is None:
        return None
    key = str(model).strip().lower()
    rates = _PRICES.get(key)
    if rates is None:
        return None
    in_rate, out_rate = rates
    return round((tokens_in / 1_000_000.0) * in_rate + (tokens_out / 1_000_000.0) * out_rate, 6)
