from __future__ import annotations

import hmac
import json
import os
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from uuid import UUID


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def _uuid(value: object) -> str:
    return str(UUID(str(value or "").strip()))


def _live_run_id() -> str | None:
    from ai_hedge.db.connection import get_conn

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text
                  FROM nasdaq_universe_runs
                 WHERE status IN ('queued', 'running')
                 ORDER BY created_at
                 LIMIT 1;
                """
            )
            row = cur.fetchone()
    return str(row[0]) if row else None


class RunnerManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._child: subprocess.Popen | None = None
        self._run_id: str | None = None

    def status(self) -> dict[str, Any]:
        with self._lock:
            running = self._child is not None and self._child.poll() is None
            return {
                "status": "running" if running else "idle",
                "run_id": self._run_id if running else None,
                "pid": self._child.pid if running and self._child else None,
            }

    def start(self, run_id: str) -> tuple[bool, str]:
        clean_id = _uuid(run_id)
        with self._lock:
            if self._child is not None and self._child.poll() is None:
                if self._run_id == clean_id:
                    return True, "Run is already active."
                return False, f"Worker is already processing run {self._run_id}."

            command = [sys.executable, str(ROOT / "scripts" / "nasdaq_universe_run.py"), "--run-id", clean_id]
            env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONPATH": str(SRC)}
            self._child = subprocess.Popen(
                command,
                cwd=ROOT,
                env=env,
                start_new_session=True,
            )
            self._run_id = clean_id
            child = self._child
            threading.Thread(
                target=self._monitor,
                args=(child, clean_id),
                name=f"nasdaq-run-{clean_id[:8]}",
                daemon=True,
            ).start()
            return True, "Run accepted."

    def _monitor(self, child: subprocess.Popen, run_id: str) -> None:
        child.wait()
        with self._lock:
            if self._child is child:
                self._child = None
                self._run_id = None
        # A machine restart can leave a live DB run behind. If another live run
        # is already queued when this child exits, pick it up without a browser.
        try:
            time.sleep(5)
            next_run = _live_run_id()
            if next_run:
                self.start(next_run)
        except Exception:
            pass

    def recover(self) -> None:
        try:
            run_id = _live_run_id()
            if run_id:
                self.start(run_id)
        except Exception as exc:
            print(f"[nasdaq-worker] startup recovery failed: {exc}", file=sys.stderr)


MANAGER = RunnerManager()


def _validate_runtime_config() -> None:
    required = [
        "DEEPSEEK_API_KEY",
        "R2_ENDPOINT_URL",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
    ]
    missing = [name for name in required if not str(os.environ.get(name, "") or "").strip()]
    if not (
        str(os.environ.get("DATABASE_URL_UNPOOLED", "") or "").strip()
        or str(os.environ.get("DATABASE_URL", "") or "").strip()
    ):
        missing.append("DATABASE_URL_UNPOOLED")
    if str(os.environ.get("ARTIFACT_STORE", "") or "").strip().lower() != "r2":
        missing.append("ARTIFACT_STORE=r2")
    if missing:
        raise RuntimeError(f"Nasdaq worker configuration is incomplete: {', '.join(missing)}")


class Handler(BaseHTTPRequestHandler):
    server_version = "NasdaqWorker/1.0"

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path not in {"/health", "/api/health"}:
            self._json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return
        # This endpoint is public so Fly can wake and health-check the
        # scale-to-zero machine. Do not expose the active run UUID or PID.
        self._json(HTTPStatus.OK, {"ok": True, "status": MANAGER.status()["status"]})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/wake":
            self._json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return
        expected = str(os.environ.get("NASDAQ_WORKER_TOKEN", "") or "").strip()
        supplied = str(self.headers.get("authorization") or "")
        if not expected or not supplied.startswith("Bearer ") or not hmac.compare_digest(supplied[7:], expected):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "Unauthorized."})
            return
        try:
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > 4096:
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            run_id = _uuid(payload.get("run_id"))
            accepted, message = MANAGER.start(run_id)
        except Exception as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        self._json(HTTPStatus.ACCEPTED if accepted else HTTPStatus.CONFLICT, {
            "ok": accepted,
            "message": message,
            **MANAGER.status(),
        })

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[nasdaq-worker] {self.address_string()} {fmt % args}")


def main() -> int:
    port = int(str(os.environ.get("PORT", "8080") or "8080"))
    if not str(os.environ.get("NASDAQ_WORKER_TOKEN", "") or "").strip():
        raise RuntimeError("NASDAQ_WORKER_TOKEN is required")
    _validate_runtime_config()
    threading.Thread(target=MANAGER.recover, name="nasdaq-recover", daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"[nasdaq-worker] listening on :{port}")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
