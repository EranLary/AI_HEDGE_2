from __future__ import annotations

from datetime import datetime, timezone

from ai_hedge.obs.pricing import cost_usd, is_off_peak_utc


def _utc(hour: int) -> datetime:
    return datetime(2026, 8, 21, hour, tzinfo=timezone.utc)


def test_deepseek_peak_windows_are_evaluated_in_utc() -> None:
    assert not is_off_peak_utc(_utc(1))
    assert is_off_peak_utc(_utc(4))
    assert not is_off_peak_utc(_utc(6))
    assert is_off_peak_utc(_utc(10))


def test_v4_flash_off_peak_prices_cache_tokens_separately() -> None:
    value = cost_usd(
        "deepseek-v4-flash",
        2_000_000,
        1_000_000,
        prompt_cache_hit_tokens=1_000_000,
        prompt_cache_miss_tokens=1_000_000,
        at=_utc(12),
    )
    assert value == 0.887


def test_legacy_alias_uses_current_v4_pro_peak_rate() -> None:
    value = cost_usd("deepseek-reasoner", 1_000_000, 1_000_000, at=_utc(7))
    assert value == 5.28


def test_versioned_model_response_uses_its_v4_family_rate() -> None:
    value = cost_usd("DeepSeek-V4-Flash-0731", 1_000_000, 0, at=_utc(12))
    assert value == 0.22
