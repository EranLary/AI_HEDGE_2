from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Literal, Optional
from uuid import uuid4

JobStatus = Literal["queued", "running", "completed", "failed"]
AnalysisMode = Literal["valuation", "sec"]


@dataclass
class JobRecord:
    job_id: str
    user_id: int
    chat_id: int
    ticker: str
    mode: AnalysisMode
    status: JobStatus
    created_at: str
    output_dir: str
    result: Optional[Dict[str, Any]] = None
    error: str = ""
    progress_cursor: int = 0


@dataclass
class PendingPaymentRecord:
    payload: str
    job_id: str
    user_id: int
    chat_id: int
    mode: AnalysisMode
    ticker: str
    amount_stars: int
    created_at: str


class JobStore:
    """Thread-safe in-memory job metadata store for the bot MVP."""

    def __init__(self, output_root: str) -> None:
        self._output_root = Path(output_root).resolve()
        self._output_root.mkdir(parents=True, exist_ok=True)
        self._jobs: Dict[str, JobRecord] = {}
        self._user_modes: Dict[int, Optional[AnalysisMode]] = {}
        self._pending_tickers: Dict[int, str] = {}
        self._pending_payments: Dict[str, PendingPaymentRecord] = {}
        self._free_valuation_retries: Dict[int, int] = {}
        self._free_run_credits: Dict[int, int] = {}
        self._lock = Lock()

    def create_job(
        self,
        *,
        user_id: int,
        chat_id: int,
        ticker: str,
        mode: Optional[AnalysisMode] = None,
    ) -> JobRecord:
        job_id = uuid4().hex[:12]
        output_dir = self._output_root / job_id
        output_dir.mkdir(parents=True, exist_ok=True)
        effective_mode = mode or self.get_user_mode(user_id)
        if effective_mode is None:
            raise ValueError("No analysis mode selected for user")
        job = JobRecord(
            job_id=job_id,
            user_id=user_id,
            chat_id=chat_id,
            ticker=ticker,
            mode=effective_mode,
            status="queued",
            created_at=datetime.now(timezone.utc).isoformat(),
            output_dir=str(output_dir),
        )
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get(self, job_id: str) -> Optional[JobRecord]:
        with self._lock:
            return self._jobs.get(job_id)

    def set_status(self, job_id: str, status: JobStatus) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.status = status

    def set_result(self, job_id: str, result: Dict[str, Any]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.result = result

    def set_error(self, job_id: str, error: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.error = error

    def list_running_jobs(self) -> list[JobRecord]:
        with self._lock:
            return [job for job in self._jobs.values() if job.status == "running"]

    def get_progress_cursor(self, job_id: str) -> int:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return 0
            return int(job.progress_cursor)

    def set_progress_cursor(self, job_id: str, cursor: int) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.progress_cursor = max(0, int(cursor))

    def set_user_mode(self, user_id: int, mode: AnalysisMode) -> None:
        with self._lock:
            self._user_modes[user_id] = mode

    def clear_user_mode(self, user_id: int) -> None:
        with self._lock:
            self._user_modes.pop(user_id, None)

    def get_user_mode(self, user_id: int) -> Optional[AnalysisMode]:
        with self._lock:
            return self._user_modes.get(user_id)

    def set_pending_ticker(self, user_id: int, ticker: str) -> None:
        with self._lock:
            self._pending_tickers[user_id] = ticker

    def pop_pending_ticker(self, user_id: int) -> Optional[str]:
        with self._lock:
            return self._pending_tickers.pop(user_id, None)

    def get_pending_ticker(self, user_id: int) -> Optional[str]:
        with self._lock:
            return self._pending_tickers.get(user_id)

    def set_pending_payment(
        self,
        *,
        payload: str,
        job_id: str,
        user_id: int,
        chat_id: int,
        mode: AnalysisMode,
        ticker: str,
        amount_stars: int,
    ) -> PendingPaymentRecord:
        record = PendingPaymentRecord(
            payload=payload,
            job_id=job_id,
            user_id=user_id,
            chat_id=chat_id,
            mode=mode,
            ticker=ticker,
            amount_stars=max(1, int(amount_stars)),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        with self._lock:
            self._pending_payments[payload] = record
        return record

    def get_pending_payment(self, payload: str) -> Optional[PendingPaymentRecord]:
        with self._lock:
            return self._pending_payments.get(payload)

    def pop_pending_payment(self, payload: str) -> Optional[PendingPaymentRecord]:
        with self._lock:
            return self._pending_payments.pop(payload, None)

    def grant_free_valuation_retry(self, user_id: int, count: int = 1) -> int:
        increment = max(1, int(count))
        with self._lock:
            current = int(self._free_valuation_retries.get(user_id, 0))
            new_total = current + increment
            self._free_valuation_retries[user_id] = new_total
            return new_total

    def get_free_valuation_retries(self, user_id: int) -> int:
        with self._lock:
            return int(self._free_valuation_retries.get(user_id, 0))

    def consume_free_valuation_retry(self, user_id: int) -> bool:
        with self._lock:
            current = int(self._free_valuation_retries.get(user_id, 0))
            if current <= 0:
                return False
            new_total = current - 1
            if new_total <= 0:
                self._free_valuation_retries.pop(user_id, None)
            else:
                self._free_valuation_retries[user_id] = new_total
            return True

    def grant_free_run_credit(self, user_id: int, count: int = 1) -> int:
        increment = max(1, int(count))
        with self._lock:
            current = int(self._free_run_credits.get(user_id, 0))
            new_total = current + increment
            self._free_run_credits[user_id] = new_total
            return new_total

    def get_free_run_credits(self, user_id: int) -> int:
        with self._lock:
            return int(self._free_run_credits.get(user_id, 0))

    def consume_free_run_credit(self, user_id: int) -> bool:
        with self._lock:
            current = int(self._free_run_credits.get(user_id, 0))
            if current <= 0:
                return False
            new_total = current - 1
            if new_total <= 0:
                self._free_run_credits.pop(user_id, None)
            else:
                self._free_run_credits[user_id] = new_total
            return True
