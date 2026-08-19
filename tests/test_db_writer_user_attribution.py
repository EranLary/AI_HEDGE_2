from __future__ import annotations

from ai_hedge.db import connection, repository, transform, writer


class FakeConnection:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def commit(self):
        return None


class FakeAttributionCursor:
    def __init__(self):
        self.params = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, _sql, params):
        self.params = params

    def fetchone(self):
        return (self.params[1],)


class FakeAttributionConnection(FakeConnection):
    def __init__(self):
        self.cursor_instance = FakeAttributionCursor()
        self.committed = False

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.committed = True


def test_write_run_to_db_persists_normalized_user_id(monkeypatch, tmp_path):
    user_id = "A2D2C986-B9D9-4CD6-81A5-11F9D85B1A34"
    captured: dict[str, object] = {}
    bundle = {
        "ticker_row": {"symbol": "AAPL"},
        "report_row": {"ticker": "AAPL", "user_id": None},
        "artifact_row": {"dashboard": {}},
    }

    monkeypatch.setenv("DATABASE_URL", "postgresql://test")
    monkeypatch.setattr(connection, "get_conn", FakeConnection)
    monkeypatch.setattr(transform, "ticker_dir_to_row", lambda *_args, **_kwargs: bundle)
    monkeypatch.setattr(repository, "upsert_ticker", lambda *_args, **_kwargs: None)

    def fake_insert_report(_conn, report_row, _artifact_row):
        captured.update(report_row)
        return ("e37cdde7-e6d1-41d2-aa28-149f12f6a396", True)

    monkeypatch.setattr(repository, "insert_report", fake_insert_report)

    report_id, error = writer.write_run_to_db(
        tmp_path,
        source="site",
        user_id=user_id,
    )

    assert error is None
    assert report_id == "e37cdde7-e6d1-41d2-aa28-149f12f6a396"
    assert captured["user_id"] == user_id.lower()


def test_write_run_to_db_rejects_non_uuid_user_id(monkeypatch, tmp_path):
    captured: dict[str, object] = {}
    bundle = {
        "ticker_row": {"symbol": "AAPL"},
        "report_row": {"ticker": "AAPL", "user_id": "unexpected"},
        "artifact_row": {"dashboard": {}},
    }

    monkeypatch.setenv("DATABASE_URL", "postgresql://test")
    monkeypatch.setattr(connection, "get_conn", FakeConnection)
    monkeypatch.setattr(transform, "ticker_dir_to_row", lambda *_args, **_kwargs: bundle)
    monkeypatch.setattr(repository, "upsert_ticker", lambda *_args, **_kwargs: None)

    def fake_insert_report(_conn, report_row, _artifact_row):
        captured.update(report_row)
        return ("e37cdde7-e6d1-41d2-aa28-149f12f6a396", True)

    monkeypatch.setattr(repository, "insert_report", fake_insert_report)

    _, error = writer.write_run_to_db(
        tmp_path,
        source="site",
        user_id="local-dev",
    )

    assert error is None
    assert captured["user_id"] is None


def test_attribute_report_to_user_updates_only_the_requested_owner(monkeypatch):
    report_id = "e37cdde7-e6d1-41d2-aa28-149f12f6a396"
    user_id = "a2d2c986-b9d9-4cd6-81a5-11f9d85b1a34"
    fake_conn = FakeAttributionConnection()

    monkeypatch.setenv("DATABASE_URL", "postgresql://test")
    monkeypatch.setattr(connection, "get_conn", lambda: fake_conn)

    assert writer.attribute_report_to_user(report_id, user_id) is True
    assert fake_conn.cursor_instance.params == (user_id, report_id, user_id)
    assert fake_conn.committed is True
