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
from ai_hedge.deep_research.case_builder import compile_run_valuation_case
from ai_hedge.deep_research.config import DeepResearchConfig, require_openai_api_key
from ai_hedge.deep_research.quality import (
    evaluate_run_artifacts,
    write_quality_report,
)
from ai_hedge.deep_research.repair import run_repair
from ai_hedge.deep_research.selection import select_best_candidate
from ai_hedge.deep_research.snapshot import CompanySnapshot


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Repair and re-audit a rejected standalone Deep Research report."
    )
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--attempt", type=int, default=1)
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    snapshot = CompanySnapshot(
        **json.loads((run_dir / "snapshot.json").read_text(encoding="utf-8"))
    )
    prior_suffix = "" if args.attempt == 1 else f"_repair_{args.attempt - 1}"
    manifest = json.loads(
        (run_dir / f"research_manifest{prior_suffix}.json").read_text(encoding="utf-8")
    )
    audit = json.loads(
        (run_dir / f"research_audit{prior_suffix}.json").read_text(encoding="utf-8")
    )
    config = DeepResearchConfig.from_env()
    client = OpenAI(api_key=require_openai_api_key(), timeout=120, max_retries=3)
    repair = run_repair(
        client=client,
        config=config,
        snapshot=snapshot,
        run_dir=run_dir,
        previous_response_id=str(manifest.get("response_id") or ""),
        audit=audit,
        attempt=args.attempt,
        progress=lambda message: print(f"[deep-research] {message}", flush=True),
    )
    quality = evaluate_run_artifacts(
        run_dir,
        report_filename=repair.report_filename,
        sources_filename=repair.sources_filename,
    )
    quality_path = write_quality_report(
        run_dir,
        quality,
        output_filename=f"research_quality_repair_{args.attempt}.json",
    )
    audit_filename = f"research_audit_repair_{args.attempt}.json"
    repaired_audit = audit_run_directory(
        client=client,
        run_dir=run_dir,
        snapshot=snapshot,
        model=config.audit_model,
        reasoning_effort=config.audit_reasoning_effort,
        report_filename=repair.report_filename,
        sources_filename=repair.sources_filename,
        output_filename=audit_filename,
    )
    arithmetic = repaired_audit.get("deterministic_arithmetic") or {}
    compiled_filename = f"valuation_compiled_repair_{args.attempt}.json"
    errors_filename = f"valuation_compile_errors_repair_{args.attempt}.json"
    _compiled, valuation_compiled = compile_run_valuation_case(
        client=client,
        run_dir=run_dir,
        snapshot=snapshot,
        model=config.audit_model,
        reasoning_effort=config.audit_reasoning_effort,
        report_filename=repair.report_filename,
        sources_filename=repair.sources_filename,
        case_filename=f"valuation_case_repair_{args.attempt}.json",
        compiled_filename=compiled_filename,
        errors_filename=errors_filename,
    )
    passed = (
        quality.passed
        and bool(arithmetic.get("usable_target"))
        and int(repaired_audit.get("overall_quality_score") or 0) >= 85
        and valuation_compiled
    )
    print(f"repair_response_id={repair.response_id}")
    print(f"report={run_dir / repair.report_filename}")
    print(f"audit={run_dir / audit_filename}")
    print(f"quality={quality_path}")
    print(f"structural_score={quality.score}")
    print(f"audit_score={repaired_audit.get('overall_quality_score')}")
    print(f"valuation_compiled={str(valuation_compiled).lower()}")
    print(f"publication_ready={str(passed).lower()}")
    selection = select_best_candidate(run_dir)
    print(f"selected_candidate={selection['selected_candidate']}")
    print(f"selected_report={run_dir / selection['selected_report']}")
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
