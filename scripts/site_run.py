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


def _estimate_total_llm_calls() -> int:
    raw = str(os.getenv("SITE_RUN_LLM_TOTAL_ESTIMATE", "30") or "30").strip()
    try:
        n = int(raw)
        return max(1, n)
    except Exception:
        return 30


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
    progress_file = str(Path(output_dir).resolve() / ticker / "_progress.log")
    llm_total_estimated = _estimate_total_llm_calls()
    llm_completed = 0
    lock = threading.Lock()
    existing_status: Dict[str, Any] = {}
    if status_file.exists():
        try:
            existing_status = json.loads(status_file.read_text(encoding="utf-8"))
        except Exception:
            existing_status = {}

    running_payload: Dict[str, Any] = {
        "job_id": str(existing_status.get("job_id", "") or ""),
        "ticker": ticker,
        "status": "running",
        "created_at": str(existing_status.get("created_at", _utc_now())),
        "started_at": _utc_now(),
        "finished_at": None,
        "output_dir": output_dir,
        "progress_file": progress_file,
        "llm_total_estimated": llm_total_estimated,
        "llm_completed": llm_completed,
        "llm_progress_pct": 0.0,
        "llm_calls_note": "Estimated total calls for one full valuation + dashboard extraction run.",
        "result": None,
        "error": "",
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

        def tracked_deepseek(*args, **kwargs):
            nonlocal llm_completed
            try:
                return original_deepseek(*args, **kwargs)
            finally:
                with lock:
                    llm_completed += 1
                _write_running_progress()

        legacy_port.deepseek_simple_text = tracked_deepseek

        result = run_full_analysis(
            ticker=ticker,
            output_dir=output_dir,
            run_source="site",
        )

        completed_payload = {
            **running_payload,
            "status": "completed",
            "finished_at": _utc_now(),
            "result": result,
            "llm_completed": llm_total_estimated if llm_total_estimated > llm_completed else llm_completed,
            "llm_progress_pct": 100.0,
        }
        _write_json(status_file, completed_payload)
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
        return 1


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    raise SystemExit(main())
