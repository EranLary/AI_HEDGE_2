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

from ai_hedge.deep_research.broker_research import research_broker_valuation_case
from ai_hedge.deep_research.config import DeepResearchConfig, require_openai_api_key
from ai_hedge.deep_research.compiler import (
    ValuationCompilationError,
    compile_valuation_case,
)
from ai_hedge.deep_research.snapshot import CompanySnapshot
from ai_hedge.deep_research.profiles import ValuationProfile, detect_valuation_profile
from ai_hedge.deep_research.valuation_research import research_valuation_case


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Research a sourced valuation case and run the deterministic compiler."
    )
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--candidate", default="repair_3")
    parser.add_argument("--attempt", type=int, default=1)
    parser.add_argument(
        "--profile",
        choices=["auto", "generic", "broker"],
        default="auto",
        help="Valuation contract. Auto routes from business-model evidence in the report.",
    )
    parser.add_argument(
        "--prior-research-attempt",
        type=int,
        help="Use and recompile a prior structured valuation research case as feedback.",
    )
    parser.add_argument(
        "--prior-case-audit",
        type=int,
        help="Feed blocking issues from a prior economic case audit into the next research pass.",
    )
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    suffix = "" if args.candidate == "base" else f"_{args.candidate}"
    snapshot = CompanySnapshot(
        **json.loads((run_dir / "snapshot.json").read_text(encoding="utf-8"))
    )
    report = (run_dir / f"research_report{suffix}.md").read_text(encoding="utf-8")
    audit = json.loads(
        (run_dir / f"research_audit{suffix}.json").read_text(encoding="utf-8")
    )
    profile = detect_valuation_profile(snapshot, report, requested=args.profile)
    print(f"valuation_profile={profile.value}", flush=True)
    if profile is ValuationProfile.BROKER:
        prior_case = (
            json.loads(
                (
                    run_dir
                    / f"broker_valuation_research_{args.prior_research_attempt}_case.json"
                ).read_text(encoding="utf-8")
            )
            if args.prior_research_attempt is not None
            else None
        )
        if args.prior_case_audit is not None:
            broker_audit_path = (
                run_dir
                / f"broker_valuation_case_audit_{args.prior_case_audit}.json"
            )
            legacy_audit_path = (
                run_dir / f"valuation_case_audit_{args.prior_case_audit}.json"
            )
            prior_case_audit = json.loads(
                (broker_audit_path if broker_audit_path.exists() else legacy_audit_path).read_text(
                    encoding="utf-8"
                )
            )
        else:
            prior_case_audit = None
        config = DeepResearchConfig.from_env()
        client = OpenAI(api_key=require_openai_api_key(), timeout=120, max_retries=3)
        result = research_broker_valuation_case(
            client=client,
            config=config,
            snapshot=snapshot,
            run_dir=run_dir,
            report=report,
            narrative_audit=audit,
            prior_case=prior_case,
            prior_case_audit=prior_case_audit,
            attempt=args.attempt,
            progress=lambda message: print(f"[broker-research] {message}", flush=True),
        )
        print(f"response_id={result.response_id}")
        print(f"compiled={str(result.compiled).lower()}")
        artifact = result.compiled_filename if result.compiled else result.errors_filename
        print(f"artifact={run_dir / artifact}")
        return 0 if result.compiled else 2

    if args.prior_research_attempt is not None:
        extracted_case = json.loads(
            (
                run_dir
                / f"valuation_research_{args.prior_research_attempt}_case.json"
            ).read_text(encoding="utf-8")
        )
        try:
            compile_valuation_case(extracted_case)
        except ValuationCompilationError as exc:
            compile_issues = list(exc.issues)
        else:
            compile_issues = []
    else:
        extracted_case = json.loads(
            (run_dir / f"valuation_case{suffix}.json").read_text(encoding="utf-8")
        )
        error_payload = json.loads(
            (run_dir / f"valuation_compile_errors{suffix}.json").read_text(encoding="utf-8")
        )
        compile_issues = error_payload.get("issues") or []
    prior_case_audit = (
        json.loads(
            (
                run_dir / f"valuation_case_audit_{args.prior_case_audit}.json"
            ).read_text(encoding="utf-8")
        )
        if args.prior_case_audit is not None
        else None
    )
    config = DeepResearchConfig.from_env()
    client = OpenAI(api_key=require_openai_api_key(), timeout=120, max_retries=3)
    result = research_valuation_case(
        client=client,
        config=config,
        snapshot=snapshot,
        run_dir=run_dir,
        report=report,
        audit=audit,
        extracted_case=extracted_case,
        compile_issues=compile_issues,
        prior_case_audit=prior_case_audit,
        attempt=args.attempt,
        progress=lambda message: print(f"[valuation-research] {message}", flush=True),
    )
    print(f"response_id={result.response_id}")
    print(f"compiled={str(result.compiled).lower()}")
    artifact = result.compiled_filename if result.compiled else result.errors_filename
    print(f"artifact={run_dir / artifact}")
    return 0 if result.compiled else 2


if __name__ == "__main__":
    raise SystemExit(main())
