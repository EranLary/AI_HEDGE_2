from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .control_client import ControlClient, ControlPlaneError


def execution_identity(exec_id: str) -> tuple[str, int]:
    family, separator, suffix = exec_id.rpartition(".")
    if separator and family and suffix.isdigit():
        return family, int(suffix)
    return exec_id, 0


class AmbiguousOrderIntentError(RuntimeError):
    pass


class LocalJournal:
    """Durable, non-secret executor journal.

    WAL-backed writes happen before an HTTP event or IBKR order submission. The
    journal is deliberately conservative: an order intent whose broker outcome
    cannot be proved is never submitted again automatically.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, timeout=10, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._db:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA synchronous=FULL")
            self._db.executescript(
                """
                CREATE TABLE IF NOT EXISTS outbox (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_key TEXT NOT NULL UNIQUE,
                    payload_json TEXT NOT NULL,
                    response_json TEXT,
                    delivered_at TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS order_intents (
                    client_order_key TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    ib_order_id INTEGER NOT NULL,
                    state TEXT NOT NULL CHECK (state IN ('prepared', 'submitted', 'resolved')),
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS broker_executions (
                    exec_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    commission_json TEXT,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS broker_commissions (
                    exec_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

    def close(self) -> None:
        with self._lock:
            self._db.close()

    @staticmethod
    def _event_key(payload: dict[str, Any]) -> str:
        action = str(payload.get("action", "event"))
        if action == "event":
            return f"event:{payload.get('event_id', '')}"
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if action == "fill":
            return f"fill:{payload.get('exec_id', '')}:{digest}"
        return f"{action}:{digest}"

    def enqueue(self, payload: dict[str, Any]) -> int:
        event_key = self._event_key(payload)
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        with self._lock, self._db:
            self._db.execute(
                "INSERT OR IGNORE INTO outbox (event_key, payload_json) VALUES (?, ?)",
                (event_key, encoded),
            )
            row = self._db.execute("SELECT id FROM outbox WHERE event_key = ?", (event_key,)).fetchone()
        return int(row["id"])

    def send(
        self,
        client: ControlClient,
        payload: dict[str, Any],
        *,
        strict: bool,
    ) -> dict[str, Any] | None:
        row_id = self.enqueue(payload)
        try:
            self.flush(client)
        except ControlPlaneError:
            if strict:
                raise
            return None
        with self._lock:
            row = self._db.execute(
                "SELECT response_json FROM outbox WHERE id = ? AND delivered_at IS NOT NULL",
                (row_id,),
            ).fetchone()
        return json.loads(row["response_json"]) if row and row["response_json"] else None

    def flush(self, client: ControlClient) -> int:
        delivered = 0
        while True:
            with self._lock:
                row = self._db.execute(
                    "SELECT id, payload_json FROM outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 1"
                ).fetchone()
            if not row:
                return delivered
            response = client.event(json.loads(row["payload_json"]))
            if response.get("accepted") is False:
                raise ControlPlaneError(
                    f"control plane rejected durable outbox event {int(row['id'])}"
                )
            with self._lock, self._db:
                self._db.execute(
                    "UPDATE outbox SET response_json = ?, delivered_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (json.dumps(response, separators=(",", ":"), ensure_ascii=True), int(row["id"])),
                )
            delivered += 1

    def pending_count(self) -> int:
        with self._lock:
            row = self._db.execute("SELECT COUNT(*) AS count FROM outbox WHERE delivered_at IS NULL").fetchone()
        return int(row["count"])

    def prepare_order(self, client_order_key: str, payload: dict[str, Any], ib_order_id: int) -> None:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        with self._lock, self._db:
            existing = self._db.execute(
                "SELECT state FROM order_intents WHERE client_order_key = ?", (client_order_key,)
            ).fetchone()
            if existing:
                raise AmbiguousOrderIntentError(
                    f"order intent {client_order_key} already exists with state {existing['state']}; "
                    "broker reconciliation is required before any retry"
                )
            self._db.execute(
                "INSERT INTO order_intents (client_order_key, payload_json, ib_order_id, state) VALUES (?, ?, ?, 'prepared')",
                (client_order_key, encoded, ib_order_id),
            )

    def mark_order_submitted(self, client_order_key: str) -> None:
        self._set_order_state(client_order_key, "submitted")

    def mark_order_resolved(self, client_order_key: str) -> None:
        self._set_order_state(client_order_key, "resolved")

    def _set_order_state(self, client_order_key: str, state: str) -> None:
        with self._lock, self._db:
            self._db.execute(
                "UPDATE order_intents SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE client_order_key = ?",
                (state, client_order_key),
            )

    def unresolved_order_keys(self) -> set[str]:
        with self._lock:
            rows = self._db.execute(
                "SELECT client_order_key FROM order_intents WHERE state <> 'resolved'"
            ).fetchall()
        return {str(row["client_order_key"]) for row in rows}

    def record_broker_execution(self, exec_id: str, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        with self._lock, self._db:
            self._db.execute(
                """
                INSERT INTO broker_executions (exec_id, payload_json)
                VALUES (?, ?)
                ON CONFLICT(exec_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (exec_id, encoded),
            )

    def record_commission(self, exec_id: str, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        with self._lock, self._db:
            self._db.execute(
                """
                INSERT INTO broker_commissions (exec_id, payload_json)
                VALUES (?, ?)
                ON CONFLICT(exec_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (exec_id, encoded),
            )

    def broker_executions(self) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
        with self._lock:
            rows = self._db.execute(
                """
                SELECT execution.exec_id, execution.payload_json,
                       COALESCE(commission.payload_json, execution.commission_json) AS commission_json
                  FROM broker_executions execution
                  LEFT JOIN broker_commissions commission ON commission.exec_id = execution.exec_id
                 ORDER BY execution.updated_at
                """
            ).fetchall()
        return [
            (
                str(row["exec_id"]),
                json.loads(row["payload_json"]),
                json.loads(row["commission_json"]) if row["commission_json"] else {},
            )
            for row in rows
        ]

    def effective_execution_ids(self, exec_ids: list[str]) -> set[str]:
        latest: dict[str, tuple[int, str]] = {}
        for exec_id in exec_ids:
            family, revision = execution_identity(exec_id)
            current = latest.get(family)
            if current is None or revision > current[0]:
                latest[family] = (revision, exec_id)
        return {item[1] for item in latest.values()}
