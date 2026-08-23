"""Execution policy helpers for Nasdaq-100 universe batches."""
from __future__ import annotations

import os
import random
from datetime import datetime, timezone


DEFAULT_CONCURRENCY = 10
MAX_CONCURRENCY = 12
DEFAULT_ESTIMATED_COST_PER_ATTEMPT_USD = 2.0
DEFAULT_BUDGET_LIMIT_USD = 600.0
DEFAULT_TICKER_TIMEOUT_SECONDS = 2 * 60 * 60


def _env_number(name: str, default: float) -> float:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def configured_concurrency() -> int:
    value = int(_env_number("NASDAQ_RUN_CONCURRENCY", DEFAULT_CONCURRENCY))
    return max(1, min(MAX_CONCURRENCY, value))


def configured_cost_per_attempt_usd() -> float:
    return round(
        _env_number(
            "NASDAQ_ESTIMATED_COST_PER_ATTEMPT_USD",
            DEFAULT_ESTIMATED_COST_PER_ATTEMPT_USD,
        ),
        4,
    )


def configured_budget_limit_usd() -> float:
    return round(_env_number("NASDAQ_RUN_BUDGET_USD", DEFAULT_BUDGET_LIMIT_USD), 2)


def configured_ticker_timeout_seconds() -> int:
    value = int(_env_number("NASDAQ_TICKER_TIMEOUT_SECONDS", DEFAULT_TICKER_TIMEOUT_SECONDS))
    return max(30 * 60, min(6 * 60 * 60, value))


def enforce_execution_window() -> bool:
    return str(os.getenv("NASDAQ_ENFORCE_EXECUTION_WINDOW", "1") or "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def is_preferred_off_peak_utc(value: datetime | None = None) -> bool:
    """Return whether ``value`` is in the long DeepSeek off-peak window.

    The provider currently defines peak windows in UTC. The long continuous
    off-peak window is 10:00 UTC through 01:00 UTC the following day, which is
    13:00-04:00 in Israel daylight time and 12:00-03:00 in standard time.
    """

    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    minute = current.hour * 60 + current.minute
    return minute >= 10 * 60 or minute < 60


def retry_delay_seconds(attempts: int) -> int:
    """Bounded exponential backoff with jitter between ticker attempts.

    Jitter prevents several provider failures from returning to Yahoo and the
    LLM APIs at the same instant after a concurrent burst.
    """

    clean_attempts = max(1, int(attempts))
    base_delay = min(15 * 60, 60 * (2 ** (clean_attempts - 1)))
    jitter_limit = min(30, max(5, base_delay // 4))
    return min(15 * 60, base_delay + random.randint(0, jitter_limit))


def budget_allows_attempt(current_usd: float, per_attempt_usd: float, limit_usd: float) -> bool:
    return float(current_usd) + float(per_attempt_usd) <= float(limit_usd) + 1e-9
