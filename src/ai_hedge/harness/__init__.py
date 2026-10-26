"""Application-owned research harness contracts and runtime helpers."""

from .engine import (
    DEFAULT_ENGINE_ID,
    DETERMINISTIC_ENGINE_ID,
    HYBRID_ENGINE_ID,
    EngineDescriptor,
    engine_descriptor,
    normalize_engine_id,
)
from .session import HarnessSession, sha256_text

__all__ = [
    "DEFAULT_ENGINE_ID",
    "DETERMINISTIC_ENGINE_ID",
    "HYBRID_ENGINE_ID",
    "EngineDescriptor",
    "HarnessSession",
    "engine_descriptor",
    "normalize_engine_id",
    "sha256_text",
]
