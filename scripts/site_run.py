from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _append_progress_line(progress_file: str, message: str) -> None:
    try:
        progress_path = Path(progress_file)
        progress_path.parent.mkdir(parents=True, exist_ok=True)
        with progress_path.open("a", encoding="utf-8") as fh:
            fh.write(f"{str(message).strip()}\n")
    except Exception:
        # best-effort diagnostics only
        pass


def _job_id_from_status(existing_status: Dict[str, Any], output_dir: str) -> str:
    from_status = str(existing_status.get("job_id", "") or "").strip()
    if from_status:
        return from_status
    return Path(output_dir).name


def _estimate_total_llm_calls() -> int:
    raw = str(os.getenv("SITE_RUN_LLM_TOTAL_ESTIMATE", "30") or "30").strip()
    try:
        n = int(raw)
        return max(1, n)
    except Exception:
        return 30


def _looks_like_material_success_result(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    status = str(result.get("status", "") or "").strip().lower()
    return status in {"success", "partial_success"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a site-triggered valuation job.")
    parser.add_argument("--ticker", required=True, help="Ticker symbol")
    parser.add_argument("--output-dir", required=True, help="Job output directory")
    parser.add_argument("--status-file", required=True, help="Status JSON file path")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

    ticker = str(args.ticker or "").strip().upper()
    output_dir = str(Path(args.output_dir).resolve())
    status_file = Path(args.status_file).resolve()
    progress_file = str(Path(output_dir).resolve() / "_progress.log")
    llm_total_estimated = _estimate_total_llm_calls()
    llm_completed = 0
    lock = threading.Lock()
    existing_status: Dict[str, Any] = {}
    if status_file.exists():
        try:
            existing_status = json.loads(status_file.read_text(encoding="utf-8"))
        except Exception:
            existing_status = {}

    job_id = _job_id_from_status(existing_status, output_dir)
    running_payload: Dict[str, Any] = {
        "job_id": job_id,
        "ticker": ticker,
        "status": "running",
        "created_at": str(existing_status.get("created_at", _utc_now())),
        "started_at": _utc_now(),
        "finished_at": None,
        "output_dir": output_dir,
        "progress_file": progress_file,
        "user_id": existing_status.get("user_id"),
        "attributed": bool(existing_status.get("attributed", False)),
        "runner_pid": existing_status.get("runner_pid"),
        "worker_pid": os.getpid(),
        "llm_total_estimated": llm_total_estimated,
        "llm_completed": llm_completed,
        "llm_progress_pct": 0.0,
        "llm_calls_note": "Estimated total calls for one full valuation + dashboard extraction run.",
        "result": None,
        "error": "",
        "report_id": None,
        "persistence_error": "",
    }
    _write_json(status_file, running_payload)

    def _write_running_progress() -> None:
        with lock:
            completed = int(llm_completed)
        pct = min(99.0, (completed / float(llm_total_estimated)) * 100.0)
        payload = {
            **running_payload,
            "status": "running",
            "finished_at": None,
            "llm_completed": completed,
            "llm_progress_pct": round(pct, 2),
        }
        _write_json(status_file, payload)

    try:
        from ai_hedge import legacy_port
        from ai_hedge.service import run_full_analysis

        original_deepseek = legacy_port.deepseek_simple_text
        original_full = legacy_port._deepseek_simple_full

        def tracked_full(*args, **kwargs):
            nonlocal llm_completed
            try:
                return original_full(*args, **kwargs)
            finally:
                with lock:
                    llm_completed += 1
                _write_running_progress()

        # Track the low-level full wrapper instead of deepseek_simple_text.
        # obs.install() rebinds deepseek_simple_text, but it still calls
        # _deepseek_simple_full internally.
        legacy_port._deepseek_simple_full = tracked_full

        result = run_full_analysis(
            ticker=ticker,
            output_dir=output_dir,
            run_source="site",
        )

        # Ensure DB persistence before marking run as completed.
        report_id = None
        persistence_error = ""
        write_err: str | None = None
        try:
            from ai_hedge.db.writer import (
                find_report_id_by_source_run_id,
                write_run_to_db,
            )

            report_id = find_report_id_by_source_run_id(
                source_run_id=job_id,
                source="site",
                ticker=ticker,
            )
            if not report_id:
                _, write_err = write_run_to_db(
                    Path(output_dir).resolve() / ticker,
                    source="site",
                    max_attempts=5,
                    retry_backoff_seconds=2.0,
                )
                report_id = find_report_id_by_source_run_id(
                    source_run_id=job_id,
                    source="site",
                    ticker=ticker,
                )
            if not report_id:
                base_msg = (
                    "Run artifacts were generated but DB report persistence failed. "
                    "No reports row found for source_run_id."
                )
                persistence_error = (
                    f"{base_msg} Last writer error: {write_err}"
                    if write_err
                    else base_msg
                )
        except Exception as persist_exc:  # noqa: BLE001
            persistence_error = f"DB persistence verification failed: {persist_exc}"

        if not report_id:
            # The run can still be materially successful for the user even if
            # DB persistence is temporarily unavailable. Keep this as completed
            # and surface the persistence issue for diagnostics.
            completed_with_warning = {
                **running_payload,
                "status": "completed",
                "finished_at": _utc_now(),
                "llm_completed": llm_total_estimated if llm_total_estimated > llm_completed else llm_completed,
                "llm_progress_pct": 100.0,
                "result": result,
                "report_id": None,
                "persistence_error": persistence_error or "DB persistence failed.",
                "error": "",
            }
            if not _looks_like_material_success_result(result):
                failed_payload = {
                    **completed_with_warning,
                    "status": "failed",
                    "error": persistence_error or "DB persistence failed.",
                }
                _write_json(status_file, failed_payload)
                _append_progress_line(progress_file, "Site Run Finalized: failed")
                legacy_port._deepseek_simple_full = original_full
                legacy_port.deepseek_simple_text = original_deepseek
                return 1

            _write_json(status_file, completed_with_warning)
            _append_progress_line(progress_file, "Site Run Finalized: completed")
            legacy_port._deepseek_simple_full = original_full
            legacy_port.deepseek_simple_text = original_deepseek
            return 0

        completed_payload = {
            **running_payload,
            "status": "completed",
            "finished_at": _utc_now(),
            "result": result,
            "llm_completed": llm_total_estimated if llm_total_estimated > llm_completed else llm_completed,
            "llm_progress_pct": 100.0,
            "report_id": report_id,
        }
        _write_json(status_file, completed_payload)
        _append_progress_line(progress_file, "Site Run Finalized: completed")
        legacy_port._deepseek_simple_full = original_full
        legacy_port.deepseek_simple_text = original_deepseek
        return 0
    except Exception as exc:
        failed_payload = {
            **running_payload,
            "status": "failed",
            "finished_at": _utc_now(),
            "llm_completed": llm_completed,
            "llm_progress_pct": round(min(99.0, (llm_completed / float(llm_total_estimated)) * 100.0), 2),
            "error": str(exc),
            "traceback": traceback.format_exc(limit=6),
        }
        _write_json(status_file, failed_payload)
        _append_progress_line(progress_file, "Site Run Finalized: failed")
        return 1


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    raise SystemExit(main())
