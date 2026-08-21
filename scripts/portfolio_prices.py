from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ai_hedge.portfolio_prices import fetch_price_bundle  # noqa: E402


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        start = date.fromisoformat(str(payload["start"]))
        end = date.fromisoformat(str(payload["end"]))
        instruments = payload.get("instruments") or []
        workers = int(payload.get("workers") or 8)
        benchmark_symbol = str(payload.get("benchmark_symbol") or "^SP500TR").strip().upper()
        result = fetch_price_bundle(
            instruments,
            start=start,
            end=end,
            repo_root=ROOT,
            workers=workers,
            benchmark_symbol=benchmark_symbol,
        )
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
