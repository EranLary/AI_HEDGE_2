from __future__ import annotations

import argparse
import json
import sys
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
        load_dotenv(dotenv_path)
        break

from openai import OpenAI

from ai_hedge.deep_research.audit import audit_run_directory
from ai_hedge.deep_research.config import DeepResearchConfig, require_openai_api_key
from ai_hedge.deep_research.snapshot import CompanySnapshot


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the structured semantic and arithmetic audit on a completed research run."
    )
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--report-file", default="research_report.md")
    parser.add_argument("--sources-file", default="research_sources.json")
    parser.add_argument("--output-file", default="research_audit.json")
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    snapshot_payload = json.loads(
        (run_dir / "snapshot.json").read_text(encoding="utf-8")
    )
    snapshot = CompanySnapshot(**snapshot_payload)
    config = DeepResearchConfig.from_env()
    client = OpenAI(api_key=require_openai_api_key(), timeout=600, max_retries=3)
    audit = audit_run_directory(
        client=client,
        run_dir=run_dir,
        snapshot=snapshot,
        model=config.audit_model,
        reasoning_effort=config.audit_reasoning_effort,
        report_filename=args.report_file,
        sources_filename=args.sources_file,
        output_filename=args.output_file,
    )
    arithmetic = audit.get("deterministic_arithmetic") or {}
    print(f"audit_score={audit.get('overall_quality_score')}")
    print(f"audit_target_usable={str(bool(arithmetic.get('usable_target'))).lower()}")
    print(f"audit={run_dir / args.output_file}")
    return 0 if arithmetic.get("usable_target") else 2


if __name__ == "__main__":
    raise SystemExit(main())
