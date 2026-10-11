from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

dotenv_candidates = [ROOT / ".env"]
if ROOT.parent.name == ".tmp":
    dotenv_candidates.append(ROOT.parent.parent / ".env")
for dotenv_path in dotenv_candidates:
    if dotenv_path.exists():
        # This is an explicit local benchmark command. A blank inherited Windows
        # variable must not mask the configured project .env value.
        load_dotenv(dotenv_path, override=True, encoding="utf-8-sig")
        break

from ai_hedge.deep_research.deepseek_engine import (
    DeepSeekResearchConfig,
    DeepSeekResearchEngine,
)
from ai_hedge.deep_research.provider_benchmark import ProviderBenchmarkEngine
from ai_hedge.deep_research.snapshot import CompanySnapshot, freeze_company_snapshot


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Benchmark the frozen Deep Research prompt on Gemini, xAI, or DeepSeek."
    )
    parser.add_argument(
        "--provider", required=True, choices=("gemini", "xai", "deepseek")
    )
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--company-name")
    parser.add_argument(
        "--snapshot-file",
        type=Path,
        help="Reuse a frozen snapshot so provider benchmarks receive identical prompts",
    )
    parser.add_argument("--model")
    parser.add_argument("--timeout-seconds", type=int)
    parser.add_argument("--poll-seconds", type=float, default=10.0)
    parser.add_argument(
        "--max-cost-usd",
        type=float,
        help="DeepSeek-only estimated usage cap (default: env or $3.00)",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path(".tmp/deep-research-engine/provider-runs"),
    )
    args = parser.parse_args()
    if args.snapshot_file:
        snapshot = CompanySnapshot(
            **json.loads(args.snapshot_file.read_text(encoding="utf-8"))
        )
        if snapshot.ticker != args.ticker.strip().upper():
            parser.error("--snapshot-file ticker does not match --ticker")
    else:
        snapshot = freeze_company_snapshot(args.ticker, company_name=args.company_name)
    if args.provider == "deepseek":
        config = DeepSeekResearchConfig.from_env()
        overrides = {}
        if args.model:
            overrides["controller_model"] = args.model
        if args.timeout_seconds:
            overrides["max_seconds"] = min(3600, max(1, args.timeout_seconds))
        if args.max_cost_usd:
            overrides["max_cost_usd"] = args.max_cost_usd
        if overrides:
            config = replace(config, **overrides)
        engine = DeepSeekResearchEngine(
            config=config,
            progress=lambda message: print(
                f"[provider-research] {message}", flush=True
            )
        )
    else:
        engine = ProviderBenchmarkEngine(
            provider=args.provider,
            model=args.model,
            timeout_seconds=args.timeout_seconds or 3600,
            poll_seconds=args.poll_seconds,
            progress=lambda message: print(
                f"[provider-research] {message}", flush=True
            ),
        )
    result = engine.run(snapshot, output_root=args.output_root)
    print(f"provider={result.provider}")
    print(f"status={result.status}")
    print(f"output_dir={result.output_dir}")
    print(f"report={result.report_path}")
    print(f"manifest={result.manifest_path}")
    print(f"quality={result.quality_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
