from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from ai_hedge.deep_research.broker_compiler import compile_broker_valuation_case
from ai_hedge.deep_research.compiler import ValuationCompilationError


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compile a driver-based broker valuation case JSON file."
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    try:
        result = compile_broker_valuation_case(payload)
    except ValuationCompilationError as exc:
        output = {"valid": False, "issues": list(exc.issues)}
        rendered = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.write_text(rendered, encoding="utf-8")
            print(args.output)
        else:
            print(rendered, end="")
        return 2
    output = {"valid": True, "compiled": result.to_dict()}
    rendered = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
        print(args.output)
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
