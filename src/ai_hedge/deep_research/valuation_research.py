from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .case_builder import CASE_VERSION, valuation_case_schema
from .compiler import ValuationCompilationError, compile_valuation_case
from .config import DeepResearchConfig
from .engine import (
    _jsonable,
    _response_id,
    _response_text,
    _status,
    _write_json,
    extract_sources,
)
from .prompt import DEVELOPER_INSTRUCTIONS, PROMPT_VERSION
from .snapshot import CompanySnapshot


_ACTIVE_STATUSES = {"queued", "in_progress"}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def build_valuation_research_prompt(
    *,
    snapshot: CompanySnapshot,
    report: str,
    audit: Mapping[str, Any],
    extracted_case: Mapping[str, Any],
    compile_issues: Sequence[str],
    prior_case_audit: Mapping[str, Any] | None = None,
) -> str:
    blocking_audit = [
        issue
        for issue in audit.get("issues") or []
        if isinstance(issue, Mapping) and issue.get("severity") in {"critical", "major"}
    ]
    prior_case_blockers = [
        issue
        for issue in (prior_case_audit or {}).get("issues") or []
        if isinstance(issue, Mapping) and issue.get("severity") in {"critical", "major"}
    ]
    return f"""
Build a new, publication-grade structured valuation case for {snapshot.company_name} ({snapshot.ticker}).
The narrative research below is context, not authority. Independently verify every material external input
with live web research, use Code Interpreter for calculations, and return only the strict JSON object.

This is not a prose-writing task. The deterministic compiler will reject the case unless it satisfies all
of these contracts:

1. Pick one exact target_date and put every method on that date. The reference price remains dated at the
   frozen observation. For a 12-month target, use an exact date approximately one year later.
2. Every reported fact, market observation, or third-party estimate needs the exact dated source URL that
   contains the number. Generic home pages and search-result URLs are invalid.
3. Every analyst assumption needs a concise economic rationale. It must not pretend to be sourced fact.
4. For DCF/FCFE, provide explicit cash_flows_per_share after the target date, a sourced or reasoned terminal
   growth rate, and a reproducible discount rate. Do not put EPS in cash_flows_per_share unless it is
   explicitly converted to distributable FCFE.
5. For residual income, make beginning book equity and every forecast period consistent with target_date;
   include net income, dividends, terminal ROE, and a bridge from final explicit ROE to terminal ROE.
6. For multiples, use at least three individually sourced same-period peer multiples. Put their ids in
   peer_multiple_evidence_ids. Match trailing with trailing or forward with forward. The compiler calculates
   the median and the applied premium/discount.
7. For CAPM, provide separate risk-free, beta, ERP, and additional-premium evidence ids. The claimed cost
   of equity must equal risk-free + beta x ERP + additional premium. A build-up method needs a full rationale.
8. A liquidation, book, or downside anchor that is not a going-concern fair value must have zero weight.
9. Positive method weights must total 100%. Prefer two strong independent methods over a weak third method.
10. Use consistent units. Monetary totals in residual income must match diluted_shares units. Use decimal
    rates in calculations even when evidence is recorded with unit `percent`.
11. Never use or search for AI_HEDGE outputs or benchmark reports.
12. Link the top-level reference price and diluted shares to exact evidence ids. Give every positive method
    weight an evidence-quality/economic-relevance rationale. Give every forecast cash-flow or residual-income
    period a driver rationale and evidence ids; repeating an unsupported CAGR is invalid.

Frozen snapshot:
{json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2)}

Independent audit blockers from the narrative report:
{json.dumps(blocking_audit, ensure_ascii=False, indent=2)}

Deterministic compile issues from the extracted case:
{json.dumps(list(compile_issues), ensure_ascii=False, indent=2)}

Independent economic-audit blockers from the prior structured case:
{json.dumps(prior_case_blockers, ensure_ascii=False, indent=2)}

Rejected extracted case, supplied only to expose missing fields and unit choices:
{json.dumps(extracted_case, ensure_ascii=False, indent=2)}

Narrative research context:
--- BEGIN RESEARCH ---
{report}
--- END RESEARCH ---
""".strip()


@dataclass(frozen=True)
class ValuationResearchResult:
    response_id: str
    status: str
    compiled: bool
    case_filename: str
    compiled_filename: str
    errors_filename: str
    sources_filename: str
    manifest_filename: str


def research_valuation_case(
    *,
    client: Any,
    config: DeepResearchConfig,
    snapshot: CompanySnapshot,
    run_dir: Path,
    report: str,
    audit: Mapping[str, Any],
    extracted_case: Mapping[str, Any],
    compile_issues: Sequence[str],
    prior_case_audit: Mapping[str, Any] | None = None,
    attempt: int = 1,
    sleep: Callable[[float], None] = time.sleep,
    progress: Callable[[str], None] = lambda _message: None,
) -> ValuationResearchResult:
    run_path = Path(run_dir)
    suffix = f"valuation_research_{attempt}"
    request_path = run_path / f"{suffix}_request.json"
    state_path = run_path / f"{suffix}_state.json"
    response_path = run_path / f"{suffix}_response.json"
    case_path = run_path / f"{suffix}_case.json"
    compiled_path = run_path / f"{suffix}_compiled.json"
    errors_path = run_path / f"{suffix}_errors.json"
    sources_path = run_path / f"{suffix}_sources.json"
    manifest_path = run_path / f"{suffix}_manifest.json"
    tools: list[dict[str, Any]] = [
        {"type": "web_search", "return_token_budget": config.return_token_budget}
    ]
    if config.enable_code_interpreter:
        tools.append({"type": "code_interpreter", "container": {"type": "auto"}})
    payload = {
        "model": config.model,
        "reasoning": {"effort": config.reasoning_effort},
        "instructions": (
            DEVELOPER_INSTRUCTIONS
            + "\nReturn only the structured valuation case. Do not return a narrative report."
        ),
        "input": build_valuation_research_prompt(
            snapshot=snapshot,
            report=report,
            audit=audit,
            extracted_case=extracted_case,
            compile_issues=compile_issues,
            prior_case_audit=prior_case_audit,
        ),
        "tools": tools,
        "tool_choice": "auto",
        "include": ["web_search_call.action.sources"],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "researched_valuation_case",
                "strict": True,
                "schema": valuation_case_schema(),
            }
        },
        "background": True,
        "store": config.store_remote_response,
        "max_tool_calls": config.max_tool_calls,
        "metadata": {
            "ticker": snapshot.ticker,
            "prompt_version": PROMPT_VERSION,
            "engine": "ai-hedge-valuation-research",
            "attempt": str(attempt),
        },
    }
    _write_json(request_path, payload)
    started_at = _iso_now()
    progress(f"Submitting structured valuation research attempt {attempt}")
    response = client.responses.create(**payload)
    response_id = _response_id(response)
    if not response_id:
        raise RuntimeError("Structured valuation research response has no id")
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
            raise TimeoutError(
                f"Structured valuation research timed out; resume response {response_id}."
            )
        sleep(config.poll_seconds)
        response = client.responses.retrieve(
            response_id,
            include=["web_search_call.action.sources"],
        )
        progress(f"Valuation research status: {_status(response)}")
    status = _status(response)
    raw = _response_text(response).strip()
    sources = extract_sources(response)
    _write_json(response_path, response)
    _write_json(sources_path, {"sources": sources})
    if status != "completed" or not raw:
        raise RuntimeError(
            f"Structured valuation research failed with status={status}; artifacts={run_path}"
        )
    valuation_case = json.loads(raw)
    if not isinstance(valuation_case, dict):
        raise RuntimeError("Structured valuation research did not return a JSON object")
    valuation_case["case_version"] = CASE_VERSION
    _write_json(case_path, valuation_case)
    try:
        compiled = compile_valuation_case(valuation_case)
    except ValuationCompilationError as exc:
        _write_json(errors_path, {"valid": False, "issues": list(exc.issues)})
        compiled_ok = False
    else:
        _write_json(compiled_path, {"valid": True, "compiled": compiled.to_dict()})
        compiled_ok = True
    _write_json(
        manifest_path,
        {
            "engine": "ai-hedge-valuation-research",
            "attempt": attempt,
            "ticker": snapshot.ticker,
            "status": status,
            "response_id": response_id,
            "started_at": started_at,
            "completed_at": _iso_now(),
            "model_requested": config.model,
            "model_actual": str(getattr(response, "model", "") or ""),
            "source_count": len(sources),
            "compiled": compiled_ok,
            "usage": _jsonable(getattr(response, "usage", None)),
        },
    )
    return ValuationResearchResult(
        response_id=response_id,
        status=status,
        compiled=compiled_ok,
        case_filename=case_path.name,
        compiled_filename=compiled_path.name,
        errors_filename=errors_path.name,
        sources_filename=sources_path.name,
        manifest_filename=manifest_path.name,
    )
