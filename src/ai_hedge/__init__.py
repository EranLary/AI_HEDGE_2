"""AI Hedge valuation package."""

__all__ = [
    "run_ticker_valuation",
    "run_lite_analysis",
    "run_full_analysis",
    "run_sec_analysis",
    "run_sec_analysis_full",
    "run_sec_analysis_short",
]


def __getattr__(name: str):
    if name == "run_ticker_valuation":
        from .runner import run_ticker_valuation

        return run_ticker_valuation
    if name in {
        "run_full_analysis",
        "run_lite_analysis",
        "run_sec_analysis",
        "run_sec_analysis_full",
        "run_sec_analysis_short",
    }:
        from . import service

        return getattr(service, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
