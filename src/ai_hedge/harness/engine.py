from __future__ import annotations

from dataclasses import dataclass


DETERMINISTIC_ENGINE_ID = "deterministic_v1"
HYBRID_ENGINE_ID = "hybrid_v1"
DEFAULT_ENGINE_ID = DETERMINISTIC_ENGINE_ID
HARNESS_SCHEMA_VERSION = "1.0"


@dataclass(frozen=True)
class EngineDescriptor:
    engine_id: str
    engine_version: str
    harness_schema_version: str
    hybrid: bool


_ENGINES = {
    DETERMINISTIC_ENGINE_ID: EngineDescriptor(
        engine_id=DETERMINISTIC_ENGINE_ID,
        engine_version="1.0.0",
        harness_schema_version=HARNESS_SCHEMA_VERSION,
        hybrid=False,
    ),
    HYBRID_ENGINE_ID: EngineDescriptor(
        engine_id=HYBRID_ENGINE_ID,
        engine_version="1.0.0",
        harness_schema_version=HARNESS_SCHEMA_VERSION,
        hybrid=True,
    ),
}


def normalize_engine_id(value: object, *, workspace: str = "analysis") -> str:
    engine_id = str(value or DEFAULT_ENGINE_ID).strip().lower()
    if engine_id not in _ENGINES:
        allowed = ", ".join(sorted(_ENGINES))
        raise ValueError(f"Unknown analysis engine '{engine_id}'. Expected one of: {allowed}.")
    if workspace != "analysis" and engine_id != DETERMINISTIC_ENGINE_ID:
        raise ValueError("hybrid_v1 is available only in the analysis workspace.")
    return engine_id


def engine_descriptor(value: object, *, workspace: str = "analysis") -> EngineDescriptor:
    return _ENGINES[normalize_engine_id(value, workspace=workspace)]
