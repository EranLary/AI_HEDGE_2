from __future__ import annotations

import os
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

    def put(self, local_path, *, key, content_type=None):
        # Phase 0 stub. Phase 0.6 (#39) wires the real S3 client and uploads
        # local_path to the R2 bucket under `key`.
        return key

    def url_for(self, key, *, expires_in=3600):
        raise NotImplementedError("R2 URL signing lands in Phase 0.6 (#39).")


def get_artifact_store() -> ArtifactStore:
    if os.environ.get("ARTIFACT_STORE", "").strip().lower() == "r2":
        return R2ArtifactStore()
    return LocalFsArtifactStore()
