from __future__ import annotations

import sys
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path
from threading import Lock
from typing import Dict, List, Tuple


def _run_service_job(ticker: str, output_dir: str, mode: str) -> dict:
    """ProcessPool target: run a single analysis request via service layer."""
    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

    from ai_hedge.service import (
        run_full_analysis,
        run_sec_analysis_short,
    )

    norm_mode = (mode or "").strip().lower()
    if norm_mode == "sec":
        return run_sec_analysis_short(ticker=ticker, output_dir=output_dir)
    if norm_mode == "valuation":
        return run_full_analysis(ticker=ticker, output_dir=output_dir, run_source="bot")
    raise ValueError(f"Unsupported analysis mode: {mode}")


class AnalysisWorker:
    """Background process worker wrapper for non-blocking Telegram handlers."""

    def __init__(self, max_workers: int = 2) -> None:
        self._max_workers = max_workers
        self._pool = ProcessPoolExecutor(max_workers=max_workers)
        self._futures_by_job: Dict[str, Future] = {}
        self._lock = Lock()

    def _reset_pool(self) -> None:
        old_pool = self._pool
        self._pool = ProcessPoolExecutor(max_workers=self._max_workers)
        old_pool.shutdown(wait=False, cancel_futures=True)

    def submit(self, *, job_id: str, ticker: str, output_dir: str, mode: str) -> None:
        try:
            fut = self._pool.submit(_run_service_job, ticker, output_dir, mode)
        except BrokenProcessPool:
            self._reset_pool()
            fut = self._pool.submit(_run_service_job, ticker, output_dir, mode)
        with self._lock:
            self._futures_by_job[job_id] = fut

    def poll_completed(self) -> List[Tuple[str, dict | None, Exception | None]]:
        done: List[Tuple[str, dict | None, Exception | None]] = []
        should_reset_pool = False
        with self._lock:
            snapshot = list(self._futures_by_job.items())

        for job_id, fut in snapshot:
            if not fut.done():
                continue
            try:
                result = fut.result()
                done.append((job_id, result, None))
            except Exception as exc:
                if isinstance(exc, BrokenProcessPool) or "terminated abruptly" in str(exc).lower():
                    should_reset_pool = True
                done.append((job_id, None, exc))

        if done:
            with self._lock:
                for job_id, _, _ in done:
                    self._futures_by_job.pop(job_id, None)
                if should_reset_pool:
                    self._reset_pool()

        return done

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
