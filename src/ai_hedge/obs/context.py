"""Context propagation for the obs platform.

Uses contextvars (NOT thread-locals) so values flow into ThreadPoolExecutor
workers when callers use ``obs_submit`` (or manually wrap with
``contextvars.copy_context().run``).
"""
from __future__ import annotations

import contextvars
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Optional

RUN_ID: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("OBS_RUN_ID", default=None)
STAGE: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("OBS_STAGE", default=None)
PERSONA: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("OBS_PERSONA", default=None)
PARENT_CALL_ID: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("OBS_PARENT_CALL_ID", default=None)


@dataclass(frozen=True)
class ObsContext:
    run_id: Optional[str]
    stage: Optional[str]
    persona: Optional[str]
    parent_call_id: Optional[str]


def current_context() -> ObsContext:
    return ObsContext(
        run_id=RUN_ID.get(),
        stage=STAGE.get(),
        persona=PERSONA.get(),
        parent_call_id=PARENT_CALL_ID.get(),
    )


@contextmanager
def llm_context(
    *,
    run_id: Optional[str] = None,
    stage: Optional[str] = None,
    persona: Optional[str] = None,
    parent_call_id: Optional[str] = None,
):
    """Set obs context vars for the duration of the block.

    Inherits any unset value from the surrounding context. Tokens reset
    on exit even if the block raises.
    """
    tokens = []
    if run_id is not None:
        tokens.append((RUN_ID, RUN_ID.set(run_id)))
    if stage is not None:
        tokens.append((STAGE, STAGE.set(stage)))
    if persona is not None:
        tokens.append((PERSONA, PERSONA.set(persona)))
    if parent_call_id is not None:
        tokens.append((PARENT_CALL_ID, PARENT_CALL_ID.set(parent_call_id)))
    try:
        yield
    finally:
        for var, token in reversed(tokens):
            var.reset(token)


def obs_submit(executor, fn, /, *args, **kwargs):
    """Submit ``fn`` to ``executor`` while propagating obs context vars.

    ThreadPoolExecutor.submit does NOT copy contextvars on its own; this helper
    captures the current context and runs ``fn`` inside it on the worker thread.
    """
    ctx = contextvars.copy_context()
    return executor.submit(ctx.run, fn, *args, **kwargs)
