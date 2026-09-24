from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import requests
from psycopg.types.json import Jsonb

from ai_hedge.db.connection import get_conn


JEV_MODEL_ID = "typesafe-ai/jev"
QUESTION_VERSION = "stock-direction-v3"
REDACTION_VERSION = "report-date-v1"
GATEWAY_EVALUATE_URL = "https://ai-gateway.vercel.sh/v1/evaluate"
# Vercel's TypeSafe catalog advertises a 32K-token window. Live HTTP API probes
# on 2026-09-24 succeeded at 60K characters (~16K input tokens) while 80K and
# 100K repeatedly returned 503. Keep measured headroom for seven typed answers.
MAX_STATE_CHARS = 60_000

_MARKDOWN_HEADING_RE = re.compile(r"(?m)^(#{1,6})[ \t]+(.+?)[ \t]*$")
_ANALYSIS_SECTION_PREFIXES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("company", ("what the company is doing",)),
    ("general", ("general information insights",)),
    ("news", ("news review",)),
    ("competitors", ("competitor market review",)),
    ("annual", ("annual reports insights",)),
    ("quarterly", ("quarterly reports insights",)),
    ("all_reports", ("all reports insights",)),
    ("multiples", ("multiple analysis",)),
    ("analyst_expectations", ("analyst expectations insights",)),
    ("holders", ("holders analysis",)),
    ("market", ("market analysis",)),
    ("swot", ("swot analysis",)),
    ("bull_bear", ("bull vs bear thesis",)),
    ("valuation_insights", ("key insights for valuation",)),
    ("filing_qa", ("sec pre-score questions & answers", "maya pre-score questions & answers")),
    ("filing_summary", ("sec summary", "maya summary")),
    ("share_count", ("verified share count for valuation",)),
    ("multi_agent", ("independent multi-agent research lens",)),
    ("web_search", ("web search",)),
    ("dashboard", ("dashboard extraction pack",)),
    ("wall_st", ("wall st analyst read",)),
    ("technical", ("technical analysis",)),
    ("financials", ("financials",)),
    ("sources", ("sec section sources", "maya section sources")),
)
_JEV_ANALYSIS_SECTIONS: tuple[str, ...] = (
    "company",
    "general",
    "news",
    "all_reports",
    "analyst_expectations",
    "bull_bear",
    "dashboard",
    "wall_st",
    "technical",
    "financials",
)
_JEV_BUDGET_DROP_ORDER: tuple[str, ...] = (
    "wall_st",
    "analyst_expectations",
    "general",
)

ForecastMode = Literal["forward", "retrospective"]

HORIZONS: tuple[tuple[str, str, int], ...] = (
    ("1w", "one week", 7),
    ("1m", "one month", 30),
    ("3m", "three months", 91),
    ("6m", "six months", 182),
    ("1y", "one year", 365),
    ("3y", "three years", 365 * 3),
    ("5y", "five years", 365 * 5),
)


def _truthy_env(name: str) -> bool:
    return str(os.environ.get(name, "")).strip().lower() in {"1", "true", "yes", "on"}


def _as_utc(value: Any) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _date_tokens(value: Any) -> set[str]:
    try:
        parsed = _as_utc(value)
    except (TypeError, ValueError):
        return set()
    month = parsed.strftime("%B")
    short_month = parsed.strftime("%b")
    return {
        parsed.isoformat(),
        parsed.isoformat().replace("+00:00", "Z"),
        parsed.strftime("%Y-%m-%d"),
        parsed.strftime("%Y/%m/%d"),
        parsed.strftime("%d/%m/%Y"),
        parsed.strftime("%m/%d/%Y"),
        f"{month} {parsed.day}, {parsed.year}",
        f"{short_month} {parsed.day}, {parsed.year}",
    }


def redact_report_dates(markdown: str, *date_values: Any) -> str:
    """Redact the report publication timestamps without erasing fiscal periods."""
    redacted = str(markdown or "")
    tokens: set[str] = set()
    for value in date_values:
        tokens.update(_date_tokens(value))
    for token in sorted((token for token in tokens if token), key=len, reverse=True):
        redacted = re.sub(re.escape(token), "[REPORT DATE WITHHELD]", redacted, flags=re.IGNORECASE)
    return redacted


def _analysis_section_key(title: str) -> str | None:
    normalized = str(title or "").strip().rstrip(":").strip().casefold()
    if normalized.endswith("prices explain"):
        return "embedded_valuation"
    for key, prefixes in _ANALYSIS_SECTION_PREFIXES:
        if any(normalized.startswith(prefix) for prefix in prefixes):
            return key
    return None


def _analysis_sections(markdown: str) -> dict[str, str]:
    """Extract logical pipeline sections across legacy Markdown heading levels."""
    text = str(markdown or "")
    recognized: list[tuple[int, str]] = []
    for match in _MARKDOWN_HEADING_RE.finditer(text):
        key = _analysis_section_key(match.group(2))
        if key:
            recognized.append((match.start(), key))

    sections: dict[str, str] = {}
    index = 0
    while index < len(recognized):
        start, key = recognized[index]
        next_index = index + 1
        while next_index < len(recognized) and recognized[next_index][1] == key:
            next_index += 1
        end = recognized[next_index][0] if next_index < len(recognized) else len(text)
        body = text[start:end].strip()
        if len(body) > len(sections.get(key, "")):
            sections[key] = body
        index = next_index
    return sections


def _without_embedded_valuation(analysis_md: str, prices_explain_md: str | None) -> str:
    """Remove the exact legacy valuation copy found in some historical analysis artifacts."""
    analysis = str(analysis_md or "")
    valuation = str(prices_explain_md or "").strip()
    if valuation and valuation in analysis:
        analysis = analysis.replace(valuation, "")
    return analysis


def _render_analysis_evidence_pack(
    *,
    ticker: str,
    sections: dict[str, str],
    keys: list[str],
) -> str:
    excerpts = [sections[key] for key in keys if sections.get(key)]
    return "\n\n---\n\n".join(
        (
            f"# {ticker} Analysis Evidence Pack",
            (
                "The report publication date is intentionally withheld. Evaluate only the unedited "
                "analysis sections below as if making the decision at publication time. No valuation "
                "report or price-target model is included."
            ),
            *excerpts,
        )
    ).strip()


def build_jev_state(
    *,
    ticker: str,
    analysis_md: str,
    prices_explain_md: str | None,
    generated_at: Any,
    available_at: Any,
    max_chars: int = MAX_STATE_CHARS,
) -> tuple[str, bool]:
    analysis_only = _without_embedded_valuation(analysis_md, prices_explain_md)
    sections = _analysis_sections(analysis_only)
    selected_keys = [key for key in _JEV_ANALYSIS_SECTIONS if sections.get(key)]
    if not selected_keys:
        raise ValueError("Jev analysis evidence pack found no recognized report sections")

    state = _render_analysis_evidence_pack(ticker=ticker, sections=sections, keys=selected_keys)
    state = redact_report_dates(state, generated_at, available_at)
    dropped_for_budget = False
    for key in _JEV_BUDGET_DROP_ORDER:
        if len(state) <= max_chars:
            break
        if key not in selected_keys:
            continue
        selected_keys.remove(key)
        dropped_for_budget = True
        state = _render_analysis_evidence_pack(ticker=ticker, sections=sections, keys=selected_keys)
        state = redact_report_dates(state, generated_at, available_at)

    if len(state) > max_chars:
        raise ValueError(
            f"Jev analysis evidence pack is {len(state)} characters after whole-section fallbacks; "
            f"budget is {max_chars}"
        )
    return state, dropped_for_budget


def _questions() -> dict[str, dict[str, str]]:
    return {
        horizon: {
            "type": "boolean",
            "instructions": (
                "Using only the evidence in the report, estimate this exact event: will the company's "
                "split-adjusted common-stock closing price on the first trading session on or after "
                f"{label} following publication be strictly higher than its split-adjusted closing price "
                "on the first trading session on or after publication? Treat the withheld publication "
                "date as unknown and do not infer it."
            ),
        }
        for horizon, label, _days in HORIZONS
    }


def evaluate_state(
    state: str,
    *,
    timeout_seconds: float = 90.0,
    max_attempts: int = 3,
) -> dict[str, Any]:
    # Some Windows/PowerShell secret pipelines can prefix a UTF-8 BOM. It is
    # invisible in dashboards but invalid in an HTTP Authorization header.
    api_key = str(os.environ.get("AI_GATEWAY_API_KEY", "")).strip().lstrip("\ufeff")
    if not api_key:
        raise RuntimeError("AI_GATEWAY_API_KEY is not configured")

    gateway_options: dict[str, Any] = {"disallowPromptTraining": True}
    if _truthy_env("JEV_ZERO_DATA_RETENTION"):
        gateway_options["zeroDataRetention"] = True

    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")

    request_kwargs = {
        "headers": {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        "json": {
            "model": JEV_MODEL_ID,
            "state": state,
            "questions": _questions(),
            "providerOptions": {"gateway": gateway_options},
        },
        "timeout": timeout_seconds,
    }
    for attempt in range(1, max_attempts + 1):
        response = requests.post(GATEWAY_EVALUATE_URL, **request_kwargs)
        retryable = response.status_code == 429 or response.status_code >= 500
        if response.ok or not retryable or attempt == max_attempts:
            break
        time.sleep(2 ** (attempt - 1))

    if not response.ok:
        detail = response.text.strip()
        raise RuntimeError(f"Jev gateway returned HTTP {response.status_code}: {detail[:500]}")
    payload = response.json()
    answers = payload.get("answers")
    if not isinstance(answers, dict):
        raise RuntimeError("Jev response did not contain an answers object")
    for horizon, _label, _days in HORIZONS:
        answer = answers.get(horizon)
        probability = answer.get("probability") if isinstance(answer, dict) else None
        if not isinstance(probability, (int, float)) or not math.isfinite(float(probability)):
            raise RuntimeError(f"Jev response is missing a valid probability for {horizon}")
        if not 0 <= float(probability) <= 1:
            raise RuntimeError(f"Jev returned an out-of-range probability for {horizon}")
    return payload


def _load_report(report_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id::text, r.ticker, r.generated_at, r.available_at,
                       a.analysis_md, a.prices_explain_md
                  FROM reports r
                  JOIN report_artifacts a ON a.report_id = r.id
                 WHERE r.id = %s::uuid
                   AND r.deleted_at IS NULL;
                """,
                (report_id,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            columns = [item.name for item in cur.description]
            return dict(zip(columns, row))


def _claim_run(
    *,
    report_id: str,
    mode: ForecastMode,
    input_sha256: str,
    input_chars: int,
    input_truncated: bool,
) -> str | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO report_jev_runs (
                    report_id, model_id, question_version, forecast_mode, status,
                    input_sha256, input_chars, input_truncated, redaction_version
                ) VALUES (%s::uuid, %s, %s, %s, 'pending', %s, %s, %s, %s)
                ON CONFLICT (report_id, model_id, question_version) DO UPDATE SET
                    forecast_mode = EXCLUDED.forecast_mode,
                    status = 'pending',
                    input_sha256 = EXCLUDED.input_sha256,
                    input_chars = EXCLUDED.input_chars,
                    input_truncated = EXCLUDED.input_truncated,
                    redaction_version = EXCLUDED.redaction_version,
                    usage = NULL,
                    provider_metadata = NULL,
                    error = '',
                    created_at = now(),
                    completed_at = NULL
                WHERE report_jev_runs.status = 'failed'
                   OR (
                       report_jev_runs.status = 'pending'
                       AND report_jev_runs.created_at < now() - interval '15 minutes'
                   )
                RETURNING id::text;
                """,
                (
                    report_id,
                    JEV_MODEL_ID,
                    QUESTION_VERSION,
                    mode,
                    input_sha256,
                    input_chars,
                    input_truncated,
                    REDACTION_VERSION,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return str(row[0]) if row else None


def _mark_failed(run_id: str, error: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE report_jev_runs
                   SET status = 'failed', error = %s, completed_at = now()
                 WHERE id = %s::uuid;
                """,
                (str(error)[:4000], run_id),
            )
        conn.commit()


def _store_completed(
    *,
    run_id: str,
    report_id: str,
    available_at: datetime,
    payload: dict[str, Any],
) -> None:
    answers = payload["answers"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM report_jev_predictions WHERE run_id = %s::uuid;", (run_id,))
            for horizon, _label, days in HORIZONS:
                probability = float(answers[horizon]["probability"])
                predicted_up = probability >= 0.5
                confidence = probability if predicted_up else 1.0 - probability
                cur.execute(
                    """
                    INSERT INTO report_jev_predictions (
                        run_id, report_id, horizon, horizon_days, probability_up,
                        predicted_up, confidence, target_at
                    ) VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s);
                    """,
                    (
                        run_id,
                        report_id,
                        horizon,
                        days,
                        probability,
                        predicted_up,
                        confidence,
                        available_at + timedelta(days=days),
                    ),
                )
            cur.execute(
                """
                UPDATE report_jev_runs
                   SET status = 'completed',
                       usage = %s,
                       provider_metadata = %s,
                       error = '',
                       completed_at = now()
                 WHERE id = %s::uuid;
                """,
                (
                    Jsonb(payload.get("usage") or {}),
                    Jsonb(payload.get("providerMetadata") or {}),
                    run_id,
                ),
            )
        conn.commit()


def generate_and_store_report_forecast(
    report_id: str,
    *,
    mode: ForecastMode = "forward",
    timeout_seconds: float = 90.0,
) -> dict[str, Any]:
    report = _load_report(report_id)
    if report is None:
        return {"status": "missing_report", "report_id": report_id}

    state, truncated = build_jev_state(
        ticker=str(report["ticker"]),
        analysis_md=str(report["analysis_md"] or ""),
        prices_explain_md=report.get("prices_explain_md"),
        generated_at=report["generated_at"],
        available_at=report["available_at"],
    )
    digest = hashlib.sha256(state.encode("utf-8")).hexdigest()
    run_id = _claim_run(
        report_id=report_id,
        mode=mode,
        input_sha256=digest,
        input_chars=len(state),
        input_truncated=truncated,
    )
    if run_id is None:
        return {"status": "already_claimed", "report_id": report_id}

    try:
        payload = evaluate_state(state, timeout_seconds=timeout_seconds)
        _store_completed(
            run_id=run_id,
            report_id=report_id,
            available_at=_as_utc(report["available_at"]),
            payload=payload,
        )
    except Exception as exc:
        _mark_failed(run_id, f"{type(exc).__name__}: {exc}")
        return {"status": "failed", "report_id": report_id, "run_id": run_id, "error": str(exc)}

    return {
        "status": "completed",
        "report_id": report_id,
        "run_id": run_id,
        "input_chars": len(state),
        "input_truncated": truncated,
        "answers": {
            horizon: float(payload["answers"][horizon]["probability"])
            for horizon, _label, _days in HORIZONS
        },
    }


def result_json(result: dict[str, Any]) -> str:
    return json.dumps(result, ensure_ascii=False, sort_keys=True)
