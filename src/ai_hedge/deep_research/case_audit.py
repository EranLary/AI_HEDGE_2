from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from .config import DeepResearchConfig
from .engine import (
    _jsonable,
    _response_id,
    _response_text,
    _status,
    _write_json,
    extract_sources,
)
from .snapshot import CompanySnapshot


CASE_AUDIT_VERSION = "valuation-case-audit-v1"
_ACTIVE_STATUSES = {"queued", "in_progress"}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def valuation_case_audit_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["audit_version", "strengths", "issues", "quality_score"],
        "properties": {
            "audit_version": {"type": "string"},
            "strengths": {"type": "array", "items": {"type": "string"}},
            "issues": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "severity",
                        "category",
                        "description",
                        "case_evidence",
                        "required_correction",
                    ],
                    "properties": {
                        "severity": {
                            "type": "string",
                            "enum": ["critical", "major", "minor"],
                        },
                        "category": {
                            "type": "string",
                            "enum": [
                                "source_relevance",
                                "forecast_support",
                                "scope",
                                "share_count",
                                "discount_rate",
                                "terminal_value",
                                "peer_set",
                                "multiple_basis",
                                "method_choice",
                                "weighting",
                                "date_basis",
                                "assumption_quality",
                                "other",
                            ],
                        },
                        "description": {"type": "string"},
                        "case_evidence": {"type": "string"},
                        "required_correction": {"type": "string"},
                    },
                },
            },
            "quality_score": {"type": "integer", "minimum": 0, "maximum": 100},
        },
    }


def build_case_audit_prompt(
    snapshot: CompanySnapshot,
    valuation_case: Mapping[str, Any],
    compiled: Mapping[str, Any],
) -> str:
    return f"""
Independently audit this machine-compiled equity valuation case. The deterministic compiler has already
verified arithmetic, dates, weights, CAPM reconciliation, evidence ids, and trailing/forward labels. Your
job is to challenge economic substance and source relevance. Use web research only to verify the supplied
URLs or resolve whether their figures and dates support the case. Do not build a new valuation and do not
reward the case merely because it is structured.

Audit priorities:
1. Verify entity and public-shareholder scope, especially noncontrolling interests, Up-C structures, and
   whether book equity/net income belong to the security being valued.
2. Test whether the point-in-time diluted share bridge is economically valid. Weighted-average shares are
   not automatically point-in-time dilution.
3. Test whether each external URL is specific, dated, relevant, and supports the exact value claimed.
4. Challenge forecast-period rationales. Repeating the same KPI list or a smooth fade is not a driver model
   unless it quantitatively or economically bridges to net income, FCFE, dividends, or book value.
5. Challenge the target-date beginning balance and any unreported stub estimate. A broker residual-income
   case may instead start from the latest reported book date, value all subsequent non-overlapping periods
   from that date, and carry the resulting intrinsic value to the current valuation date at cost of equity
   less actual interim dividends. Do not reject that identity merely because the dates differ; verify that
   the compiler actually applies it, that forecast periods start at reported book, and that post-report
   income, OCI/equity flows, and dividends are neither omitted nor double counted.
6. Challenge CAPM inputs, additional premiums, and tenor choice without substituting your own preferred
   answer merely because reasonable practitioners may differ.
7. Test the terminal transition: final explicit ROE/growth/payout must connect coherently to terminal ROE
   and growth, and terminal value must not dominate without strong support.
8. Test the peer set for business-model and period comparability, outlier distortion, and data-provider
   consistency. A mathematically correct median can still be economically weak.
9. Test whether method weights reflect evidence quality and independence rather than steering the target.
10. A critical or major issue blocks publication. Be exact and conservative, but do not create an issue
    from taste alone when the case discloses and sensitizes a reasonable analyst assumption.

Frozen snapshot:
{json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2)}

Structured valuation case:
{json.dumps(valuation_case, ensure_ascii=False, indent=2)}

Deterministic compiled result:
{json.dumps(compiled, ensure_ascii=False, indent=2)}
""".strip()


def audit_compiled_valuation_case(
    *,
    client: Any,
    config: DeepResearchConfig,
    snapshot: CompanySnapshot,
    run_dir: Path,
    valuation_case: Mapping[str, Any],
    compiled: Mapping[str, Any],
    attempt: int,
    artifact_prefix: str = "valuation_case_audit",
    sleep: Callable[[float], None] = time.sleep,
    progress: Callable[[str], None] = lambda _message: None,
) -> tuple[dict[str, Any], bool]:
    run_path = Path(run_dir)
    safe_prefix = str(artifact_prefix or "").strip()
    if not safe_prefix or not safe_prefix.replace("_", "").isalnum():
        raise ValueError("artifact_prefix must contain only letters, numbers, and underscores")
    suffix = f"{safe_prefix}_{attempt}"
    request_path = run_path / f"{suffix}_request.json"
    response_path = run_path / f"{suffix}_response.json"
    sources_path = run_path / f"{suffix}_sources.json"
    audit_path = run_path / f"{suffix}.json"
    state_path = run_path / f"{suffix}_state.json"
    payload = {
        "model": config.audit_model,
        "reasoning": {"effort": config.audit_reasoning_effort},
        "instructions": (
            "Return only the strict structured audit. Be adversarial, evidence-based, and do not repair."
        ),
        "input": build_case_audit_prompt(snapshot, valuation_case, compiled),
        "tools": [
            {"type": "web_search", "return_token_budget": config.return_token_budget}
        ],
        "tool_choice": "auto",
        "include": ["web_search_call.action.sources"],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "valuation_case_audit",
                "strict": True,
                "schema": valuation_case_audit_schema(),
            }
        },
        "background": True,
        "store": config.store_remote_response,
        "max_tool_calls": min(config.max_tool_calls, 40),
        "metadata": {
            "ticker": snapshot.ticker,
            "engine": "ai-hedge-valuation-case-audit",
            "attempt": str(attempt),
        },
    }
    _write_json(request_path, payload)
    progress(f"Submitting valuation case audit {attempt}")
    response = client.responses.create(**payload)
    response_id = _response_id(response)
    if not response_id:
        raise RuntimeError("Valuation case audit response has no id")
    deadline = time.monotonic() + config.timeout_seconds
    while _status(response) in _ACTIVE_STATUSES:
        _write_json(
            state_path,
            {
                "response_id": response_id,
                "status": _status(response),
                "updated_at": _iso_now(),
            },
        )
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Valuation case audit timed out; resume {response_id}.")
        sleep(config.poll_seconds)
        response = client.responses.retrieve(
            response_id,
            include=["web_search_call.action.sources"],
        )
        progress(f"Valuation case audit status: {_status(response)}")
    status = _status(response)
    raw = _response_text(response).strip()
    sources = extract_sources(response)
    _write_json(response_path, response)
    _write_json(sources_path, {"sources": sources})
    if status != "completed" or not raw:
        raise RuntimeError(f"Valuation case audit failed with status={status}")
    audit = json.loads(raw)
    if not isinstance(audit, dict):
        raise RuntimeError("Valuation case audit did not return a JSON object")
    audit["audit_version"] = CASE_AUDIT_VERSION
    audit["audit_model"] = str(getattr(response, "model", "") or config.audit_model)
    audit["audit_usage"] = _jsonable(getattr(response, "usage", None))
    blocking = any(
        isinstance(issue, Mapping)
        and issue.get("severity") in {"critical", "major"}
        for issue in audit.get("issues") or []
    )
    ready = not blocking and int(audit.get("quality_score") or 0) >= 85
    audit["publication_ready"] = ready
    _write_json(audit_path, audit)
    return audit, ready
