from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from ai_hedge.io.artifacts import R2ArtifactStore


class FakeS3:
    def __init__(self) -> None:
        self.uploads: list[tuple] = []

    def upload_file(self, *args, **kwargs) -> None:
        self.uploads.append((*args, kwargs))

    def generate_presigned_url(self, *_args, **_kwargs) -> str:
        return "https://signed.example/artifact"


def _configure(monkeypatch: pytest.MonkeyPatch) -> FakeS3:
    fake = FakeS3()
    monkeypatch.setenv("R2_ENDPOINT_URL", "https://account.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "access")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("R2_BUCKET", "reports")
    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace(client=lambda *_args, **_kwargs: fake))
    return fake


def test_r2_store_uploads_and_returns_the_object_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _configure(monkeypatch)
    artifact = tmp_path / "AAPL.pdf"
    artifact.write_bytes(b"pdf")

    store = R2ArtifactStore()
    key = store.put(artifact, key="reports/nasdaq100/release/AAPL.pdf")

    assert key == "reports/nasdaq100/release/AAPL.pdf"
    assert fake.uploads[0][0:3] == (str(artifact.resolve()), "reports", key)
    assert fake.uploads[0][3]["ExtraArgs"]["ContentType"] == "application/pdf"


def test_r2_store_fails_closed_when_credentials_are_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(RuntimeError, match="R2 artifact storage is missing"):
        R2ArtifactStore()
