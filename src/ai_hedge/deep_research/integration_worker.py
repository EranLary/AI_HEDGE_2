from __future__ import annotations

import argparse
import json
from dataclasses import replace
from pathlib import Path

from .deepseek_engine import DeepSeekResearchConfig, DeepSeekResearchEngine
from .integration import build_summary, failed_run_summary, unavailable_summary
from .snapshot import CompanySnapshot


def production_config() -> DeepSeekResearchConfig:
    configured = DeepSeekResearchConfig.from_env()
    return replace(
        configured,
        max_cost_usd=min(configured.max_cost_usd, 1.5),
        max_seconds=min(configured.max_seconds, 3600),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--result", required=True)
    args = parser.parse_args()
    result_path = Path(args.result)
    snapshot = None
    try:
        snapshot = CompanySnapshot(**json.loads(Path(args.snapshot).read_text(encoding="utf-8")))
        config = production_config()
        engine = DeepSeekResearchEngine(config=config)
        result = engine.run(snapshot, output_root=Path(args.output_root))
        payload = build_summary(result.output_dir)
    except Exception as exc:  # noqa: BLE001
        error_text = f"{type(exc).__name__}: {exc}"
        normalized_error = error_text.casefold()
        if isinstance(exc, TimeoutError):
            status = "timed_out"
        elif "budget" in normalized_error or "cost cap" in normalized_error:
            status = "budget_exceeded"
        else:
            status = "failed"
        payload = (
            failed_run_summary(
                output_root=Path(args.output_root),
                ticker=snapshot.ticker,
                status=status,
                reason=error_text,
            )
            if snapshot is not None
            else unavailable_summary(status, error_text)
        )
    result_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return 0 if payload.get("target_usable") else 2


if __name__ == "__main__":
    raise SystemExit(main())
