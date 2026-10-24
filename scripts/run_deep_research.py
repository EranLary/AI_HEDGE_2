from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

dotenv_candidates = [ROOT / ".env"]
if ROOT.parent.name == ".tmp":
    # A task worktree lives below <repo>/.tmp/<worktree>. Reuse the developer's
    # single untracked root .env rather than copying credentials into worktrees.
    dotenv_candidates.append(ROOT.parent.parent / ".env")
for dotenv_path in dotenv_candidates:
    if dotenv_path.exists():
        load_dotenv(dotenv_path)
        break

from ai_hedge.deep_research.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
