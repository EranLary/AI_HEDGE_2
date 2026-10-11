from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Optional
from urllib.parse import urlsplit, urlunsplit

from .config import DeepResearchConfig, require_openai_api_key
from .prompt import DEVELOPER_INSTRUCTIONS, PROMPT_VERSION, build_research_prompt
from .snapshot import CompanySnapshot


_ACTIVE_STATUSES = {"queued", "in_progress"}
_SUCCESS_STATUS = "completed"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "model_dump"):
        try:
            dumped = value.model_dump(mode="json", exclude_none=False, warnings=False)
        except TypeError:
            dumped = value.model_dump(mode="json", exclude_none=False)
        return _jsonable(dumped)
    if hasattr(value, "to_dict"):
        return _jsonable(value.to_dict())
    if hasattr(value, "__dict__"):
        return _jsonable(vars(value))
    return str(value)


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(_jsonable(payload), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _status(response: Any) -> str:
    return str(getattr(response, "status", "") or "unknown").strip().lower()


def _response_id(response: Any) -> str:
    return str(getattr(response, "id", "") or "").strip()


def _response_text(response: Any) -> str:
    direct = str(getattr(response, "output_text", "") or "").strip()
    if direct:
        return direct
    raw = _jsonable(response)
    if not isinstance(raw, Mapping):
        return ""
    chunks: list[str] = []
    for item in raw.get("output") or []:
        if not isinstance(item, Mapping) or item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if isinstance(content, Mapping) and content.get("type") in {
                "output_text",
                "text",
            }:
                text = str(content.get("text") or "").strip()
                if text:
                    chunks.append(text)
    return "\n\n".join(chunks).strip()


def _canonical_url(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ""
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return ""
    return urlunsplit(
        (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, parsed.query, "")
    )


def extract_sources(response: Any) -> list[dict[str, Any]]:
    """Return the union of consulted web sources and visible URL citations."""

    raw = _jsonable(response)
    if not isinstance(raw, Mapping):
        return []
    by_url: dict[str, dict[str, Any]] = {}

    def add_source(
        source: Mapping[str, Any],
        *,
        consulted: bool,
        cited: bool,
        annotation: Optional[Mapping[str, Any]] = None,
    ) -> None:
        nested = source.get("url_citation")
        candidate: Mapping[str, Any] = nested if isinstance(nested, Mapping) else source
        url = _canonical_url(candidate.get("url"))
        if not url:
            return
        existing = by_url.setdefault(
            url,
            {
                "url": url,
                "title": str(candidate.get("title") or url),
                "consulted": False,
                "cited": False,
                "citation_spans": [],
            },
        )
        existing["consulted"] = bool(existing["consulted"] or consulted)
        existing["cited"] = bool(existing["cited"] or cited)
        if not existing.get("title") and candidate.get("title"):
            existing["title"] = str(candidate.get("title"))
        if annotation:
            span = {
                "start_index": annotation.get("start_index"),
                "end_index": annotation.get("end_index"),
            }
            if span not in existing["citation_spans"]:
                existing["citation_spans"].append(span)

    for item in raw.get("output") or []:
        if not isinstance(item, Mapping):
            continue
        if item.get("type") == "web_search_call":
            action = item.get("action")
            if isinstance(action, Mapping):
                for source in action.get("sources") or []:
                    if isinstance(source, Mapping):
                        add_source(source, consulted=True, cited=False)
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if not isinstance(content, Mapping):
                continue
            for annotation in content.get("annotations") or []:
                if not isinstance(annotation, Mapping):
                    continue
                annotation_type = str(annotation.get("type") or "")
                if annotation_type == "url_citation" or "url" in annotation:
                    add_source(
                        annotation,
                        consulted=False,
                        cited=True,
                        annotation=annotation,
                    )
    return sorted(
        by_url.values(),
        key=lambda row: (not bool(row.get("cited")), not bool(row.get("consulted")), row["url"]),
    )


@dataclass(frozen=True)
class DeepResearchRunResult:
    run_id: str
    ticker: str
    status: str
    response_id: str
    output_dir: Path
    report_path: Path
    sources_path: Path
    manifest_path: Path
    response_path: Path
    prompt_path: Path


class DeepResearchEngine:
    """Create, poll, and persist one independent OpenAI research response."""

    def __init__(
        self,
        *,
        config: Optional[DeepResearchConfig] = None,
        client: Any = None,
        api_key: Optional[str] = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] = _utc_now,
        progress: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.config = config or DeepResearchConfig.from_env()
        self._client = client
        self._api_key = api_key
        self._sleep = sleep
        self._now = now
        self._progress = progress or (lambda _message: None)

    @property
    def client(self) -> Any:
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(
                api_key=self._api_key or require_openai_api_key(),
                timeout=120.0,
                max_retries=3,
            )
        return self._client

    def request_payload(
        self,
        snapshot: CompanySnapshot,
        *,
        prompt: Optional[str] = None,
        run_id: str,
    ) -> dict[str, Any]:
        tools: list[dict[str, Any]] = [
            {
                "type": "web_search",
                "return_token_budget": self.config.return_token_budget,
            }
        ]
        if self.config.enable_code_interpreter:
            tools.append(
                {
                    "type": "code_interpreter",
                    "container": {"type": "auto"},
                }
            )
        return {
            "model": self.config.model,
            "reasoning": {"effort": self.config.reasoning_effort},
            "instructions": DEVELOPER_INSTRUCTIONS,
            "input": prompt or build_research_prompt(snapshot),
            "tools": tools,
            "tool_choice": "auto",
            "include": ["web_search_call.action.sources"],
            "background": True,
            "store": self.config.store_remote_response,
            "max_tool_calls": self.config.max_tool_calls,
            "metadata": {
                "run_id": run_id,
                "ticker": snapshot.ticker,
                "prompt_version": PROMPT_VERSION,
                "engine": "ai-hedge-deep-research",
            },
        }

    def run(
        self,
        snapshot: CompanySnapshot,
        *,
        output_root: Path,
        dry_run: bool = False,
    ) -> DeepResearchRunResult:
        started_at = self._now()
        run_id = self._new_run_id(snapshot.ticker, started_at)
        output_dir = Path(output_root).resolve() / snapshot.ticker / run_id
        output_dir.mkdir(parents=True, exist_ok=False)
        prompt = build_research_prompt(snapshot)
        paths = self._initial_artifacts(
            output_dir=output_dir,
            snapshot=snapshot,
            prompt=prompt,
            run_id=run_id,
            started_at=started_at,
        )
        payload = self.request_payload(snapshot, prompt=prompt, run_id=run_id)
        _write_json(paths["request"], payload)

        if dry_run:
            manifest = self._manifest(
                snapshot=snapshot,
                run_id=run_id,
                status="dry_run",
                response_id="",
                started_at=started_at,
                completed_at=self._now(),
                prompt=prompt,
                response=None,
                sources=[],
            )
            _write_json(paths["manifest"], manifest)
            return self._result(snapshot, run_id, "dry_run", "", output_dir, paths)

        self._progress(f"Submitting {snapshot.ticker} Deep Research run {run_id}")
        response = self.client.responses.create(**payload)
        response_id = _response_id(response)
        if not response_id:
            raise RuntimeError("OpenAI returned a response without an id")
        self._write_poll_state(paths["state"], run_id, response)
        response = self._poll(response, paths["state"], run_id=run_id)
        return self._finalize(
            snapshot=snapshot,
            run_id=run_id,
            output_dir=output_dir,
            paths=paths,
            prompt=prompt,
            started_at=started_at,
            response=response,
        )

    def resume(
        self,
        snapshot: CompanySnapshot,
        *,
        response_id: str,
        output_root: Path,
    ) -> DeepResearchRunResult:
        started_at = self._now()
        run_id = self._new_run_id(snapshot.ticker, started_at, prefix="resume")
        output_dir = Path(output_root).resolve() / snapshot.ticker / run_id
        output_dir.mkdir(parents=True, exist_ok=False)
        prompt = build_research_prompt(snapshot)
        paths = self._initial_artifacts(
            output_dir=output_dir,
            snapshot=snapshot,
            prompt=prompt,
            run_id=run_id,
            started_at=started_at,
        )
        self._progress(f"Resuming OpenAI response {response_id}")
        response = self.client.responses.retrieve(
            response_id,
            include=["web_search_call.action.sources"],
        )
        self._write_poll_state(paths["state"], run_id, response)
        response = self._poll(response, paths["state"], run_id=run_id)
        return self._finalize(
            snapshot=snapshot,
            run_id=run_id,
            output_dir=output_dir,
            paths=paths,
            prompt=prompt,
            started_at=started_at,
            response=response,
        )

    def _poll(self, response: Any, state_path: Path, *, run_id: str) -> Any:
        deadline = time.monotonic() + self.config.timeout_seconds
        last_status = ""
        while _status(response) in _ACTIVE_STATUSES:
            current_status = _status(response)
            if current_status != last_status:
                self._progress(
                    f"OpenAI response {_response_id(response)} status: {current_status}"
                )
                last_status = current_status
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    "Deep Research polling timed out. The background response may still be "
                    f"running; resume it with response id {_response_id(response)}."
                )
            self._sleep(self.config.poll_seconds)
            response = self.client.responses.retrieve(
                _response_id(response),
                include=["web_search_call.action.sources"],
            )
            self._write_poll_state(state_path, run_id, response)
        self._progress(
            f"OpenAI response {_response_id(response)} reached terminal status: {_status(response)}"
        )
        return response

    def _finalize(
        self,
        *,
        snapshot: CompanySnapshot,
        run_id: str,
        output_dir: Path,
        paths: dict[str, Path],
        prompt: str,
        started_at: datetime,
        response: Any,
    ) -> DeepResearchRunResult:
        status = _status(response)
        report = _response_text(response)
        sources = extract_sources(response)
        paths["report"].write_text(report + ("\n" if report else ""), encoding="utf-8")
        _write_json(paths["sources"], {"sources": sources})
        _write_json(paths["response"], response)
        manifest = self._manifest(
            snapshot=snapshot,
            run_id=run_id,
            status=status,
            response_id=_response_id(response),
            started_at=started_at,
            completed_at=self._now(),
            prompt=prompt,
            response=response,
            sources=sources,
        )
        _write_json(paths["manifest"], manifest)
        result = self._result(
            snapshot,
            run_id,
            status,
            _response_id(response),
            output_dir,
            paths,
        )
        if status != _SUCCESS_STATUS:
            error = _jsonable(getattr(response, "error", None))
            incomplete = _jsonable(getattr(response, "incomplete_details", None))
            raise RuntimeError(
                f"Deep Research ended with status={status}; error={error}; "
                f"incomplete_details={incomplete}; artifacts={output_dir}"
            )
        if not report:
            raise RuntimeError(f"Deep Research completed without report text: {output_dir}")
        return result

    def _initial_artifacts(
        self,
        *,
        output_dir: Path,
        snapshot: CompanySnapshot,
        prompt: str,
        run_id: str,
        started_at: datetime,
    ) -> dict[str, Path]:
        paths = {
            "snapshot": output_dir / "snapshot.json",
            "prompt": output_dir / "research_prompt.md",
            "request": output_dir / "request.json",
            "state": output_dir / "state.json",
            "response": output_dir / "response.json",
            "report": output_dir / "research_report.md",
            "sources": output_dir / "research_sources.json",
            "manifest": output_dir / "research_manifest.json",
        }
        _write_json(paths["snapshot"], snapshot.to_dict())
        paths["prompt"].write_text(prompt + "\n", encoding="utf-8")
        _write_json(
            paths["state"],
            {
                "run_id": run_id,
                "status": "prepared",
                "started_at": _iso(started_at),
                "response_id": "",
            },
        )
        return paths

    def _write_poll_state(self, path: Path, run_id: str, response: Any) -> None:
        _write_json(
            path,
            {
                "run_id": run_id,
                "response_id": _response_id(response),
                "status": _status(response),
                "updated_at": _iso(self._now()),
                "error": _jsonable(getattr(response, "error", None)),
                "incomplete_details": _jsonable(
                    getattr(response, "incomplete_details", None)
                ),
            },
        )

    def _manifest(
        self,
        *,
        snapshot: CompanySnapshot,
        run_id: str,
        status: str,
        response_id: str,
        started_at: datetime,
        completed_at: datetime,
        prompt: str,
        response: Any,
        sources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        usage = _jsonable(getattr(response, "usage", None)) if response else None
        return {
            "engine": "ai-hedge-deep-research",
            "engine_contract_version": 1,
            "prompt_version": PROMPT_VERSION,
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "run_id": run_id,
            "ticker": snapshot.ticker,
            "company_name": snapshot.company_name,
            "status": status,
            "response_id": response_id,
            "started_at": _iso(started_at),
            "completed_at": _iso(completed_at),
            "model_requested": self.config.model,
            "model_actual": str(getattr(response, "model", "") or "") if response else "",
            "reasoning_effort": self.config.reasoning_effort,
            "max_tool_calls": self.config.max_tool_calls,
            "return_token_budget": self.config.return_token_budget,
            "code_interpreter_enabled": self.config.enable_code_interpreter,
            "remote_response_stored": self.config.store_remote_response,
            "source_count": len(sources),
            "cited_source_count": sum(1 for source in sources if source.get("cited")),
            "consulted_source_count": sum(
                1 for source in sources if source.get("consulted")
            ),
            "usage": usage,
            "error": _jsonable(getattr(response, "error", None)) if response else None,
            "incomplete_details": (
                _jsonable(getattr(response, "incomplete_details", None))
                if response
                else None
            ),
        }

    @staticmethod
    def _new_run_id(ticker: str, now: datetime, *, prefix: str = "run") -> str:
        timestamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        return f"{prefix}-{timestamp}-{ticker}-{uuid.uuid4().hex[:8]}"

    @staticmethod
    def _result(
        snapshot: CompanySnapshot,
        run_id: str,
        status: str,
        response_id: str,
        output_dir: Path,
        paths: dict[str, Path],
    ) -> DeepResearchRunResult:
        return DeepResearchRunResult(
            run_id=run_id,
            ticker=snapshot.ticker,
            status=status,
            response_id=response_id,
            output_dir=output_dir,
            report_path=paths["report"],
            sources_path=paths["sources"],
            manifest_path=paths["manifest"],
            response_path=paths["response"],
            prompt_path=paths["prompt"],
        )
