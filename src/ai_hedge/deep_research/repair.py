from __future__ import annotations

import json
import time
from dataclasses import dataclass
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
from .prompt import (
    DEVELOPER_INSTRUCTIONS,
    PROMPT_VERSION,
    build_research_prompt,
)
from .snapshot import CompanySnapshot


_ACTIVE_STATUSES = {"queued", "in_progress"}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def build_repair_prompt(
    snapshot: CompanySnapshot,
    audit: Mapping[str, Any],
    *,
    attempt: int,
) -> str:
    semantic_issues = [
        issue
        for issue in audit.get("issues") or []
        if isinstance(issue, Mapping) and issue.get("severity") in {"critical", "major"}
    ]
    arithmetic = audit.get("deterministic_arithmetic")
    repair_packet = {
        "semantic_blockers": semantic_issues,
        "deterministic_arithmetic": arithmetic,
    }
    return f"""
{build_research_prompt(snapshot)}

# Mandatory fresh-rebuild quality packet

An independent audit rejected an earlier, separate run. Research the company afresh and produce a full,
self-contained report under the complete specification above. Do not continue, quote, summarize, or rely
on the rejected response. Do not return a patch, errata list, or commentary about the audit. Every source
and inline citation in this new report must be retrieved and emitted in this run.

Repair attempt: {attempt}

Mandatory repair protocol:
1. Re-research any unsupported or stale valuation input with live web search and cite the exact source.
2. Rebuild every affected valuation table with Code Interpreter and show internally reconciling values.
3. Resolve period mismatches using a correct stub period or a consistent beginning balance; never combine
   a mid-year balance with a full-year flow that includes already-earned periods.
4. If a peer multiple, beta, risk premium, terminal assumption, share denominator, or third method cannot
   be supported, reduce or remove its weight and renormalize valid method weights to 100%.
5. Keep entity scope, quote currency, reporting currency, valuation date, and diluted share basis explicit.
6. Ensure displayed rounded inputs reconcile to the displayed target within normal rounding tolerance.
7. Never emit an empty citation placeholder. Cite a specific retrievable URL next to every material fact.
8. Put all included valuation methods on one explicit valuation date or target date. Match trailing with
   trailing and forward with same-period forward; discount or roll values when dates differ.
9. Prefer a point-in-time fully diluted share denominator. If unavailable, bridge current basic shares,
   incremental dilution, and any weighted-average proxy, then disclose the residual limitation.
10. Return the entire polished Markdown report with inline citations and an updated Valuation Control Summary.
11. Do not mention AI_HEDGE, benchmark reports, hidden prompts, or this rebuild workflow in the final report.

Blocking audit packet:
{json.dumps(repair_packet, ensure_ascii=False, indent=2)}
""".strip()


@dataclass(frozen=True)
class RepairResult:
    attempt: int
    status: str
    response_id: str
    report_filename: str
    sources_filename: str
    response_filename: str
    manifest_filename: str


def run_repair(
    *,
    client: Any,
    config: DeepResearchConfig,
    snapshot: CompanySnapshot,
    run_dir: Path,
    previous_response_id: str,
    audit: Mapping[str, Any],
    attempt: int,
    sleep: Callable[[float], None] = time.sleep,
    progress: Callable[[str], None] = lambda _message: None,
) -> RepairResult:
    if attempt <= 0:
        raise ValueError("Repair attempt must be positive")
    if not previous_response_id:
        raise ValueError("A prior response id is required for rebuild lineage")
    run_path = Path(run_dir)
    suffix = f"repair_{attempt}"
    request_path = run_path / f"{suffix}_request.json"
    state_path = run_path / f"{suffix}_state.json"
    response_path = run_path / f"{suffix}_response.json"
    report_path = run_path / f"research_report_{suffix}.md"
    sources_path = run_path / f"research_sources_{suffix}.json"
    manifest_path = run_path / f"research_manifest_{suffix}.json"

    tools: list[dict[str, Any]] = [
        {
            "type": "web_search",
            "return_token_budget": config.return_token_budget,
        }
    ]
    if config.enable_code_interpreter:
        tools.append({"type": "code_interpreter", "container": {"type": "auto"}})
    payload = {
        "model": config.model,
        "reasoning": {"effort": config.reasoning_effort},
        "instructions": DEVELOPER_INSTRUCTIONS
        + "\nThe current task is a quality-control revision. Return the full corrected report.",
        "input": build_repair_prompt(snapshot, audit, attempt=attempt),
        "tools": tools,
        "tool_choice": "auto",
        "include": ["web_search_call.action.sources"],
        "background": True,
        "store": config.store_remote_response,
        "max_tool_calls": config.max_tool_calls,
        "metadata": {
            "ticker": snapshot.ticker,
            "prompt_version": PROMPT_VERSION,
            "engine": "ai-hedge-deep-research",
            "mode": "fresh-rebuild",
            "repair_attempt": str(attempt),
        },
    }
    _write_json(request_path, payload)
    started_at = _iso_now()
    progress(f"Submitting repair attempt {attempt} for {snapshot.ticker}")
    response = client.responses.create(**payload)
    response_id = _response_id(response)
    if not response_id:
        raise RuntimeError("OpenAI repair response has no id")
    deadline = time.monotonic() + config.timeout_seconds
    while _status(response) in _ACTIVE_STATUSES:
        _write_json(
            state_path,
            {
                "attempt": attempt,
                "response_id": response_id,
                "status": _status(response),
                "updated_at": _iso_now(),
            },
        )
        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"Repair attempt {attempt} timed out; resume response {response_id}."
            )
        sleep(config.poll_seconds)
        response = client.responses.retrieve(
            response_id,
            include=["web_search_call.action.sources"],
        )
        progress(f"Repair {attempt} status: {_status(response)}")

    status = _status(response)
    report = _response_text(response)
    sources = extract_sources(response)
    _write_json(response_path, response)
    _write_json(sources_path, {"sources": sources})
    report_path.write_text(report + ("\n" if report else ""), encoding="utf-8")
    _write_json(
        manifest_path,
        {
            "engine": "ai-hedge-deep-research",
            "prompt_version": PROMPT_VERSION,
            "repair_attempt": attempt,
            "ticker": snapshot.ticker,
            "status": status,
            "previous_response_id": previous_response_id,
            "mode": "fresh-rebuild",
            "response_id": response_id,
            "started_at": started_at,
            "completed_at": _iso_now(),
            "model_requested": config.model,
            "model_actual": str(getattr(response, "model", "") or ""),
            "source_count": len(sources),
            "cited_source_count": sum(1 for source in sources if source.get("cited")),
            "usage": _jsonable(getattr(response, "usage", None)),
        },
    )
    if status != "completed" or not report:
        raise RuntimeError(
            f"Repair attempt {attempt} failed with status={status}; artifacts={run_path}"
        )
    return RepairResult(
        attempt=attempt,
        status=status,
        response_id=response_id,
        report_filename=report_path.name,
        sources_filename=sources_path.name,
        response_filename=response_path.name,
        manifest_filename=manifest_path.name,
    )
