from __future__ import annotations

import hashlib
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

from .engine import _jsonable, _response_text, _write_json, extract_sources
from .prompt import DEVELOPER_INSTRUCTIONS, PROMPT_VERSION, build_research_prompt
from .quality import evaluate_run_artifacts, write_quality_report
from .snapshot import CompanySnapshot


GEMINI_AGENT = "deep-research-preview-04-2026"
XAI_MODEL = "grok-4.7"
_GEMINI_ACTIVE_STATUSES = {"queued", "in_progress"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _required_key(name: str) -> str:
    value = str(os.getenv(name, "") or "").strip().lstrip("\ufeff")
    if not value:
        raise RuntimeError(f"{name} is missing from the repository .env file")
    return value


def _field(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(name, default)
    return getattr(value, name, default)


def _gemini_report_text(response: Any) -> str:
    direct = str(getattr(response, "output_text", "") or "").strip()
    if direct:
        return direct
    raw = _jsonable(response)
    if not isinstance(raw, Mapping):
        return ""
    chunks: list[str] = []
    output_items = raw.get("outputs") or raw.get("output") or []
    for step in raw.get("steps") or []:
        if isinstance(step, Mapping) and step.get("type") == "model_output":
            output_items.extend(step.get("content") or [])
    for item in output_items:
        if not isinstance(item, Mapping) or item.get("type") not in {
            "text",
            "output_text",
        }:
            continue
        text = str(item.get("text") or "").strip()
        if text:
            chunks.append(text)
    return "\n\n".join(chunks).strip()


def _gemini_sources(response: Any) -> list[dict[str, Any]]:
    raw = _jsonable(response)
    by_url: dict[str, dict[str, Any]] = {}

    def visit(value: Any) -> None:
        if isinstance(value, Mapping):
            if value.get("type") == "url_citation" and value.get("url"):
                url = str(value["url"]).strip()
                if url:
                    row = by_url.setdefault(
                        url,
                        {
                            "url": url,
                            "title": str(value.get("title") or url),
                            "consulted": True,
                            "cited": True,
                            "citation_spans": [],
                        },
                    )
                    span = {
                        "start_index": value.get("start_index"),
                        "end_index": value.get("end_index"),
                    }
                    if span not in row["citation_spans"]:
                        row["citation_spans"].append(span)
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(raw)
    return sorted(by_url.values(), key=lambda row: row["url"])


def _xai_cost(usage: Any) -> dict[str, Any]:
    raw = _jsonable(usage)
    raw = raw if isinstance(raw, Mapping) else {}
    ticks = raw.get("cost_in_usd_ticks")
    try:
        cost_usd = float(ticks) / 10_000_000_000 if ticks is not None else None
    except (TypeError, ValueError):
        cost_usd = None
    return {
        "currency": "USD",
        "kind": "provider_reported_exact" if cost_usd is not None else "unavailable",
        "cost_in_usd_ticks": ticks,
        "cost_usd": cost_usd,
    }


def _gemini_cost(usage: Any) -> dict[str, Any]:
    raw = _jsonable(usage)
    raw = raw if isinstance(raw, Mapping) else {}
    input_tokens = int(
        raw.get("total_input_tokens") or raw.get("prompt_tokens") or 0
    )
    cached_tokens = int(
        raw.get("total_cached_tokens") or raw.get("cached_tokens") or 0
    )
    output_tokens = int(
        raw.get("total_output_tokens") or raw.get("completion_tokens") or 0
    )
    thought_tokens = int(
        raw.get("total_thought_tokens") or raw.get("thought_tokens") or 0
    )
    tool_use_tokens = int(raw.get("total_tool_use_tokens") or 0)
    billable_input = max(0, input_tokens + tool_use_tokens - cached_tokens)
    billable_output = output_tokens + thought_tokens
    # The agent reports cumulative usage, but not the per-step prompt sizes that
    # determine Gemini 3.1 Pro's <=200k versus >200k rate. Preserve that
    # uncertainty as a range rather than presenting false precision.
    low_context_token_estimate = (
        billable_input * 2.00
        + cached_tokens * 0.20
        + billable_output * 12.00
    ) / 1_000_000
    high_context_token_estimate = (
        billable_input * 4.00
        + cached_tokens * 0.40
        + billable_output * 18.00
    ) / 1_000_000
    search_queries = 0
    for item in raw.get("grounding_tool_count") or []:
        if isinstance(item, Mapping) and item.get("type") == "google_search":
            search_queries += int(item.get("count") or 0)
    search_if_billable = search_queries * 14.0 / 1_000
    return {
        "currency": "USD",
        "kind": "usage_based_estimate",
        "token_cost_estimate_usd": round(low_context_token_estimate, 6),
        "token_cost_estimate_range_usd": {
            "minimum": round(low_context_token_estimate, 6),
            "maximum": round(high_context_token_estimate, 6),
        },
        "google_search_queries": search_queries,
        "search_cost_if_outside_free_allowance_usd": round(search_if_billable, 6),
        "total_estimate_range_if_searches_free_usd": {
            "minimum": round(low_context_token_estimate, 6),
            "maximum": round(high_context_token_estimate, 6),
        },
        "total_estimate_range_if_all_searches_billable_usd": {
            "minimum": round(low_context_token_estimate + search_if_billable, 6),
            "maximum": round(high_context_token_estimate + search_if_billable, 6),
        },
        "official_typical_task_estimate_usd": {"minimum": 1.0, "maximum": 3.0},
        "note": (
            "Gemini does not return an exact billed-dollar field or per-step prompt "
            "sizes. The range uses current Gemini 3.1 Pro Preview standard rates "
            "for prompts at or below versus above 200k tokens. Google Search may "
            "be covered by the account's monthly free allowance."
        ),
    }


@dataclass(frozen=True)
class ProviderBenchmarkResult:
    provider: str
    status: str
    output_dir: Path
    report_path: Path
    manifest_path: Path
    quality_path: Path


class ProviderBenchmarkEngine:
    """Run the same frozen research prompt through a non-OpenAI provider."""

    def __init__(
        self,
        *,
        provider: str,
        model: Optional[str] = None,
        timeout_seconds: int = 3600,
        poll_seconds: float = 10.0,
        api_key: Optional[str] = None,
        client: Any = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] = _utc_now,
        progress: Optional[Callable[[str], None]] = None,
    ) -> None:
        normalized = provider.strip().lower()
        if normalized not in {"gemini", "xai"}:
            raise ValueError("provider must be 'gemini' or 'xai'")
        self.provider = normalized
        self.model = model or (GEMINI_AGENT if normalized == "gemini" else XAI_MODEL)
        self.timeout_seconds = timeout_seconds
        self.poll_seconds = poll_seconds
        self.api_key = api_key
        self._client = client
        self._sleep = sleep
        self._now = now
        self._progress = progress or (lambda _message: None)

    @property
    def client(self) -> Any:
        if self.provider == "gemini":
            if self._client is None:
                raise RuntimeError("Gemini production runs use the direct REST client")
            return self._client
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(
                api_key=self.api_key or _required_key("XAI_API_KEY"),
                base_url="https://api.x.ai/v1",
                timeout=float(self.timeout_seconds),
                max_retries=3,
            )
        return self._client

    def run(
        self,
        snapshot: CompanySnapshot,
        *,
        output_root: Path,
    ) -> ProviderBenchmarkResult:
        started_at = self._now()
        run_id = self._run_id(snapshot.ticker, started_at)
        output_dir = (
            Path(output_root).resolve() / self.provider / snapshot.ticker / run_id
        )
        output_dir.mkdir(parents=True, exist_ok=False)
        prompt = build_research_prompt(snapshot)
        (output_dir / "research_prompt.md").write_text(
            prompt + "\n", encoding="utf-8"
        )
        _write_json(output_dir / "snapshot.json", snapshot.to_dict())

        if self.provider == "gemini":
            response, request = self._run_gemini(prompt)
            report = _gemini_report_text(response)
            sources = _gemini_sources(response)
            cost = _gemini_cost(_field(response, "usage"))
        else:
            response, request = self._run_xai(prompt)
            report = _response_text(response)
            sources = extract_sources(response)
            cost = _xai_cost(_field(response, "usage"))

        completed_at = self._now()
        status = str(_field(response, "status", "completed") or "completed").lower()
        if status not in {"completed", "succeeded"}:
            raise RuntimeError(f"{self.provider} research ended with status={status}")
        if not report:
            raise RuntimeError(f"{self.provider} completed without report text")

        (output_dir / "research_report.md").write_text(
            report + "\n", encoding="utf-8"
        )
        _write_json(output_dir / "request.json", request)
        _write_json(output_dir / "response.json", response)
        _write_json(output_dir / "research_sources.json", {"sources": sources})
        manifest = {
            "engine": "ai-hedge-provider-benchmark",
            "engine_contract_version": 1,
            "provider": self.provider,
            "model_requested": self.model,
            "model_actual": str(_field(response, "model", "") or self.model),
            "prompt_version": PROMPT_VERSION,
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "run_id": run_id,
            "ticker": snapshot.ticker,
            "company_name": snapshot.company_name,
            "status": status,
            "started_at": _iso(started_at),
            "completed_at": _iso(completed_at),
            "duration_seconds": round((completed_at - started_at).total_seconds(), 3),
            "source_count": len(sources),
            "cited_source_count": sum(1 for row in sources if row.get("cited")),
            "usage": _jsonable(_field(response, "usage")),
            "cost": cost,
        }
        _write_json(output_dir / "research_manifest.json", manifest)
        quality = evaluate_run_artifacts(output_dir)
        quality_path = write_quality_report(output_dir, quality)
        return ProviderBenchmarkResult(
            provider=self.provider,
            status=status,
            output_dir=output_dir,
            report_path=output_dir / "research_report.md",
            manifest_path=output_dir / "research_manifest.json",
            quality_path=quality_path,
        )

    def _run_gemini(self, prompt: str) -> tuple[Any, dict[str, Any]]:
        # Gemini Deep Research does not accept a separate system instruction.
        # Preserve the common provider contract by placing the same instructions
        # ahead of the frozen research prompt.
        combined_prompt = f"{DEVELOPER_INSTRUCTIONS.strip()}\n\n{prompt}"
        request = {
            "agent": self.model,
            "input": combined_prompt,
            "agent_config": {
                "type": "deep-research",
                "thinking_summaries": "none",
                "visualization": "off",
            },
            "background": True,
            "store": True,
        }
        self._progress(f"Submitting Gemini Deep Research agent {self.model}")
        if self._client is not None:
            response = self.client.interactions.create(**request)
            retrieve = self.client.interactions.get
        else:
            import requests

            api_key = self.api_key or _required_key("GEMINI_API_KEY")
            base_url = "https://generativelanguage.googleapis.com/v1beta/interactions"
            session = requests.Session()
            headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
            http_response = session.post(
                base_url,
                headers=headers,
                json=request,
                timeout=120,
            )
            if not http_response.ok:
                raise RuntimeError(
                    f"Gemini HTTP {http_response.status_code}: "
                    f"{http_response.text[:2_000]}"
                )
            response = http_response.json()

            def retrieve(interaction_id: str) -> Any:
                polled = session.get(
                    f"{base_url}/{interaction_id}",
                    headers={"x-goog-api-key": api_key},
                    timeout=120,
                )
                if not polled.ok:
                    raise RuntimeError(
                        f"Gemini poll HTTP {polled.status_code}: {polled.text[:2_000]}"
                    )
                return polled.json()

        deadline = time.monotonic() + self.timeout_seconds
        last_status = ""
        while str(_field(response, "status", "") or "").lower() in _GEMINI_ACTIVE_STATUSES:
            status = str(_field(response, "status", "") or "").lower()
            interaction_id = str(_field(response, "id", "") or "")
            if status != last_status:
                self._progress(f"Gemini interaction {interaction_id} status: {status}")
                last_status = status
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Gemini interaction {interaction_id} timed out")
            self._sleep(self.poll_seconds)
            response = retrieve(interaction_id)
        self._progress(
            f"Gemini interaction {_field(response, 'id', '')} reached status: "
            f"{_field(response, 'status', '')}"
        )
        return response, request

    def _run_xai(self, prompt: str) -> tuple[Any, dict[str, Any]]:
        request = {
            "model": self.model,
            "instructions": DEVELOPER_INSTRUCTIONS,
            "input": prompt,
            "reasoning": {"effort": "xhigh"},
            "tools": [{"type": "web_search"}, {"type": "code_interpreter"}],
            "tool_choice": "auto",
        }
        self._progress(f"Submitting xAI research response {self.model}")
        response = self.client.responses.create(**request)
        self._progress(
            f"xAI response {getattr(response, 'id', '')} reached status: "
            f"{getattr(response, 'status', 'completed')}"
        )
        return response, request

    def _run_id(self, ticker: str, now: datetime) -> str:
        stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        return f"run-{stamp}-{ticker}-{self.provider}-{uuid.uuid4().hex[:8]}"
