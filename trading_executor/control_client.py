from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.request
from typing import Any


class ControlPlaneError(RuntimeError):
    pass


class ControlClient:
    def __init__(self, base_url: str, connection_id: str = "", device_secret: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.connection_id = connection_id
        self.device_secret = device_secret

    def pair(self, *, code: str, account_id: str, executor_version: str) -> dict[str, Any]:
        return self._request("/api/trading/executor/pair", {
            "code": code,
            "account_id": account_id,
            "mode": "paper",
            "executor_version": executor_version,
        }, signed=False)

    def sync(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("/api/trading/executor/sync", payload, signed=True)

    def event(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("/api/trading/executor/events", payload, signed=True)

    def _request(self, path: str, payload: dict[str, Any], *, signed: bool) -> dict[str, Any]:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        headers = {"content-type": "application/json", "user-agent": "hib-ibkr-executor"}
        if signed:
            timestamp = str(int(time.time()))
            nonce = secrets.token_urlsafe(18)
            body_hash = hashlib.sha256(body).hexdigest()
            signature_payload = f"{timestamp}\n{nonce}\n{body_hash}".encode("utf-8")
            signature = hmac.new(self.device_secret.encode("utf-8"), signature_payload, hashlib.sha256).hexdigest()
            headers.update({
                "authorization": f"Bearer {self.device_secret}",
                "x-trading-connection": self.connection_id,
                "x-trading-timestamp": timestamp,
                "x-trading-nonce": nonce,
                "x-trading-signature": signature,
            })
        request = urllib.request.Request(self.base_url + path, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="replace")
            raise ControlPlaneError(f"control plane returned HTTP {error.code}: {details}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ControlPlaneError(f"control plane is unavailable: {error}") from error
