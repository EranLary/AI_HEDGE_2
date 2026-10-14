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

from ai_hedge.deep_research.case_audit import audit_compiled_valuation_case
from ai_hedge.deep_research.config import DeepResearchConfig, require_openai_api_key
from ai_hedge.deep_research.snapshot import CompanySnapshot


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Independently audit a deterministically compiled valuation case."
    )
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--research-attempt", type=int, required=True)
    parser.add_argument(
        "--profile",
        choices=["auto", "generic", "broker"],
        default="auto",
        help="Compiled-case artifact family. Auto prefers a broker artifact when present.",
    )
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    snapshot = CompanySnapshot(
        **json.loads((run_dir / "snapshot.json").read_text(encoding="utf-8"))
    )
    broker_prefix = f"broker_valuation_research_{args.research_attempt}"
    generic_prefix = f"valuation_research_{args.research_attempt}"
    if args.profile == "broker" or (
        args.profile == "auto" and (run_dir / f"{broker_prefix}_case.json").exists()
    ):
        prefix = broker_prefix
        audit_prefix = "broker_valuation_case_audit"
    else:
        prefix = generic_prefix
        audit_prefix = "valuation_case_audit"
    print(f"valuation_profile={'broker' if prefix == broker_prefix else 'generic'}")
    valuation_case = json.loads(
        (run_dir / f"{prefix}_case.json").read_text(encoding="utf-8")
    )
    compiled_payload = json.loads(
        (run_dir / f"{prefix}_compiled.json").read_text(encoding="utf-8")
    )
    config = DeepResearchConfig.from_env()
    client = OpenAI(api_key=require_openai_api_key(), timeout=120, max_retries=3)
    audit, ready = audit_compiled_valuation_case(
        client=client,
        config=config,
        snapshot=snapshot,
        run_dir=run_dir,
        valuation_case=valuation_case,
        compiled=compiled_payload.get("compiled") or {},
        attempt=args.research_attempt,
        artifact_prefix=audit_prefix,
        progress=lambda message: print(f"[valuation-audit] {message}", flush=True),
    )
    print(f"audit_score={audit.get('quality_score')}")
    print(f"publication_ready={str(ready).lower()}")
    print(f"audit={run_dir / f'{audit_prefix}_{args.research_attempt}.json'}")
    return 0 if ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
