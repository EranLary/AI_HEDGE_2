"""Standalone, source-grounded equity Deep Research engine.

This package intentionally has no dependency on the legacy valuation pipeline.
It is evaluated as an independent research model before any product integration.
"""

from .config import DeepResearchConfig
from .engine import DeepResearchEngine, DeepResearchRunResult
from .snapshot import CompanySnapshot, freeze_company_snapshot

__all__ = [
    "CompanySnapshot",
    "DeepResearchConfig",
    "DeepResearchEngine",
    "DeepResearchRunResult",
    "freeze_company_snapshot",
]
