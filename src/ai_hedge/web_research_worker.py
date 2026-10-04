from __future__ import annotations

import json
import os
import sys
from contextlib import redirect_stdout
from datetime import datetime
from typing import Any, Dict


def _request_from_stdin() -> Dict[str, Any]:
    payload = json.loads(sys.stdin.read())
    if not isinstance(payload, dict):
        raise ValueError("Web research worker input must be a JSON object.")
    return payload


def main() -> int:
    request = _request_from_stdin()
    from . import obs
    from .web_research import run_web_research

    obs.install()
    obs_run_id = str(request.get("obs_run_id") or "").strip()
    token = obs.RUN_ID.set(obs_run_id) if obs_run_id else None
    try:
        generated_at = datetime.fromisoformat(str(request["generated_at"]))
        # Keep stdout machine-readable even if provider libraries print status
        # messages. Diagnostics remain available to the parent through stderr.
        with redirect_stdout(sys.stderr):
            payload = run_web_research(
                ticker=str(request.get("ticker") or ""),
                company_name=str(request.get("company_name") or ""),
                analysis_text=str(request.get("analysis_text") or ""),
                api_key=str(os.getenv("DEEPSEEK_API_KEY") or ""),
                output_dir=str(request.get("output_dir") or ""),
                now=generated_at,
            )
        sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str))
        return 0
    finally:
        if token is not None:
            obs.RUN_ID.reset(token)


if __name__ == "__main__":
    raise SystemExit(main())
