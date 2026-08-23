from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import traceback
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _maybe_start_preview_keepalive() -> Tuple[Optional[threading.Event], Optional[threading.Thread]]:
    """Keep a scale-to-zero Fly machine alive while this run executes.

    Preview machines run with ``auto_stop_machines = "stop"`` so they shut down
    when the Fly edge proxy sees no inbound traffic. A detached run gets killed
    mid-flight once the browser tab closes and polling stops. To prevent that we
    self-ping our own *public* hostname every 30s — the request egresses to the
    Fly proxy and routes back in, resetting the idle timer. Loopback pings do not
    count (the proxy never sees them), so the public URL is required.

    Enabled by ``RUN_KEEPALIVE`` (or the legacy ``PREVIEW_KEEPALIVE`` alias)
    plus Fly's injected ``FLY_APP_NAME``. Returns ``(None, None)`` when
    disabled. Best-effort: ping failures never affect the run.
    """
    flag = str(
        os.getenv("RUN_KEEPALIVE", "")
        or os.getenv("PREVIEW_KEEPALIVE", "")
        or ""
    ).strip().lower()
    if flag not in {"1", "true", "yes", "on"}:
        return (None, None)
    app = str(os.getenv("FLY_APP_NAME", "") or "").strip()
    if not app:
        return (None, None)

    url = f"https://{app}.fly.dev/api/health"
    stop_event = threading.Event()

    def _loop() -> None:
        while True:
            try:
                with urllib.request.urlopen(url, timeout=10) as resp:
                    resp.read(0)
            except Exception:
                # best-effort: a failed ping must never surface
                pass
            if stop_event.wait(30):
                return

    thread = threading.Thread(target=_loop, name="preview-keepalive", daemon=True)
    thread.start()
    return (stop_event, thread)


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
    raw = str(os.getenv("SITE_RUN_LLM_TOTAL_ESTIMATE", "45") or "45").strip()
    try:
        n = int(raw)
        return max(1, n)
    except Exception:
        return 45


def _looks_like_material_success_result(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    status = str(result.get("status", "") or "").strip().lower()
    return status in {"success", "partial_success"}


def _terminal_progress(completed: int, total: int, *, successful: bool) -> tuple[int, float]:
    clean_total = max(1, int(total))
    clean_completed = max(0, int(completed))
    if successful:
        return max(clean_total, clean_completed), 100.0
    pct = min(99.0, (clean_completed / float(clean_total)) * 100.0)
    return clean_completed, round(pct, 2)


def _material_failure_error(result: Any) -> str:
    if isinstance(result, dict):
        for key in ("error", "message", "detail"):
            message = str(result.get(key) or "").strip()
            if message:
                return message
        status = str(result.get("status") or "").strip()
        if status:
            return f"Analysis service returned terminal status '{status}' without a report."
    return "Analysis service returned without usable report artifacts."


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a site-triggered valuation job.")
    parser.add_argument("--ticker", required=True, help="Ticker symbol")
    parser.add_argument("--output-dir", required=True, help="Job output directory")
    parser.add_argument("--status-file", required=True, help="Status JSON file path")
    parser.add_argument("--workspace", choices=("analysis", "nasdaq100"), default="analysis")
    parser.add_argument("--release-id", default=None, help="Required for Nasdaq-100 reports")
    parser.add_argument("--batch-id", default=None, help="Parent Nasdaq universe run id")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

    from ai_hedge.io.status import make_default_sink

    ticker = str(args.ticker or "").strip().upper()
    workspace = str(args.workspace or "analysis").strip().lower()
    release_id = str(args.release_id or "").strip() or None
    batch_id = str(args.batch_id or "").strip() or None
    if workspace == "nasdaq100" and not release_id:
        parser.error("--release-id is required for the nasdaq100 workspace")
    output_dir = str(Path(args.output_dir).resolve())
    status_file = Path(args.status_file).resolve()
    progress_file = str(Path(output_dir).resolve() / "_progress.log")
    llm_total_estimated = _estimate_total_llm_calls()
    llm_completed = 0
    observed_cost_usd = 0.0
    lock = threading.Lock()
    existing_status: Dict[str, Any] = {}
    if status_file.exists():
        try:
            existing_status = json.loads(status_file.read_text(encoding="utf-8"))
        except Exception:
            existing_status = {}

    sink = make_default_sink(status_file)
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
        "observed_cost_usd": observed_cost_usd,
        "llm_progress_pct": 0.0,
        "llm_calls_note": "Estimated total calls for one full valuation + dashboard extraction run.",
        "result": None,
        "error": "",
        "report_id": None,
        "persistence_error": "",
        "workspace": workspace,
        "release_id": release_id,
        "batch_id": batch_id,
    }
    sink.update_status(running_payload)

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
        sink.update_status(payload)

    keepalive_stop, keepalive_thread = _maybe_start_preview_keepalive()

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
            source_run_id=job_id,
            user_id=str(existing_status.get("user_id") or "").strip() or None,
            workspace=workspace,
            release_id=release_id,
        )

        try:
            from ai_hedge.obs.db import total_cost_for_source_run_id

            observed_cost_usd = total_cost_for_source_run_id(job_id)
        except Exception:
            observed_cost_usd = 0.0

        if not _looks_like_material_success_result(result):
            failed_completed, failed_pct = _terminal_progress(
                llm_completed,
                llm_total_estimated,
                successful=False,
            )
            failed_payload = {
                **running_payload,
                "status": "failed",
                "finished_at": _utc_now(),
                "llm_completed": failed_completed,
                "llm_progress_pct": failed_pct,
                "observed_cost_usd": observed_cost_usd,
                "result": result,
                "report_id": None,
                "persistence_error": "",
                "error": _material_failure_error(result),
            }
            if isinstance(result, dict) and result.get("traceback"):
                failed_payload["traceback"] = result.get("traceback")
            sink.update_status(failed_payload)
            _append_progress_line(progress_file, "Site Run Finalized: failed")
            legacy_port._deepseek_simple_full = original_full
            legacy_port.deepseek_simple_text = original_deepseek
            return 1

        # Ensure DB persistence before marking run as completed.
        report_id = None
        persistence_error = ""
        write_err: str | None = None
        try:
            from ai_hedge.db.writer import (
                attribute_report_to_user,
                find_report_id_by_source_run_id,
                write_run_to_db,
            )

            report_id = find_report_id_by_source_run_id(
                source_run_id=job_id,
                source="site",
                ticker=ticker,
                workspace=workspace,
                release_id=release_id,
            )
            if not report_id:
                _, write_err = write_run_to_db(
                    Path(output_dir).resolve() / ticker,
                    source="site",
                    max_attempts=5,
                    retry_backoff_seconds=2.0,
                    user_id=existing_status.get("user_id"),
                    r2_keys=result.get("r2_keys") if isinstance(result.get("r2_keys"), dict) else None,
                    workspace=workspace,
                    release_id=release_id,
                )
                report_id = find_report_id_by_source_run_id(
                    source_run_id=job_id,
                    source="site",
                    ticker=ticker,
                    workspace=workspace,
                    release_id=release_id,
                )
            if report_id:
                attribute_report_to_user(
                    report_id,
                    existing_status.get("user_id"),
                    workspace=workspace,
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
            completed_calls, completed_pct = _terminal_progress(
                llm_completed,
                llm_total_estimated,
                successful=True,
            )
            completed_with_warning = {
                **running_payload,
                "status": "completed",
                "finished_at": _utc_now(),
                "llm_completed": completed_calls,
                "llm_progress_pct": completed_pct,
                "observed_cost_usd": observed_cost_usd,
                "result": result,
                "report_id": None,
                "persistence_error": persistence_error or "DB persistence failed.",
                "error": "",
            }
            sink.update_status(completed_with_warning)
            _append_progress_line(progress_file, "Site Run Finalized: completed")
            legacy_port._deepseek_simple_full = original_full
            legacy_port.deepseek_simple_text = original_deepseek
            return 0

        completed_calls, completed_pct = _terminal_progress(
            llm_completed,
            llm_total_estimated,
            successful=True,
        )
        completed_payload = {
            **running_payload,
            "status": "completed",
            "finished_at": _utc_now(),
            "result": result,
            "llm_completed": completed_calls,
            "llm_progress_pct": completed_pct,
            "observed_cost_usd": observed_cost_usd,
            "report_id": report_id,
        }
        sink.update_status(completed_payload)
        _append_progress_line(progress_file, "Site Run Finalized: completed")
        legacy_port._deepseek_simple_full = original_full
        legacy_port.deepseek_simple_text = original_deepseek
        return 0
    except Exception as exc:
        try:
            from ai_hedge.obs.db import total_cost_for_source_run_id

            observed_cost_usd = total_cost_for_source_run_id(job_id)
        except Exception:
            pass
        failed_completed, failed_pct = _terminal_progress(
            llm_completed,
            llm_total_estimated,
            successful=False,
        )
        failed_payload = {
            **running_payload,
            "status": "failed",
            "finished_at": _utc_now(),
            "llm_completed": failed_completed,
            "llm_progress_pct": failed_pct,
            "observed_cost_usd": observed_cost_usd,
            "error": str(exc),
            "traceback": traceback.format_exc(limit=6),
        }
        sink.update_status(failed_payload)
        _append_progress_line(progress_file, "Site Run Finalized: failed")
        return 1
    finally:
        # Stop the preview keep-alive so the machine can auto-stop once the run
        # ends. Runs on every return/exception path above.
        if keepalive_stop is not None:
            keepalive_stop.set()
        if keepalive_thread is not None:
            keepalive_thread.join(timeout=2)


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    raise SystemExit(main())
