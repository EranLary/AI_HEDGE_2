from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

for dotenv_path in (ROOT / ".env", ROOT.parent.parent / ".env"):
    if dotenv_path.exists():
        load_dotenv(dotenv_path, override=True, encoding="utf-8-sig")
        break

from ai_hedge.deep_research.deepseek_engine import (  # noqa: E402
    DeepSeekResearchConfig,
    DeepSeekResearchEngine,
)
from ai_hedge.deep_research.refinement import refine_existing_deepseek_run  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reuse completed DeepSeek research and rerun only valuation/publication."
    )
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--max-cost-usd", type=float, default=2.0)
    args = parser.parse_args()
    config = replace(
        DeepSeekResearchConfig.from_env(),
        max_cost_usd=max(0.01, args.max_cost_usd),
    )
    engine = DeepSeekResearchEngine(
        config=config,
        progress=lambda message: print(f"[deepseek-refine] {message}", flush=True),
    )
    result = refine_existing_deepseek_run(engine=engine, run_dir=args.run_dir)
    print(f"output_dir={result.output_dir}")
    print(f"report={result.report_path}")
    print(f"manifest={result.manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
