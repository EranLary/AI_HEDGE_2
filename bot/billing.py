from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
        return value if value > 0 else default
    except Exception:
        return default


def _sanitize_for_payload(value: str) -> str:
    clean = (value or "").strip().upper().replace(":", "").replace("|", "")
    return clean[:32]


@dataclass(frozen=True)
class BillingConfig:
    valuation_price_stars: int = 50
    sec_price_stars: int = 25
    free_password: str = ""
    currency: str = "XTR"

    @classmethod
    def from_env(cls) -> "BillingConfig":
        return cls(
            valuation_price_stars=_env_int("VALUATION_PRICE_STARS", 50),
            sec_price_stars=_env_int("SEC_PRICE_STARS", 25),
            free_password=os.getenv("BOT_FREE_PASSWORD", "").strip(),
            currency=os.getenv("BOT_BILLING_CURRENCY", "XTR").strip() or "XTR",
        )

    def price_for_mode(self, mode: str) -> int:
        norm = (mode or "").strip().lower()
        if norm == "valuation":
            return int(self.valuation_price_stars)
        if norm == "sec":
            return int(self.sec_price_stars)
        raise ValueError(f"Unsupported billing mode: {mode}")

    def has_free_password(self) -> bool:
        return bool(self.free_password)

    def is_valid_free_password(self, provided: str) -> bool:
        if not self.free_password:
            return False
        return (provided or "").strip() == self.free_password


def build_invoice_payload(*, user_id: int, mode: str, ticker: str, nonce: str) -> str:
    ticker_clean = _sanitize_for_payload(ticker)
    mode_clean = (mode or "").strip().lower()
    nonce_clean = _sanitize_for_payload(nonce) or "N"
    return f"aihedge|v1|{int(user_id)}|{mode_clean}|{ticker_clean}|{nonce_clean}"


def parse_invoice_payload(payload: str) -> Optional[dict]:
    raw = (payload or "").strip()
    parts = raw.split("|")
    if len(parts) != 6:
        return None
    if parts[0] != "aihedge" or parts[1] != "v1":
        return None
    try:
        user_id = int(parts[2])
    except Exception:
        return None
    mode = parts[3].strip().lower()
    if mode not in {"valuation", "sec"}:
        return None
    ticker = parts[4].strip().upper()
    nonce = parts[5].strip()
    if not ticker or not nonce:
        return None
    return {
        "user_id": user_id,
        "mode": mode,
        "ticker": ticker,
        "nonce": nonce,
    }
