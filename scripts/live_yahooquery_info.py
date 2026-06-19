from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch live yahooquery valuation and financial data.")
    parser.add_argument("--ticker", required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    src = repo_root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

    from ai_hedge.yahooquery_data import fetch_yahooquery_snapshot

    ticker = str(args.ticker or "").strip().upper()
    payload = fetch_yahooquery_snapshot(ticker)
    print(json.dumps(payload, ensure_ascii=False, allow_nan=False))
    return 0 if payload.get("status") == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())

