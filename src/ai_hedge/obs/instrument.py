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
import sys
import traceback
from datetime import datetime, timezone
from typing import Any, Optional

from . import db
from .context import current_context
from .pricing import cost_usd

_INSTALLED = False


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
                    call_site=None,
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
                        call_site=None,
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
