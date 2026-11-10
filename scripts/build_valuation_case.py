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

from ai_hedge.deep_research.case_builder import compile_run_valuation_case
from ai_hedge.deep_research.config import DeepResearchConfig, require_openai_api_key
from ai_hedge.deep_research.snapshot import CompanySnapshot


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract and deterministically compile a completed research valuation."
    )
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--report-file", default="research_report.md")
    parser.add_argument("--sources-file", default="research_sources.json")
    parser.add_argument("--suffix", default="")
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    snapshot = CompanySnapshot(
        **json.loads((run_dir / "snapshot.json").read_text(encoding="utf-8"))
    )
    config = DeepResearchConfig.from_env()
    client = OpenAI(api_key=require_openai_api_key(), timeout=600, max_retries=3)
    suffix = f"_{args.suffix}" if args.suffix else ""
    payload, valid = compile_run_valuation_case(
        client=client,
        run_dir=run_dir,
        snapshot=snapshot,
        model=config.audit_model,
        reasoning_effort=config.audit_reasoning_effort,
        report_filename=args.report_file,
        sources_filename=args.sources_file,
        case_filename=f"valuation_case{suffix}.json",
        compiled_filename=f"valuation_compiled{suffix}.json",
        errors_filename=f"valuation_compile_errors{suffix}.json",
    )
    print(f"valuation_compiled={str(valid).lower()}")
    if not valid:
        print(f"issue_count={len(payload.get('issues') or [])}")
    return 0 if valid else 2


if __name__ == "__main__":
    raise SystemExit(main())
