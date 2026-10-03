from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from .compiler import ValuationCompilationError, compile_valuation_case
from .snapshot import CompanySnapshot


CASE_VERSION = "valuation-case-v1"


def valuation_case_schema() -> dict[str, Any]:
    nullable_string = {"type": ["string", "null"]}
    evidence_item = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "id",
            "kind",
            "value",
            "unit",
            "as_of_date",
            "source_url",
            "rationale",
        ],
        "properties": {
            "id": {"type": "string"},
            "kind": {
                "type": "string",
                "enum": [
                    "reported_fact",
                    "market_observation",
                    "third_party_estimate",
                    "analyst_assumption",
                ],
            },
            "value": {"type": "number"},
            "unit": {"type": "string"},
            "as_of_date": {"type": "string"},
            "source_url": nullable_string,
            "rationale": nullable_string,
        },
    }
    cash_flow_item = {
        "type": "object",
        "additionalProperties": False,
        "required": ["date", "amount", "rationale", "evidence_ids"],
        "properties": {
            "date": {"type": "string"},
            "amount": {"type": "number"},
            "rationale": {"type": "string"},
            "evidence_ids": {"type": "array", "items": {"type": "string"}},
        },
    }
    residual_period = {
        "type": "object",
        "additionalProperties": False,
        "required": ["end_date", "net_income", "dividends", "rationale", "evidence_ids"],
        "properties": {
            "end_date": {"type": "string"},
            "net_income": {"type": "number"},
            "dividends": {"type": "number"},
            "rationale": {"type": "string"},
            "evidence_ids": {"type": "array", "items": {"type": "string"}},
        },
    }
    method_item = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "name",
            "type",
            "value_date",
            "weight_pct",
            "weight_rationale",
            "evidence_ids",
            "discount_rate_evidence_id",
            "discount_rate_formula",
            "discount_rate_rationale",
            "risk_free_evidence_id",
            "beta_evidence_id",
            "equity_risk_premium_evidence_id",
            "additional_premium_evidence_id",
            "terminal_growth_evidence_id",
            "cash_flows_per_share",
            "beginning_book_equity_evidence_id",
            "cost_of_equity_evidence_id",
            "terminal_roe_evidence_id",
            "terminal_roe_bridge_rationale",
            "periods",
            "peer_metric_basis",
            "subject_metric_basis",
            "subject_metric_evidence_id",
            "peer_statistic_evidence_id",
            "peer_multiple_evidence_ids",
            "premium_discount_evidence_id",
            "applied_multiple",
            "going_concern_value",
            "asset_value_per_share_evidence_id",
            "adjustment_evidence_id",
        ],
        "properties": {
            "name": {"type": "string"},
            "type": {
                "type": "string",
                "enum": ["dcf", "fcfe", "residual_income", "multiple", "asset"],
            },
            "value_date": {"type": "string"},
            "weight_pct": {"type": "number"},
            "weight_rationale": {"type": "string"},
            "evidence_ids": {"type": "array", "items": {"type": "string"}},
            "discount_rate_evidence_id": nullable_string,
            "discount_rate_formula": {
                "type": ["string", "null"],
                "enum": ["capm", "build_up", None],
            },
            "discount_rate_rationale": nullable_string,
            "risk_free_evidence_id": nullable_string,
            "beta_evidence_id": nullable_string,
            "equity_risk_premium_evidence_id": nullable_string,
            "additional_premium_evidence_id": nullable_string,
            "terminal_growth_evidence_id": nullable_string,
            "cash_flows_per_share": {"type": "array", "items": cash_flow_item},
            "beginning_book_equity_evidence_id": nullable_string,
            "cost_of_equity_evidence_id": nullable_string,
            "terminal_roe_evidence_id": nullable_string,
            "terminal_roe_bridge_rationale": nullable_string,
            "periods": {"type": "array", "items": residual_period},
            "peer_metric_basis": {
                "type": ["string", "null"],
                "enum": ["trailing", "forward", None],
            },
            "subject_metric_basis": {
                "type": ["string", "null"],
                "enum": ["trailing", "forward", None],
            },
            "subject_metric_evidence_id": nullable_string,
            "peer_statistic_evidence_id": nullable_string,
            "peer_multiple_evidence_ids": {
                "type": "array",
                "items": {"type": "string"},
            },
            "premium_discount_evidence_id": nullable_string,
            "applied_multiple": {"type": ["number", "null"]},
            "going_concern_value": {"type": ["boolean", "null"]},
            "asset_value_per_share_evidence_id": nullable_string,
            "adjustment_evidence_id": nullable_string,
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "case_version",
            "currency",
            "reference_date",
            "reference_price",
            "reference_price_evidence_id",
            "target_date",
            "diluted_shares",
            "diluted_shares_evidence_id",
            "evidence",
            "methods",
        ],
        "properties": {
            "case_version": {"type": "string"},
            "currency": {"type": "string"},
            "reference_date": {"type": "string"},
            "reference_price": {"type": "number"},
            "reference_price_evidence_id": {"type": "string"},
            "target_date": {"type": "string"},
            "diluted_shares": {"type": "number"},
            "diluted_shares_evidence_id": {"type": "string"},
            "evidence": {"type": "array", "items": evidence_item},
            "methods": {"type": "array", "items": method_item},
        },
    }


def build_case_prompt(
    snapshot: CompanySnapshot,
    report: str,
    sources: Sequence[Mapping[str, Any]],
) -> str:
    source_index = [
        {
            "title": str(row.get("title") or ""),
            "url": str(row.get("url") or ""),
            "cited_in_report": bool(row.get("cited")),
        }
        for row in sources
    ]
    return f"""
Extract a machine-compilable valuation case from the supplied equity research report. This is an
extraction task, not a repair task. Never invent a value, date, URL, forecast, cash flow, or rationale.
Use the exact report values at their full displayed precision. If the report does not contain a required
fact, use an empty string or null where the schema permits it; the deterministic compiler must reject it.

Rules:
1. All monetary totals used by residual income must use one consistent unit; record that unit in evidence.
2. DCF/FCFE cash_flows_per_share must contain explicit forecast cash flows per share, not earnings unless
   the report explicitly defines them as distributable FCFE.
3. Every non-assumption evidence item needs the exact supporting URL. Do not substitute a generic home page.
4. Every analyst assumption needs a concise economic rationale and no fabricated source URL.
5. value_date is the date on which each method's value applies. target_date is the common date claimed by
   the report. Do not silently align differing dates.
6. For a multiple method, peer_metric_basis and subject_metric_basis are trailing or forward. The peer
   observations, premium/discount, subject metric, and applied multiple must be separately extractable.
   Put at least three same-basis, individually sourced peer multiple evidence ids in
   peer_multiple_evidence_ids; the compiler calculates the median. Do not supply a model-computed median
   in place of the underlying observations.
7. For a residual-income method, include every explicit period, beginning book equity, cost of equity,
   terminal growth, terminal ROE, and the report's bridge rationale. Do not create missing forecast rows.
8. Include only methods assigned a numeric weight in the final weighted target, including zero-weight
   methods when the report shows them.
9. For every DCF, FCFE, or residual-income method, set discount_rate_formula to capm or build_up. Under
   CAPM, extract separate evidence ids for risk-free rate, beta, equity-risk premium, and any additional
   premium. Under build_up, preserve the report's complete rationale. Never accept a bare discount rate.
10. Set reference_price_evidence_id and diluted_shares_evidence_id to evidence items that exactly reconcile
    to the top-level values. Every positive method weight needs a weight_rationale. Every DCF cash-flow row
    and residual-income period needs its own driver rationale and evidence_ids.

Frozen identity snapshot:
{json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2)}

Retained URL index:
{json.dumps(source_index, ensure_ascii=False, indent=2)}

Report:
--- BEGIN REPORT ---
{report}
--- END REPORT ---
""".strip()


def extract_valuation_case(
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
            "Return only the structured valuation case requested by the JSON schema. "
            "Be literal and conservative; never repair missing evidence."
        ),
        input=build_case_prompt(snapshot, report, sources),
        text={
            "format": {
                "type": "json_schema",
                "name": "valuation_case",
                "strict": True,
                "schema": valuation_case_schema(),
            }
        },
    )
    raw = str(getattr(response, "output_text", "") or "").strip()
    if not raw:
        raise RuntimeError("Valuation case extraction returned no output")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("Valuation case extraction is not a JSON object")
    payload["case_version"] = CASE_VERSION
    return payload


def compile_run_valuation_case(
    *,
    client: Any,
    run_dir: Path,
    snapshot: CompanySnapshot,
    model: str,
    reasoning_effort: str,
    report_filename: str = "research_report.md",
    sources_filename: str = "research_sources.json",
    case_filename: str = "valuation_case.json",
    compiled_filename: str = "valuation_compiled.json",
    errors_filename: str = "valuation_compile_errors.json",
) -> tuple[dict[str, Any], bool]:
    run_path = Path(run_dir)
    report = (run_path / report_filename).read_text(encoding="utf-8")
    source_payload = json.loads(
        (run_path / sources_filename).read_text(encoding="utf-8")
    )
    sources = source_payload.get("sources") if isinstance(source_payload, Mapping) else []
    valuation_case = extract_valuation_case(
        client=client,
        snapshot=snapshot,
        report=report,
        sources=sources or [],
        model=model,
        reasoning_effort=reasoning_effort,
    )
    (run_path / case_filename).write_text(
        json.dumps(valuation_case, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    try:
        compiled = compile_valuation_case(valuation_case)
    except ValuationCompilationError as exc:
        errors = {"valid": False, "issues": list(exc.issues)}
        (run_path / errors_filename).write_text(
            json.dumps(errors, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return errors, False
    payload = {"valid": True, "compiled": compiled.to_dict()}
    (run_path / compiled_filename).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload, True
