from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping, Optional, Sequence

from .snapshot import CompanySnapshot


AUDIT_VERSION = "equity-research-audit-v1"


def valuation_audit_schema() -> dict[str, Any]:
    nullable_number = {"type": ["number", "null"]}
    nullable_string = {"type": ["string", "null"]}
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "audit_version",
            "identity",
            "coverage",
            "valuation",
            "issues",
            "overall_quality_score",
        ],
        "properties": {
            "audit_version": {"type": "string"},
            "identity": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "ticker",
                    "company_name",
                    "valuation_date",
                    "quote_currency",
                    "reporting_currency",
                ],
                "properties": {
                    "ticker": {"type": "string"},
                    "company_name": {"type": "string"},
                    "valuation_date": nullable_string,
                    "quote_currency": nullable_string,
                    "reporting_currency": nullable_string,
                },
            },
            "coverage": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "business_model",
                    "financial_analysis",
                    "accounting_notes",
                    "market_and_competition",
                    "sector_kpis",
                    "peers",
                    "moat",
                    "governance",
                    "risks_and_thesis_breakers",
                    "intrinsic_valuation",
                    "comparable_valuation",
                    "third_method_or_reasoned_omission",
                    "sensitivity_analysis",
                    "final_decision",
                ],
                "properties": {
                    name: {"type": "boolean"}
                    for name in (
                        "business_model",
                        "financial_analysis",
                        "accounting_notes",
                        "market_and_competition",
                        "sector_kpis",
                        "peers",
                        "moat",
                        "governance",
                        "risks_and_thesis_breakers",
                        "intrinsic_valuation",
                        "comparable_valuation",
                        "third_method_or_reasoned_omission",
                        "sensitivity_analysis",
                        "final_decision",
                    )
                },
            },
            "valuation": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "reference_price",
                    "target_price",
                    "upside_downside_pct",
                    "currency",
                    "diluted_shares_used",
                    "recommendation",
                    "horizon",
                    "methods",
                ],
                "properties": {
                    "reference_price": nullable_number,
                    "target_price": nullable_number,
                    "upside_downside_pct": nullable_number,
                    "currency": nullable_string,
                    "diluted_shares_used": nullable_number,
                    "recommendation": nullable_string,
                    "horizon": nullable_string,
                    "methods": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "name",
                                "value_per_share",
                                "weight_pct",
                                "used_in_final",
                                "currency",
                            ],
                            "properties": {
                                "name": {"type": "string"},
                                "value_per_share": nullable_number,
                                "weight_pct": nullable_number,
                                "used_in_final": {"type": "boolean"},
                                "currency": nullable_string,
                            },
                        },
                    },
                },
            },
            "issues": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["severity", "category", "description", "report_evidence"],
                    "properties": {
                        "severity": {
                            "type": "string",
                            "enum": ["critical", "major", "minor"],
                        },
                        "category": {
                            "type": "string",
                            "enum": [
                                "identity",
                                "source_support",
                                "freshness",
                                "scope",
                                "currency",
                                "share_count",
                                "accounting",
                                "valuation_method",
                                "arithmetic",
                                "contradiction",
                                "coverage",
                                "writing",
                                "other",
                            ],
                        },
                        "description": {"type": "string"},
                        "report_evidence": {"type": "string"},
                    },
                },
            },
            "overall_quality_score": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
            },
        },
    }


def build_audit_prompt(
    snapshot: CompanySnapshot,
    report: str,
    sources: Sequence[Mapping[str, Any]],
) -> str:
    source_index = [
        {
            "title": str(source.get("title") or ""),
            "url": str(source.get("url") or ""),
            "cited_in_report": bool(source.get("cited")),
            "also_in_expanded_search_log": bool(source.get("consulted")),
        }
        for source in sources
    ]
    return f"""
You are the independent quality-control and valuation-extraction stage for an institutional equity
research engine. Audit only the supplied report and source index. Do not add new research, repair
the report, or infer a missing number. Extract exact values when the report states them; otherwise
return null.

Audit priorities:
1. Detect mixed entity scope, dates, periods, units, currencies, or parent/subsidiary denominators.
2. Detect internally inconsistent valuation methods, FCFF/FCFE discount-rate mismatches,
   double-counted cash/debt, unsupported diluted-share counts, and arithmetic that does not reconcile.
3. Detect material claims that appear unsupported by the retained source index or contradict another
   part of the report. A row with cited_in_report=true is direct evidence that the response cited that
   URL. also_in_expanded_search_log is only supplementary API telemetry: false does NOT mean the source
   was unconsulted and must never, by itself, be reported as a support failure or contradiction. Assess
   whether the cited source is relevant to the claim instead. Do not claim that a source proves a fact
   merely because its URL exists.
4. Mark a section covered only when the report performs actual analysis, not when it merely uses the heading.
5. Extract weights as percentage points (for example, 40 for 40%). Extract upside/downside in percentage
   points. Extract all per-share values in the stated quote currency.
6. A critical issue makes the target unusable. A major issue materially lowers confidence but may be
   repairable. A minor issue does not change the investment conclusion.

Frozen identity snapshot:
{json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2)}

Retained source index:
{json.dumps(source_index, ensure_ascii=False, indent=2)}

Report to audit:
--- BEGIN REPORT ---
{report}
--- END REPORT ---
""".strip()


def run_semantic_audit(
    *,
    client: Any,
    snapshot: CompanySnapshot,
    report: str,
    sources: Sequence[Mapping[str, Any]],
    model: str,
    reasoning_effort: str,
) -> dict[str, Any]:
    response = client.responses.create(
        model=model,
        reasoning={"effort": reasoning_effort},
        instructions=(
            "Return only the structured audit requested by the JSON schema. Be adversarial, "
            "precise, and conservative. Never repair or embellish the source report."
        ),
        input=build_audit_prompt(snapshot, report, sources),
        text={
            "format": {
                "type": "json_schema",
                "name": "equity_research_audit",
                "strict": True,
                "schema": valuation_audit_schema(),
            }
        },
    )
    raw = str(getattr(response, "output_text", "") or "").strip()
    if not raw:
        raise RuntimeError("Semantic audit returned no structured output")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("Semantic audit output is not a JSON object")
    payload["audit_model"] = str(getattr(response, "model", "") or model)
    payload["audit_usage"] = (
        response.usage.model_dump(mode="json")
        if getattr(response, "usage", None) is not None
        and hasattr(response.usage, "model_dump")
        else None
    )
    return payload


@dataclass(frozen=True)
class ArithmeticCheck:
    usable_target: bool
    configured_target_price: Optional[float]
    recomputed_target_price: Optional[float]
    configured_upside_downside_pct: Optional[float]
    recomputed_upside_downside_pct: Optional[float]
    effective_weight_pct: float
    issues: tuple[dict[str, str], ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def validate_audit_arithmetic(
    payload: Mapping[str, Any],
    snapshot: CompanySnapshot,
    *,
    price_tolerance_pct: float = 0.5,
) -> ArithmeticCheck:
    valuation = payload.get("valuation")
    valuation = valuation if isinstance(valuation, Mapping) else {}
    methods = valuation.get("methods")
    methods = methods if isinstance(methods, list) else []
    issues: list[dict[str, str]] = []
    weighted_sum = 0.0
    effective_weight = 0.0
    for method in methods:
        if not isinstance(method, Mapping) or not method.get("used_in_final"):
            continue
        value = _number(method.get("value_per_share"))
        weight = _number(method.get("weight_pct"))
        if value is None or weight is None or weight <= 0:
            issues.append(
                {
                    "severity": "critical",
                    "category": "arithmetic",
                    "description": "A used valuation method lacks a valid value or positive weight.",
                }
            )
            continue
        weighted_sum += value * weight / 100.0
        effective_weight += weight

    recomputed_target = weighted_sum if effective_weight > 0 else None
    configured_target = _number(valuation.get("target_price"))
    configured_upside = _number(valuation.get("upside_downside_pct"))
    reference_price = _number(valuation.get("reference_price")) or snapshot.current_price
    recomputed_upside = (
        ((recomputed_target / reference_price) - 1.0) * 100.0
        if recomputed_target is not None and reference_price
        else None
    )

    if abs(effective_weight - 100.0) > 0.5:
        issues.append(
            {
                "severity": "critical",
                "category": "arithmetic",
                "description": f"Used method weights total {effective_weight:.4g}%, not 100%.",
            }
        )
    if configured_target is None:
        issues.append(
            {
                "severity": "critical",
                "category": "arithmetic",
                "description": "No final target price could be extracted.",
            }
        )
    elif recomputed_target is not None:
        difference_pct = abs(configured_target - recomputed_target) / max(
            abs(configured_target), 1e-9
        ) * 100.0
        if difference_pct > price_tolerance_pct:
            issues.append(
                {
                    "severity": "critical",
                    "category": "arithmetic",
                    "description": (
                        f"Claimed target {configured_target:.6g} does not reconcile to the "
                        f"method-weighted target {recomputed_target:.6g} ({difference_pct:.3g}% difference)."
                    ),
                }
            )
    if configured_upside is not None and recomputed_upside is not None:
        if abs(configured_upside - recomputed_upside) > price_tolerance_pct:
            issues.append(
                {
                    "severity": "critical",
                    "category": "arithmetic",
                    "description": (
                        f"Claimed upside/downside {configured_upside:.6g}% does not reconcile "
                        f"to {recomputed_upside:.6g}%."
                    ),
                }
            )
    currency = str(valuation.get("currency") or "").upper()
    if snapshot.quote_currency and currency and currency != snapshot.quote_currency.upper():
        issues.append(
            {
                "severity": "critical",
                "category": "currency",
                "description": (
                    f"Valuation currency {currency} differs from quote currency "
                    f"{snapshot.quote_currency}."
                ),
            }
        )
    if _number(valuation.get("diluted_shares_used")) is None:
        issues.append(
            {
                "severity": "major",
                "category": "share_count",
                "description": "No explicit positive diluted share count was extracted.",
            }
        )

    semantic_issues = payload.get("issues")
    if isinstance(semantic_issues, list):
        blocking_semantic = any(
            isinstance(issue, Mapping)
            and issue.get("severity") in {"critical", "major"}
            for issue in semantic_issues
        )
    else:
        blocking_semantic = False
    usable = not blocking_semantic and not any(
        issue["severity"] == "critical" for issue in issues
    )
    return ArithmeticCheck(
        usable_target=usable,
        configured_target_price=configured_target,
        recomputed_target_price=recomputed_target,
        configured_upside_downside_pct=configured_upside,
        recomputed_upside_downside_pct=recomputed_upside,
        effective_weight_pct=effective_weight,
        issues=tuple(issues),
    )


def audit_run_directory(
    *,
    client: Any,
    run_dir: Path,
    snapshot: CompanySnapshot,
    model: str,
    reasoning_effort: str,
    report_filename: str = "research_report.md",
    sources_filename: str = "research_sources.json",
    output_filename: str = "research_audit.json",
) -> dict[str, Any]:
    run_path = Path(run_dir)
    report = (run_path / report_filename).read_text(encoding="utf-8")
    source_payload = json.loads(
        (run_path / sources_filename).read_text(encoding="utf-8")
    )
    sources = source_payload.get("sources") if isinstance(source_payload, Mapping) else []
    audit = run_semantic_audit(
        client=client,
        snapshot=snapshot,
        report=report,
        sources=sources or [],
        model=model,
        reasoning_effort=reasoning_effort,
    )
    arithmetic = validate_audit_arithmetic(audit, snapshot)
    audit["deterministic_arithmetic"] = arithmetic.to_dict()
    (run_path / output_filename).write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return audit
