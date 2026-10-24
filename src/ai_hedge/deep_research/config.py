from __future__ import annotations

import os
from dataclasses import dataclass, replace


_VALID_REASONING_EFFORTS = {"high", "xhigh"}


def _positive_int(name: str, default: int, *, maximum: int) -> int:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc
    if value <= 0 or value > maximum:
        raise ValueError(f"{name} must be between 1 and {maximum}, got {value}")
    return value


def _positive_float(name: str, default: float, *, maximum: float) -> float:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be numeric, got {raw!r}") from exc
    if value <= 0 or value > maximum:
        raise ValueError(f"{name} must be between 0 and {maximum}, got {value}")
    return value


def _boolean(name: str, default: bool) -> bool:
    raw = str(os.getenv(name, "") or "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean flag, got {raw!r}")


@dataclass(frozen=True)
class DeepResearchConfig:
    """Quality-first settings for one standalone research run."""

    model: str = "gpt-5.5"
    reasoning_effort: str = "xhigh"
    max_tool_calls: int = 80
    timeout_seconds: int = 3600
    poll_seconds: float = 5.0
    store_remote_response: bool = True
    return_token_budget: str = "unlimited"
    enable_code_interpreter: bool = True
    audit_model: str = "gpt-5.5"
    audit_reasoning_effort: str = "high"

    def __post_init__(self) -> None:
        if not self.model.strip():
            raise ValueError("Deep Research model cannot be empty")
        if self.reasoning_effort not in _VALID_REASONING_EFFORTS:
            allowed = ", ".join(sorted(_VALID_REASONING_EFFORTS))
            raise ValueError(f"reasoning_effort must be one of: {allowed}")
        if self.max_tool_calls <= 0:
            raise ValueError("max_tool_calls must be positive")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if self.poll_seconds <= 0:
            raise ValueError("poll_seconds must be positive")
        if self.return_token_budget not in {"default", "unlimited"}:
            raise ValueError("return_token_budget must be 'default' or 'unlimited'")
        if not self.audit_model.strip():
            raise ValueError("audit_model cannot be empty")
        if self.audit_reasoning_effort not in _VALID_REASONING_EFFORTS:
            allowed = ", ".join(sorted(_VALID_REASONING_EFFORTS))
            raise ValueError(f"audit_reasoning_effort must be one of: {allowed}")

    @classmethod
    def from_env(cls) -> "DeepResearchConfig":
        reasoning = str(
            os.getenv("OPENAI_DEEP_RESEARCH_REASONING", "xhigh") or "xhigh"
        ).strip().lower()
        return cls(
            model=str(
                os.getenv("OPENAI_DEEP_RESEARCH_MODEL", "gpt-5.5") or "gpt-5.5"
            ).strip(),
            reasoning_effort=reasoning,
            max_tool_calls=_positive_int(
                "OPENAI_DEEP_RESEARCH_MAX_TOOL_CALLS", 80, maximum=500
            ),
            timeout_seconds=_positive_int(
                "OPENAI_DEEP_RESEARCH_TIMEOUT_SECONDS", 3600, maximum=14400
            ),
            poll_seconds=_positive_float(
                "OPENAI_DEEP_RESEARCH_POLL_SECONDS", 5.0, maximum=60.0
            ),
            store_remote_response=_boolean(
                "OPENAI_DEEP_RESEARCH_STORE_RESPONSE", True
            ),
            audit_model=str(
                os.getenv("OPENAI_DEEP_RESEARCH_AUDIT_MODEL", "gpt-5.5")
                or "gpt-5.5"
            ).strip(),
            audit_reasoning_effort=str(
                os.getenv("OPENAI_DEEP_RESEARCH_AUDIT_REASONING", "high") or "high"
            ).strip().lower(),
        )

    def with_overrides(self, **values: object) -> "DeepResearchConfig":
        return replace(self, **values)


def require_openai_api_key() -> str:
    key = str(os.getenv("OPENAI_API_KEY", "") or "").strip().lstrip("\ufeff")
    if not key:
        raise RuntimeError(
            "OPENAI_API_KEY is missing. Add it to the repository .env file; "
            "never pass it on the command line or commit it."
        )
    return key
