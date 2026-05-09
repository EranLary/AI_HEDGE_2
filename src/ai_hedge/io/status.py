from __future__ import annotations

import json
import os
import re
import sys
import threading
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _is_valid_uuid(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return bool(_UUID_RE.match(value.strip()))


class StatusSink(ABC):
    """Single-writer interface for run status.

    The pipeline rewrites the entire status payload ~30x per run as the LLM-call
    counter advances. Implementations must accept a full payload each call and
    overwrite their durable record idempotently.
    """

    @abstractmethod
    def update_status(self, payload: Dict[str, Any]) -> None:
        ...


class FsStatusSink(StatusSink):
    """Writes the canonical `_status.json` file. Today's primary reader path."""

    def __init__(self, status_file: Path | str) -> None:
        self._path = Path(status_file)

    def update_status(self, payload: Dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


class NeonStatusSink(StatusSink):
    """Upserts the matching `site_runs` row. Best-effort during Phase 0.2."""

    _UPSERT_SQL = """
    INSERT INTO site_runs (
        job_id, ticker, user_id, status,
        started_at, finished_at,
        llm_total_estimated, llm_completed,
        error, report_id
    ) VALUES (
        %(job_id)s, %(ticker)s, %(user_id)s, %(status)s,
        %(started_at)s, %(finished_at)s,
        %(llm_total_estimated)s, %(llm_completed)s,
        %(error)s, %(report_id)s
    )
    ON CONFLICT (job_id) DO UPDATE SET
        ticker              = EXCLUDED.ticker,
        user_id             = COALESCE(EXCLUDED.user_id, site_runs.user_id),
        status              = EXCLUDED.status,
        started_at          = COALESCE(EXCLUDED.started_at, site_runs.started_at),
        finished_at         = COALESCE(EXCLUDED.finished_at, site_runs.finished_at),
        llm_total_estimated = EXCLUDED.llm_total_estimated,
        llm_completed       = GREATEST(site_runs.llm_completed, EXCLUDED.llm_completed),
        error               = EXCLUDED.error,
        report_id           = COALESCE(EXCLUDED.report_id, site_runs.report_id);
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._failure_logged = False

    def update_status(self, payload: Dict[str, Any]) -> None:
        if not (os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")):
            return
        try:
            from ai_hedge.db.connection import get_conn  # local import to keep CLI runs cheap
        except ImportError:
            self._log_once("import psycopg/connection failed")
            return

        params = self._params(payload)
        if not params:
            return
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(self._UPSERT_SQL, params)
                conn.commit()
        except Exception as exc:  # noqa: BLE001 - sink must never raise
            self._log_once(f"{type(exc).__name__}: {exc}")

    def _params(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        job_id = str(payload.get("job_id") or "").strip()
        ticker = str(payload.get("ticker") or "").strip().upper()
        status = str(payload.get("status") or "").strip().lower()
        if not job_id or not ticker or not status:
            return None

        user_id_raw = payload.get("user_id")
        user_id = user_id_raw if _is_valid_uuid(user_id_raw) else None

        report_id_raw = payload.get("report_id")
        report_id = report_id_raw if _is_valid_uuid(report_id_raw) else None

        return {
            "job_id": job_id,
            "ticker": ticker,
            "user_id": user_id,
            "status": status,
            "started_at": payload.get("started_at"),
            "finished_at": payload.get("finished_at"),
            "llm_total_estimated": int(payload.get("llm_total_estimated") or 0),
            "llm_completed": int(payload.get("llm_completed") or 0),
            "error": str(payload.get("error") or ""),
            "report_id": report_id,
        }

    def _log_once(self, message: str) -> None:
        with self._lock:
            if self._failure_logged:
                return
            self._failure_logged = True
        print(f"[status.NeonStatusSink] disabled after first failure: {message}", file=sys.stderr)


class MultiplexedStatusSink(StatusSink):
    """Fans status updates out to multiple sinks; one failure must not affect siblings."""

    def __init__(self, sinks: Iterable[StatusSink]) -> None:
        self._sinks: List[StatusSink] = [s for s in sinks if s is not None]

    def update_status(self, payload: Dict[str, Any]) -> None:
        for sink in self._sinks:
            try:
                sink.update_status(payload)
            except Exception as exc:  # noqa: BLE001 - sink must never raise
                print(
                    f"[status.MultiplexedStatusSink] {type(sink).__name__} failed: "
                    f"{type(exc).__name__}: {exc}",
                    file=sys.stderr,
                )


def make_default_sink(status_file: Path | str) -> StatusSink:
    """Default Phase 0.2 sink: FS file is primary, Neon row is best-effort.

    The FS sink stays in front so the existing read path (Node + restart-reconcile)
    keeps working even when Neon is unreachable.
    """
    return MultiplexedStatusSink([FsStatusSink(status_file), NeonStatusSink()])
