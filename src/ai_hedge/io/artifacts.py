from __future__ import annotations

import os
import mimetypes
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional


class ArtifactStore(ABC):
    is_remote: bool = False

    @abstractmethod
    def put(
        self,
        local_path: Path,
        *,
        key: str,
        content_type: Optional[str] = None,
    ) -> str:
        ...

    @abstractmethod
    def url_for(self, key: str, *, expires_in: int = 3600) -> str:
        ...


class LocalFsArtifactStore(ArtifactStore):
    def put(self, local_path, *, key, content_type=None):
        return str(local_path)

    def url_for(self, key, *, expires_in=3600):
        return key


class R2ArtifactStore(ArtifactStore):
    is_remote = True

    def __init__(self) -> None:
        endpoint = str(os.environ.get("R2_ENDPOINT_URL", "") or "").strip()
        access_key = str(os.environ.get("R2_ACCESS_KEY_ID", "") or "").strip()
        secret_key = str(os.environ.get("R2_SECRET_ACCESS_KEY", "") or "").strip()
        bucket = str(os.environ.get("R2_BUCKET", "") or "").strip()
        missing = [
            name
            for name, value in (
                ("R2_ENDPOINT_URL", endpoint),
                ("R2_ACCESS_KEY_ID", access_key),
                ("R2_SECRET_ACCESS_KEY", secret_key),
                ("R2_BUCKET", bucket),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"R2 artifact storage is missing: {', '.join(missing)}")

        import boto3

        self._bucket = bucket
        self._public_base = str(os.environ.get("R2_PUBLIC_BASE_URL", "") or "").strip().rstrip("/")
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=str(os.environ.get("R2_REGION", "auto") or "auto").strip(),
        )

    def put(self, local_path, *, key, content_type=None):
        path = Path(local_path).resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        clean_key = str(key or "").strip().lstrip("/")
        if not clean_key:
            raise ValueError("Artifact object key is required")
        detected_type = content_type or mimetypes.guess_type(path.name)[0]
        extra = {"ContentType": detected_type} if detected_type else None
        if extra:
            self._client.upload_file(str(path), self._bucket, clean_key, ExtraArgs=extra)
        else:
            self._client.upload_file(str(path), self._bucket, clean_key)
        return clean_key

    def url_for(self, key, *, expires_in=3600):
        clean_key = str(key or "").strip().lstrip("/")
        if self._public_base:
            return f"{self._public_base}/{clean_key}"
        return str(
            self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": clean_key},
                ExpiresIn=max(60, int(expires_in)),
            )
        )


def get_artifact_store() -> ArtifactStore:
    if os.environ.get("ARTIFACT_STORE", "").strip().lower() == "r2":
        return R2ArtifactStore()
    return LocalFsArtifactStore()
