from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional, Sequence

from .audit import audit_run_directory
from .case_builder import compile_run_valuation_case
from .config import DeepResearchConfig
from .engine import DeepResearchEngine
from .quality import evaluate_run_artifacts, write_quality_report
from .snapshot import freeze_company_snapshot


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the standalone institutional equity Deep Research engine."
    )
    parser.add_argument("--ticker", required=True, help="Public-market ticker symbol")
    parser.add_argument(
        "--company-name",
        help="Optional explicit company name when the market-data provider cannot resolve it",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path(".tmp/deep-research-engine/runs"),
        help="Root for run artifacts (default: .tmp/deep-research-engine/runs)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve the company and write prompt/request artifacts without calling OpenAI",
    )
    parser.add_argument(
        "--resume",
        metavar="RESPONSE_ID",
        help="Resume polling an existing OpenAI background response",
    )
    parser.add_argument("--model", help="Override OPENAI_DEEP_RESEARCH_MODEL")
    parser.add_argument(
        "--reasoning",
        choices=("high", "xhigh"),
        help="Override reasoning effort",
    )
    parser.add_argument(
        "--max-tool-calls",
        type=int,
        help="Override the total built-in tool-call budget",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        help="Override the polling timeout",
    )
    parser.add_argument(
        "--poll-seconds",
        type=float,
        help="Override the background polling interval",
    )
    parser.add_argument(
        "--no-code-interpreter",
        action="store_true",
        help="Disable Code Interpreter (not recommended for valuation runs)",
    )
    parser.add_argument(
        "--standard-search-budget",
        action="store_true",
        help="Use the standard web result token budget instead of unlimited",
    )
    parser.add_argument(
        "--skip-semantic-audit",
        action="store_true",
        help="Skip the second-pass structured audit (intended only for debugging)",
    )
    return parser


def _config_from_args(args: argparse.Namespace) -> DeepResearchConfig:
    config = DeepResearchConfig.from_env()
    overrides: dict[str, object] = {}
    for argument, field_name in (
        (args.model, "model"),
        (args.reasoning, "reasoning_effort"),
        (args.max_tool_calls, "max_tool_calls"),
        (args.timeout_seconds, "timeout_seconds"),
        (args.poll_seconds, "poll_seconds"),
    ):
        if argument is not None:
            overrides[field_name] = argument
    if args.no_code_interpreter:
        overrides["enable_code_interpreter"] = False
    if args.standard_search_budget:
        overrides["return_token_budget"] = "default"
    return config.with_overrides(**overrides) if overrides else config


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    snapshot = freeze_company_snapshot(
        args.ticker,
        company_name=args.company_name,
    )
    config = _config_from_args(args)
    engine = DeepResearchEngine(
        config=config,
        progress=lambda message: print(f"[deep-research] {message}", flush=True),
    )
    if args.resume:
        result = engine.resume(
            snapshot,
            response_id=args.resume,
            output_root=args.output_root,
        )
    else:
        result = engine.run(
            snapshot,
            output_root=args.output_root,
            dry_run=args.dry_run,
        )

    print(f"status={result.status}")
    print(f"run_id={result.run_id}")
    print(f"response_id={result.response_id}")
    print(f"output_dir={result.output_dir}")
    print(f"prompt={result.prompt_path}")
    if args.dry_run:
        return 0

    quality = evaluate_run_artifacts(result.output_dir)
    quality_path = write_quality_report(result.output_dir, quality)
    print(f"quality_score={quality.score}")
    print(f"quality_passed={str(quality.passed).lower()}")
    print(f"quality_report={quality_path}")
    print(f"report={result.report_path}")
    audit_usable = True
    valuation_compiled = True
    if not args.skip_semantic_audit:
        print("[deep-research] Running independent structured valuation audit", flush=True)
        audit = audit_run_directory(
            client=engine.client,
            run_dir=result.output_dir,
            snapshot=snapshot,
            model=config.audit_model,
            reasoning_effort=config.audit_reasoning_effort,
        )
        deterministic = audit.get("deterministic_arithmetic") or {}
        audit_usable = bool(deterministic.get("usable_target"))
        print(f"audit_score={audit.get('overall_quality_score')}")
        print(f"audit_target_usable={str(audit_usable).lower()}")
        print(f"audit={result.output_dir / 'research_audit.json'}")
        print("[deep-research] Extracting and compiling the valuation case", flush=True)
        compiled, valuation_compiled = compile_run_valuation_case(
            client=engine.client,
            run_dir=result.output_dir,
            snapshot=snapshot,
            model=config.audit_model,
            reasoning_effort=config.audit_reasoning_effort,
        )
        print(f"valuation_compiled={str(valuation_compiled).lower()}")
        artifact = "valuation_compiled.json" if valuation_compiled else "valuation_compile_errors.json"
        print(f"valuation_artifact={result.output_dir / artifact}")
        if not valuation_compiled:
            print(f"valuation_compile_issue_count={len(compiled.get('issues') or [])}")
    return 0 if quality.passed and audit_usable and valuation_compiled else 2


if __name__ == "__main__":
    raise SystemExit(main())
