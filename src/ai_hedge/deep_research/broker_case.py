from __future__ import annotations

import json
from typing import Any, Mapping, Sequence

from .snapshot import CompanySnapshot


BROKER_CASE_VERSION = "broker-valuation-case-v3"


def _nullable_string() -> dict[str, Any]:
    return {"type": ["string", "null"]}


def _evidence_schema() -> dict[str, Any]:
    return {
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
            "source_url": _nullable_string(),
            "rationale": _nullable_string(),
        },
    }


def _forecast_period_schema() -> dict[str, Any]:
    fields = [
        "margin_loans_evidence_id",
        "margin_net_yield_evidence_id",
        "segregated_cash_securities_balance_evidence_id",
        "segregated_cash_securities_yield_evidence_id",
        "client_credit_ex_sweep_balances_evidence_id",
        "client_credit_cost_yield_evidence_id",
        "securities_lending_income_evidence_id",
        "fdic_sweep_income_evidence_id",
        "other_nii_evidence_id",
        "average_daily_revenue_trades_evidence_id",
        "trading_days_evidence_id",
        "commission_per_dart_evidence_id",
        "other_revenue_evidence_id",
        "non_interest_expense_evidence_id",
        "tax_rate_evidence_id",
        "public_economic_share_evidence_id",
        "other_parent_income_evidence_id",
        "dividends_evidence_id",
        "other_equity_flows_evidence_id",
    ]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["start_date", "end_date", "rationale", "evidence_ids", *fields],
        "properties": {
            "start_date": {"type": "string"},
            "end_date": {"type": "string"},
            "rationale": {"type": "string"},
            "evidence_ids": {"type": "array", "items": {"type": "string"}},
            **{field: {"type": "string"} for field in fields},
        },
    }


def broker_valuation_case_schema() -> dict[str, Any]:
    nullable_string = _nullable_string()
    intrinsic_fields = [
        "weight_pct",
        "weight_rationale",
        "reported_parent_book_equity_evidence_id",
        "reported_book_date",
        "interim_dividends_evidence_id",
        "discount_rate_evidence_id",
        "cost_of_equity_evidence_id",
        "discount_rate_formula",
        "discount_rate_rationale",
        "risk_free_evidence_id",
        "beta_evidence_id",
        "equity_risk_premium_evidence_id",
        "additional_premium_evidence_id",
        "terminal_growth_evidence_id",
        "terminal_roe_evidence_id",
        "terminal_roe_bridge_rationale",
        "terminal_capital_policy_rationale",
        "forecast_periods",
    ]
    intrinsic = {
        "type": "object",
        "additionalProperties": False,
        "required": intrinsic_fields,
        "properties": {
            "weight_pct": {"type": "number"},
            "weight_rationale": {"type": "string"},
            "reported_parent_book_equity_evidence_id": {"type": "string"},
            "reported_book_date": {"type": "string"},
            "interim_dividends_evidence_id": {"type": "string"},
            "discount_rate_evidence_id": {"type": "string"},
            "cost_of_equity_evidence_id": {"type": "string"},
            "discount_rate_formula": {
                "type": "string",
                "enum": ["capm", "build_up"],
            },
            "discount_rate_rationale": nullable_string,
            "risk_free_evidence_id": nullable_string,
            "beta_evidence_id": nullable_string,
            "equity_risk_premium_evidence_id": nullable_string,
            "additional_premium_evidence_id": nullable_string,
            "terminal_growth_evidence_id": {"type": "string"},
            "terminal_roe_evidence_id": {"type": "string"},
            "terminal_roe_bridge_rationale": {"type": "string"},
            "terminal_capital_policy_rationale": {"type": "string"},
            "forecast_periods": {
                "type": "array",
                "minItems": 3,
                "items": _forecast_period_schema(),
            },
        },
    }
    peer = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "ticker",
            "price_evidence_id",
            "eps_evidence_id",
            "eps_period_end",
            "eps_basis",
            "comparability_rationale",
        ],
        "properties": {
            "ticker": {"type": "string"},
            "price_evidence_id": {"type": "string"},
            "eps_evidence_id": {"type": "string"},
            "eps_period_end": {"type": "string"},
            "eps_basis": {
                "type": "string",
                "enum": ["ttm_gaap", "forward_fiscal_gaap"],
            },
            "comparability_rationale": {"type": "string"},
        },
    }
    comparable = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "weight_pct",
            "weight_rationale",
            "subject_eps_evidence_id",
            "subject_eps_period_end",
            "subject_eps_basis",
            "premium_discount_evidence_id",
            "peers",
        ],
        "properties": {
            "weight_pct": {"type": "number"},
            "weight_rationale": {"type": "string"},
            "subject_eps_evidence_id": {"type": "string"},
            "subject_eps_period_end": {"type": "string"},
            "subject_eps_basis": {
                "type": "string",
                "enum": ["ttm_gaap", "forward_fiscal_gaap"],
            },
            "premium_discount_evidence_id": {"type": "string"},
            "peers": {"type": "array", "minItems": 5, "items": peer},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "case_version",
            "currency",
            "valuation_date",
            "reference_price",
            "reference_price_evidence_id",
            "basic_shares",
            "basic_shares_evidence_id",
            "incremental_dilution",
            "incremental_dilution_evidence_id",
            "diluted_shares",
            "diluted_shares_evidence_id",
            "dilution_method",
            "dilution_rationale",
            "evidence",
            "intrinsic_method",
            "comparable_method",
        ],
        "properties": {
            "case_version": {"type": "string"},
            "currency": {"type": "string"},
            "valuation_date": {"type": "string"},
            "reference_price": {"type": "number"},
            "reference_price_evidence_id": {"type": "string"},
            "basic_shares": {"type": "number"},
            "basic_shares_evidence_id": {"type": "string"},
            "incremental_dilution": {"type": "number"},
            "incremental_dilution_evidence_id": {"type": "string"},
            "diluted_shares": {"type": "number"},
            "diluted_shares_evidence_id": {"type": "string"},
            "dilution_method": {
                "type": "string",
                "enum": ["treasury_stock", "if_converted", "none"],
            },
            "dilution_rationale": {"type": "string"},
            "evidence": {"type": "array", "items": _evidence_schema()},
            "intrinsic_method": intrinsic,
            "comparable_method": comparable,
        },
    }


def build_broker_research_prompt(
    *,
    snapshot: CompanySnapshot,
    report: str,
    narrative_audit: Mapping[str, Any],
    prior_case: Mapping[str, Any] | None = None,
    prior_case_audit: Mapping[str, Any] | None = None,
) -> str:
    narrative_blockers = [
        issue
        for issue in narrative_audit.get("issues") or []
        if isinstance(issue, Mapping) and issue.get("severity") in {"critical", "major"}
    ]
    case_blockers = [
        issue
        for issue in (prior_case_audit or {}).get("issues") or []
        if isinstance(issue, Mapping) and issue.get("severity") in {"critical", "major"}
    ]
    return f"""
Build a publication-grade, machine-compilable CURRENT FAIR VALUE case for
{snapshot.company_name} ({snapshot.ticker}), using the strict broker schema.
Research every material input independently on the live web. The narrative report is context, not
authority. Return JSON only. Never search for AI_HEDGE outputs or benchmark reports.

Non-negotiable valuation contract:
1. valuation_date is the frozen observation date. Both methods calculate value on that same date. Do not
   mix a current residual-income value with a 12-month multiple target.
2. Use parent common equity attributable to the listed public security. Explicitly resolve Up-C,
   noncontrolling-interest, exchangeable-unit, DTA and TRA scope where relevant.
3. Start residual income on the latest REPORTED parent book date; do not estimate an unreported book value
   at valuation_date. Forecast from reported_book_date, then carry the resulting intrinsic value forward to
   valuation_date at cost of equity and subtract only dividends actually paid in the interim.
4. Build diluted shares explicitly as point-in-time basic Class A shares plus incremental dilution. Source
   both components, identify the treasury-stock/if-converted method, and explain awards, exchangeable units,
   treasury shares and why current public ownership is aligned with the denominator. Never substitute a
   quarterly weighted-average EPS denominator for point-in-time dilution.
5. Use one disclosed scale for all monetary totals and the corresponding share-count scale. For example,
   USD millions must pair with millions of shares. Never combine USD with millions of shares.
6. Forecast at least three explicit non-overlapping periods. The first start_date equals reported_book_date and
   every later start_date equals the prior end_date. Balance yields are annualized, while revenue, expense,
   dividend and equity-flow evidence contains only the exact period flow.
7. Build NII separately from margin loans and yield, segregated cash/securities and yield, customer-credit
   balances EXCLUDING off-balance-sheet sweeps and their cost yield, securities-lending income, FDIC sweep
   income, and residual other NII. Never apply a credit cost to sweep balances and also add sweep income. Build
   commissions from average daily revenue trades x trading days in the exact period x commission per DART.
   Do not use a free-standing net-income CAGR or an annual flow for a stub period.
8. Each forecast driver is either a dated third-party estimate/reported fact with the exact supporting URL,
   or an analyst assumption with a company-specific rationale. Cite the historical base behind assumptions.
9. Reconcile cost of equity through CAPM inputs or give a complete build-up rationale. Terminal growth must
   be below cost of equity. Explain any terminal ROE jump and quantitatively bridge explicit dividends,
   retention and equity flows to the terminal payout implied by terminal growth divided by terminal ROE.
10. Hold the public economic share constant across the forecast when valuing today's share count. Do not
   treat Up-C unit exchanges as free accretion. A future version may model exchanges only together with the
   exact Class A issuance/consideration and per-period diluted-share bridge.
11. Comparable value requires at least five economically comparable brokers. For every peer, source the
   exact price and EPS separately. Peer and subject EPS must have the exact same period end and accounting
   basis: TTM GAAP or the same forward GAAP fiscal year. Annualizing one quarter is forbidden. Do not use a
   vendor's opaque forward-P/E field.
12. Preserve timestamped or historical market-data URLs/records for every price. A live quote landing page
   that cannot reproduce the frozen observation is not valid price evidence.
13. Put any business-quality premium or discount in one explicit evidence item and rationale. Do not double
   count it in peer selection, EPS, and weights.
14. Method weights total 100% and reflect evidence quality and method independence. Do not steer weights to
    a desired target. Every non-assumption evidence item needs an exact URL and date.

Frozen snapshot:
{json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2)}

Narrative audit blockers:
{json.dumps(narrative_blockers, ensure_ascii=False, indent=2)}

Prior rejected broker case, for correction only:
{json.dumps(prior_case or {}, ensure_ascii=False, indent=2)}

Prior economic-audit blockers:
{json.dumps(case_blockers, ensure_ascii=False, indent=2)}

Narrative research context:
--- BEGIN RESEARCH ---
{report}
--- END RESEARCH ---
""".strip()
