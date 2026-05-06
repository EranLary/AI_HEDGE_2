"""Internal observability for the agentic pipeline.

Captures every LLM call (prompt, response, tokens, cost, latency, retries)
into a dedicated Neon Postgres project keyed by run + stage + persona.
"""
from __future__ import annotations

from .context import llm_context, obs_submit, current_context, RUN_ID, STAGE, PERSONA
from .instrument import install
from .lifecycle import start_run, finalize_run

__all__ = [
    "install",
    "start_run",
    "finalize_run",
    "llm_context",
    "obs_submit",
    "current_context",
    "RUN_ID",
    "STAGE",
    "PERSONA",
]
