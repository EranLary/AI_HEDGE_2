from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from typing import Iterator

import pytest

from scripts import nasdaq_worker_server


@contextmanager
def _server() -> Iterator[str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), nasdaq_worker_server.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _json_response(request: urllib.request.Request) -> tuple[int, dict]:
    try:
        response = urllib.request.urlopen(request, timeout=2)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))
    with response:
        return response.status, json.loads(response.read().decode("utf-8"))


def test_public_health_does_not_expose_run_id_or_pid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        nasdaq_worker_server.MANAGER,
        "status",
        lambda: {"status": "running", "run_id": "secret-run", "pid": 123},
    )
    with _server() as base_url:
        status, payload = _json_response(urllib.request.Request(f"{base_url}/health"))

    assert status == 200
    assert payload == {"ok": True, "status": "running"}


def test_wake_requires_the_shared_bearer_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NASDAQ_WORKER_TOKEN", "shared-secret")
    with _server() as base_url:
        request = urllib.request.Request(
            f"{base_url}/wake",
            data=json.dumps({"run_id": "00000000-0000-4000-8000-000000000001"}).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        status, payload = _json_response(request)

    assert status == 401
    assert payload == {"error": "Unauthorized."}


def test_authenticated_wake_starts_the_requested_run(monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = "00000000-0000-4000-8000-000000000001"
    started: list[str] = []
    monkeypatch.setenv("NASDAQ_WORKER_TOKEN", "shared-secret")
    monkeypatch.setattr(
        nasdaq_worker_server.MANAGER,
        "start",
        lambda value: (started.append(value) is None, "Run accepted."),
    )
    monkeypatch.setattr(
        nasdaq_worker_server.MANAGER,
        "status",
        lambda: {"status": "running", "run_id": run_id, "pid": 123},
    )
    with _server() as base_url:
        request = urllib.request.Request(
            f"{base_url}/wake",
            data=json.dumps({"run_id": run_id}).encode("utf-8"),
            headers={"authorization": "Bearer shared-secret", "content-type": "application/json"},
            method="POST",
        )
        status, payload = _json_response(request)

    assert status == 202
    assert payload["ok"] is True
    assert started == [run_id]
