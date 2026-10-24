from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from .broker_case import (
    BROKER_CASE_VERSION,
    broker_valuation_case_schema,
    build_broker_research_prompt,
)
from .broker_compiler import (
    BROKER_COMPILER_VERSION,
    compile_broker_valuation_case,
)
from .compiler import ValuationCompilationError
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


@dataclass(frozen=True)
class BrokerResearchResult:
    response_id: str
    status: str
    compiled: bool
    case_filename: str
    compiled_filename: str
    errors_filename: str
    sources_filename: str
    manifest_filename: str


def research_broker_valuation_case(
    *,
    client: Any,
    config: DeepResearchConfig,
    snapshot: CompanySnapshot,
    run_dir: Path,
    report: str,
    narrative_audit: Mapping[str, Any],
    prior_case: Mapping[str, Any] | None = None,
    prior_case_audit: Mapping[str, Any] | None = None,
    attempt: int = 1,
    sleep: Callable[[float], None] = time.sleep,
    progress: Callable[[str], None] = lambda _message: None,
) -> BrokerResearchResult:
    run_path = Path(run_dir)
    suffix = f"broker_valuation_research_{attempt}"
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
            + "\nReturn only the strict broker valuation JSON. Do not return prose."
        ),
        "input": build_broker_research_prompt(
            snapshot=snapshot,
            report=report,
            narrative_audit=narrative_audit,
            prior_case=prior_case,
            prior_case_audit=prior_case_audit,
        ),
        "tools": tools,
        "tool_choice": "auto",
        "include": ["web_search_call.action.sources"],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "broker_valuation_case",
                "strict": True,
                "schema": broker_valuation_case_schema(),
            }
        },
        "background": True,
        "store": config.store_remote_response,
        "max_tool_calls": config.max_tool_calls,
        "metadata": {
            "ticker": snapshot.ticker,
            "prompt_version": PROMPT_VERSION,
            "case_version": BROKER_CASE_VERSION,
            "engine": "ai-hedge-broker-valuation-research",
            "attempt": str(attempt),
        },
    }
    _write_json(request_path, payload)
    started_at = _iso_now()
    progress(f"Submitting broker valuation research attempt {attempt}")
    response = client.responses.create(**payload)
    response_id = _response_id(response)
    if not response_id:
        raise RuntimeError("Broker valuation research response has no id")
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
                f"Broker valuation research timed out; resume response {response_id}."
            )
        sleep(config.poll_seconds)
        response = client.responses.retrieve(
            response_id,
            include=["web_search_call.action.sources"],
        )
        progress(f"Broker valuation research status: {_status(response)}")
    status = _status(response)
    raw = _response_text(response).strip()
    sources = extract_sources(response)
    _write_json(response_path, response)
    _write_json(sources_path, {"sources": sources})
    if status != "completed" or not raw:
        raise RuntimeError(
            f"Broker valuation research failed with status={status}; artifacts={run_path}"
        )
    valuation_case = json.loads(raw)
    if not isinstance(valuation_case, dict):
        raise RuntimeError("Broker valuation research did not return a JSON object")
    valuation_case["case_version"] = BROKER_CASE_VERSION
    _write_json(case_path, valuation_case)
    try:
        compiled = compile_broker_valuation_case(valuation_case)
    except ValuationCompilationError as exc:
        _write_json(errors_path, {"valid": False, "issues": list(exc.issues)})
        compiled_ok = False
    else:
        _write_json(
            compiled_path,
            {
                "valid": True,
                "compiler_version": BROKER_COMPILER_VERSION,
                "compiled": compiled.to_dict(),
            },
        )
        compiled_ok = True
    _write_json(
        manifest_path,
        {
            "engine": "ai-hedge-broker-valuation-research",
            "attempt": attempt,
            "ticker": snapshot.ticker,
            "status": status,
            "response_id": response_id,
            "started_at": started_at,
            "completed_at": _iso_now(),
            "model_requested": config.model,
            "model_actual": str(getattr(response, "model", "") or ""),
            "case_version": BROKER_CASE_VERSION,
            "compiler_version": BROKER_COMPILER_VERSION,
            "source_count": len(sources),
            "compiled": compiled_ok,
            "usage": _jsonable(getattr(response, "usage", None)),
        },
    )
    return BrokerResearchResult(
        response_id=response_id,
        status=status,
        compiled=compiled_ok,
        case_filename=case_path.name,
        compiled_filename=compiled_path.name,
        errors_filename=errors_path.name,
        sources_filename=sources_path.name,
        manifest_filename=manifest_path.name,
    )
