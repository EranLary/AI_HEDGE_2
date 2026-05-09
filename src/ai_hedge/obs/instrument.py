"""Monkey-patch installer for the LLM wrapper.

Replaces ``ai_hedge.legacy_port.deepseek_simple_text`` with a tracing version
that captures prompt + response + usage + latency + retries into obs_calls.
Idempotent. Safe to call from multiple module top-levels.

Behavior preservation: the patched function has the same signature, same
return type, and same exceptions as the original. It internally calls the
private ``_deepseek_simple_full`` helper added to legacy_port to access the
data the original throws away.

Also monkey-patches ``concurrent.futures.ThreadPoolExecutor.submit`` to
propagate contextvars into worker threads - without this, every LLM call in
a worker pool loses its ``run_id`` / ``stage`` / ``persona`` context.
"""
from __future__ import annotations

import contextvars
import inspect
import os
import sys
import traceback
from datetime import datetime, timezone
from typing import Any, Optional

from . import db
from .context import current_context
from .pricing import cost_usd

_INSTALLED = False

_OBS_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
_LEGACY_PORT_FILE: Optional[str] = None


def _resolve_call_site() -> Optional[str]:
    """Walk the stack to find the first frame outside obs/ and legacy_port.py.

    Returns ``"qualname:lineno"`` (with class prefix when ``self`` is bound) or
    None when nothing useful is found. Cheap enough to call per LLM request —
    LLM latency dwarfs ``inspect.stack()``.
    """
    global _LEGACY_PORT_FILE
    if _LEGACY_PORT_FILE is None:
        try:
            from ai_hedge import legacy_port as _lp

            _LEGACY_PORT_FILE = os.path.abspath(_lp.__file__) if _lp.__file__ else ""
        except Exception:
            _LEGACY_PORT_FILE = ""

    for frame_info in inspect.stack()[2:]:
        path = os.path.abspath(frame_info.filename)
        if path.startswith(_OBS_PKG_DIR):
            continue
        if _LEGACY_PORT_FILE and path == _LEGACY_PORT_FILE:
            continue
        name = frame_info.function
        f_locals = frame_info.frame.f_locals
        self_obj = f_locals.get("self")
        if self_obj is not None:
            name = f"{type(self_obj).__name__}.{name}"
        return f"{name}:{frame_info.lineno}"
    return None


def _patch_thread_pool_executor() -> None:
    from concurrent.futures import ThreadPoolExecutor

    if getattr(ThreadPoolExecutor.submit, "_obs_ctx_propagating", False):
        return

    _orig_submit = ThreadPoolExecutor.submit

    def submit(self, fn, /, *args, **kwargs):
        ctx = contextvars.copy_context()
        return _orig_submit(self, ctx.run, fn, *args, **kwargs)

    submit._obs_ctx_propagating = True  # type: ignore[attr-defined]
    ThreadPoolExecutor.submit = submit  # type: ignore[assignment]


def install() -> None:
    """Install the tracing wrapper + contextvar propagation. Idempotent."""
    global _INSTALLED
    if _INSTALLED:
        return

    _patch_thread_pool_executor()

    from ai_hedge import legacy_port as lp

    original = getattr(lp, "deepseek_simple_text", None)
    full = getattr(lp, "_deepseek_simple_full", None)
    if original is None or full is None:
        print(
            "[obs.instrument] legacy_port is missing deepseek_simple_text or _deepseek_simple_full; skipping install",
            file=sys.stderr,
        )
        return
    if getattr(original, "_obs_traced", False):
        _INSTALLED = True
        return

    def traced(
        *,
        api_key: str,
        prompt: str,
        model: str = "deepseek-chat",
        temperature: float = 0.5,
        timeout=(10.0, 180.0),
        max_retries: int = 4,
        backoff_factor: float = 0.4,
        short_answer: bool = True,
        print_prompt: bool = False,
        pool_size: int = 20,
    ) -> str:
        ctx = current_context()
        started_at = datetime.now(timezone.utc)
        call_site = _resolve_call_site()

        # We can't know the exact augmented prompt the original computes
        # (with the short_answer suffix) without duplicating logic, so we
        # ask _deepseek_simple_full to return that too.
        try:
            result: dict[str, Any] = full(
                api_key=api_key,
                prompt=prompt,
                model=model,
                temperature=temperature,
                timeout=timeout,
                max_retries=max_retries,
                backoff_factor=backoff_factor,
                short_answer=short_answer,
                print_prompt=print_prompt,
                pool_size=pool_size,
            )
            ended_at = datetime.now(timezone.utc)

            content = result.get("content", "")
            usage = result.get("usage") or {}
            tokens_in = usage.get("prompt_tokens")
            tokens_out = usage.get("completion_tokens")
            tokens_total = usage.get("total_tokens")
            model_actual = result.get("model_actual")

            if ctx.run_id:
                db.insert_call(
                    run_id=ctx.run_id,
                    parent_id=ctx.parent_call_id,
                    stage=ctx.stage or "unknown",
                    persona=ctx.persona,
                    call_site=call_site,
                    model_requested=model,
                    model_actual=model_actual,
                    temperature=float(temperature),
                    prompt=str(result.get("effective_prompt", prompt)),
                    response=content,
                    reasoning=result.get("reasoning_content"),
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    tokens_total=tokens_total,
                    cost_usd=cost_usd(model_actual or model, tokens_in, tokens_out),
                    latency_ms=int(result.get("latency_ms") or 0),
                    retries=int(result.get("retries") or 0),
                    status="ok",
                    error_class=None,
                    error_message=None,
                    started_at=started_at,
                    ended_at=ended_at,
                )
            return content
        except Exception as exc:  # noqa: BLE001
            ended_at = datetime.now(timezone.utc)
            if ctx.run_id:
                try:
                    db.insert_call(
                        run_id=ctx.run_id,
                        parent_id=ctx.parent_call_id,
                        stage=ctx.stage or "unknown",
                        persona=ctx.persona,
                        call_site=call_site,
                        model_requested=model,
                        model_actual=None,
                        temperature=float(temperature),
                        prompt=prompt,
                        response=None,
                        reasoning=None,
                        tokens_in=None,
                        tokens_out=None,
                        tokens_total=None,
                        cost_usd=None,
                        latency_ms=int((ended_at - started_at).total_seconds() * 1000),
                        retries=int(max_retries),
                        status="error",
                        error_class=type(exc).__name__,
                        error_message=f"{exc}"[:2000],
                        started_at=started_at,
                        ended_at=ended_at,
                    )
                except Exception:  # noqa: BLE001
                    traceback.print_exc(file=sys.stderr)
            raise

    traced._obs_traced = True
    lp.deepseek_simple_text = traced
    _INSTALLED = True
