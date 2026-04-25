from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def _load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return
    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().lstrip("﻿")
        value = value.strip().strip('"').strip("'")
        current = os.environ.get(key)
        if key and (current is None or current == ""):
            os.environ[key] = value


_load_dotenv(ROOT / ".env")

from ai_hedge.dbcli import main


if __name__ == "__main__":
    raise SystemExit(main())
