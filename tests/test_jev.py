from __future__ import annotations

from datetime import datetime, timezone

import pytest

from ai_hedge import jev


def test_build_jev_state_redacts_report_date_but_keeps_other_periods() -> None:
    report_time = datetime(2026, 9, 24, 10, 30, tzinfo=timezone.utc)
    state, truncated = jev.build_jev_state(
        ticker="TEST",
        analysis_md="Generated 2026-09-24. Fiscal year ended 2025-12-31.",
        prices_explain_md="Current price 100; valuation conclusion 125.",
        generated_at=report_time,
        available_at=report_time,
    )

    assert truncated is False
    assert "2026-09-24" not in state
    assert "[REPORT DATE WITHHELD]" in state
    assert "2025-12-31" in state
    assert "## Analysis" in state
    assert "## Valuation" in state


def test_build_jev_state_preserves_head_and_tail_when_truncated() -> None:
    state, truncated = jev.build_jev_state(
        ticker="TEST",
        analysis_md="HEAD-ANCHOR\n" + ("a" * 400),
        prices_explain_md=("b" * 400) + "\nTAIL-ANCHOR",
        generated_at="2026-09-24T00:00:00Z",
        available_at="2026-09-24T00:00:00Z",
        max_chars=600,
    )

    assert truncated is True
    assert "HEAD-ANCHOR" in state
    assert "TAIL-ANCHOR" in state
    assert "Middle of report omitted deterministically" in state
    assert len(state) <= 600


class _FakeResponse:
    ok = True
    status_code = 200
    text = ""

    def json(self):
        return {
            "answers": {
                horizon: {"type": "boolean", "probability": 0.6}
                for horizon, _label, _days in jev.HORIZONS
            }
        }


def test_evaluate_state_enforces_no_training_without_zdr_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured.update({"url": url, "headers": headers, "json": json, "timeout": timeout})
        return _FakeResponse()

    monkeypatch.setenv("AI_GATEWAY_API_KEY", "secret-value")
    monkeypatch.delenv("JEV_ZERO_DATA_RETENTION", raising=False)
    monkeypatch.setattr(jev.requests, "post", fake_post)

    payload = jev.evaluate_state("state")

    assert len(payload["answers"]) == 7
    assert captured["url"] == jev.GATEWAY_EVALUATE_URL
    assert captured["headers"]["Authorization"] == "Bearer secret-value"
    assert captured["json"]["model"] == "typesafe-ai/jev"
    assert captured["json"]["providerOptions"]["gateway"] == {"disallowPromptTraining": True}


def test_evaluate_state_strips_an_invisible_bom_from_the_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured["authorization"] = headers["Authorization"]
        return _FakeResponse()

    monkeypatch.setenv("AI_GATEWAY_API_KEY", "\ufeffclean-key")
    monkeypatch.setattr(jev.requests, "post", fake_post)

    jev.evaluate_state("state")

    assert captured["authorization"] == "Bearer clean-key"


def test_evaluate_state_rejects_missing_horizon(monkeypatch: pytest.MonkeyPatch) -> None:
    class MissingAnswerResponse(_FakeResponse):
        def json(self):
            return {"answers": {"1w": {"probability": 0.5}}}

    monkeypatch.setenv("AI_GATEWAY_API_KEY", "secret-value")
    monkeypatch.setattr(jev.requests, "post", lambda *args, **kwargs: MissingAnswerResponse())

    with pytest.raises(RuntimeError, match="missing a valid probability"):
        jev.evaluate_state("state")


def test_evaluate_state_retries_temporary_gateway_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    class TemporaryFailureResponse:
        ok = False
        status_code = 503
        text = "temporarily unavailable"

    responses = [TemporaryFailureResponse(), _FakeResponse()]
    sleeps: list[int] = []

    monkeypatch.setenv("AI_GATEWAY_API_KEY", "secret-value")
    monkeypatch.setattr(jev.requests, "post", lambda *args, **kwargs: responses.pop(0))
    monkeypatch.setattr(jev.time, "sleep", sleeps.append)

    payload = jev.evaluate_state("state")

    assert len(payload["answers"]) == 7
    assert sleeps == [1]


def test_evaluate_state_does_not_retry_client_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    class ClientErrorResponse:
        ok = False
        status_code = 401
        text = "unauthorized"

    calls = 0

    def fake_post(*args, **kwargs):
        nonlocal calls
        calls += 1
        return ClientErrorResponse()

    monkeypatch.setenv("AI_GATEWAY_API_KEY", "secret-value")
    monkeypatch.setattr(jev.requests, "post", fake_post)

    with pytest.raises(RuntimeError, match="HTTP 401"):
        jev.evaluate_state("state")

    assert calls == 1
