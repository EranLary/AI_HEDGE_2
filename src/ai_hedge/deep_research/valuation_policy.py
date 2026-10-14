from __future__ import annotations

import re
from datetime import date
from typing import Any, Mapping


POLICY_VERSION = "valuation-method-policy-v2"
ANCHOR_PACKET_VERSION = "valuation-anchor-packet-v1"
COHERENCE_AUDIT_VERSION = "valuation-coherence-audit-v1"

_FINANCIAL_SIGNALS = (
    "financial",
    "bank",
    "broker",
    "insurance",
    "capital markets",
    "asset management",
    "credit services",
    "mortgage",
    "reit",
    "real estate",
)

_ANCHOR_PATTERNS: dict[str, tuple[str, ...]] = {
    "diluted_shares": (
        "diluted share",
        "share count",
        "shares outstanding",
        "weighted average share",
    ),
    "gaap_net_income": ("gaap net income", "net income"),
    "gaap_eps": ("gaap diluted eps", "diluted eps", "earnings per share"),
    "stock_compensation": ("stock-based compensation", "share-based compensation", "sbc"),
    "depreciation_amortization": ("depreciation", "amortization"),
    "capital_expenditure": (
        "capital expenditure",
        "capex",
        "capitalized software",
        "capitalized development",
    ),
    "working_capital": (
        "working capital",
        "receivable",
        "deferred revenue",
        "contract asset",
    ),
    "tax": ("tax expense", "tax rate", "effective tax", "income tax"),
    "operating_cash_flow": ("operating cash flow", "cash from operations"),
    "free_cash_flow": ("free cash flow", "fcf"),
    "revenue_guidance": ("revenue guidance", "guidance"),
}


def _rows(evidence: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [
        row
        for row in evidence.get("evidence") or []
        if isinstance(row, Mapping)
    ]


def _row_text(row: Mapping[str, Any]) -> str:
    return " ".join(
        str(row.get(key) or "")
        for key in ("claim", "unit", "period_or_date", "scope", "limitation")
    ).casefold()


def _positive_reported_profit_rows(
    evidence: Mapping[str, Any],
) -> list[Mapping[str, Any]]:
    matches: list[Mapping[str, Any]] = []
    for row in _rows(evidence):
        text = _row_text(row)
        if "non-gaap" in text or "non gaap" in text:
            continue
        if not any(
            signal in text
            for signal in ("gaap net income", "gaap operating income", "net income")
        ):
            continue
        if str(row.get("fact_type") or "").casefold() != "reported_fact":
            continue
        try:
            value = float(row.get("value"))
        except (TypeError, ValueError):
            continue
        if value > 0:
            matches.append(row)
    return matches


def build_valuation_method_policy(
    *, input_packet: Mapping[str, Any], evidence: Mapping[str, Any]
) -> dict[str, Any]:
    profile = input_packet.get("company_profile")
    profile = profile if isinstance(profile, Mapping) else {}
    sector = str(profile.get("sector") or "").strip()
    industry = str(profile.get("industry") or "").strip()
    classification_text = f"{sector} {industry}".casefold()
    financial = any(signal in classification_text for signal in _FINANCIAL_SIGNALS)
    profit_rows = _positive_reported_profit_rows(evidence)
    locked = bool(profit_rows and not financial)
    return {
        "version": POLICY_VERSION,
        "classification": (
            "profitable_non_financial" if locked else "flexible_special_case"
        ),
        "locked": locked,
        "classification_inputs": {
            "sector": sector,
            "industry": industry,
            "financial_signal_detected": financial,
            "positive_reported_profit_claim_ids": [
                str(row.get("claim_id") or "") for row in profit_rows
            ],
        },
        "central_methods": (
            [
                {
                    "family": "intrinsic_cash_flow",
                    "allowed_types": ["dcf", "fcfe"],
                    "weight_pct": 50.0,
                },
                {
                    "family": "normalized_earnings_multiple",
                    "allowed_types": ["multiple"],
                    "weight_pct": 50.0,
                    "subject_metric_basis": "forward",
                    "peer_metric_basis": "forward",
                },
            ]
            if locked
            else []
        ),
        "earnings_policy": {
            "central_basis": "independently_normalized_forward_earnings",
            "start_from": "reported_GAAP",
            "stock_compensation": "expense",
            "management_non_gaap": "sensitivity_only",
            "required_adjustment_review": [
                "stock compensation",
                "acquired-intangible amortization",
                "acquisition costs",
                "capitalized development",
                "unusual taxes",
                "other material one-offs",
            ],
        },
        "repair_policy": {
            "may_change": ["format", "units", "dates", "evidence links", "arithmetic"],
            "may_not_change": [
                "method family",
                "method weight",
                "earnings basis",
                "normalization policy",
            ],
        },
    }


def build_canonical_valuation_anchors(evidence: Mapping[str, Any]) -> dict[str, Any]:
    rows = _rows(evidence)
    anchors: dict[str, Any] = {}
    for name, patterns in _ANCHOR_PATTERNS.items():
        matches: list[dict[str, Any]] = []
        for row in rows:
            text = _row_text(row)
            if not any(pattern in text for pattern in patterns):
                continue
            if name in {"gaap_net_income", "gaap_eps"} and (
                "non-gaap" in text or "non gaap" in text
            ):
                continue
            candidate = dict(row)
            if name == "diluted_shares":
                try:
                    value = float(row.get("value"))
                except (TypeError, ValueError):
                    value = 0.0
                unit = str(row.get("unit") or "").casefold()
                factor = 1.0
                if "million" in unit:
                    factor = 1_000_000.0
                elif "thousand" in unit or "000" in unit:
                    factor = 1_000.0
                if value > 0:
                    candidate["canonical_absolute_shares"] = value * factor
            matches.append(candidate)
        anchors[name] = {
            "status": "available" if matches else "missing",
            "candidates": matches[:8],
        }
    return {
        "version": ANCHOR_PACKET_VERSION,
        "anchors": anchors,
        "cash_flow_construction_policy": {
            "preferred": "reported or independently reconstructed FCFE/FCF",
            "required_bridge_when_starting_from_net_income": [
                "non-cash depreciation and amortization",
                "stock compensation treatment",
                "capital expenditure",
                "working-capital investment",
                "cash taxes and other material cash items",
            ],
            "management_non_gaap_or_undefined_fcf": "cross_check_only",
        },
    }


def _positive_methods(case: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    methods: list[Mapping[str, Any]] = []
    for method in case.get("methods") or []:
        if not isinstance(method, Mapping):
            continue
        try:
            weight = float(method.get("weight_pct") or 0)
        except (TypeError, ValueError):
            continue
        if weight > 0:
            methods.append(method)
    return methods


def valuation_case_integrity_issues(case: Mapping[str, Any]) -> list[str]:
    """Validate unit and calendar contracts that apply to every company class."""

    issues: list[str] = []
    methods = _positive_methods(case)
    evidence_by_id = {
        str(row.get("id") or ""): row
        for row in case.get("evidence") or []
        if isinstance(row, Mapping)
    }
    for method in methods:
        method_type = str(method.get("type") or "")
        if method_type == "multiple":
            subject = evidence_by_id.get(
                str(method.get("subject_metric_evidence_id") or "")
            )
            subject_unit = str((subject or {}).get("unit") or "").casefold()
            if not any(
                marker in subject_unit
                for marker in ("per share", "/share", "eps", "earnings/share")
            ):
                issues.append(
                    "normalized-earnings multiple subject metric must be an explicit per-share value "
                    "(for example USD per share or EPS); absolute net income in thousands, millions, "
                    "or billions must first be divided by diluted shares"
                )
        if method_type not in {"dcf", "fcfe"}:
            continue
        flows = [
            flow
            for flow in method.get("cash_flows_per_share") or []
            if isinstance(flow, Mapping)
        ]
        try:
            value_date = date.fromisoformat(str(method.get("value_date") or "")[:10])
        except ValueError:
            value_date = None
        if not value_date or not flows:
            continue
        try:
            first_date = date.fromisoformat(str(flows[0].get("date") or "")[:10])
        except ValueError:
            first_date = None
        if not first_date:
            continue
        first_days = (first_date - value_date).days
        if first_days > 370:
            issues.append(
                "DCF/FCFE first cash flow occurs more than one year after value_date; "
                "include the post-value-date stub period instead of silently omitting it"
            )
        if not 0 < first_days < 300:
            continue
        first_rationale = str(flows[0].get("rationale") or "").casefold()
        if not any(
            marker in first_rationale
            for marker in ("stub", "prorat", "partial", "remaining", "fraction")
        ):
            issues.append(
                "DCF/FCFE first short-period cash flow must be explicitly identified "
                "and prorated as a post-value-date stub"
            )
        if len(flows) > 1:
            try:
                first_amount = abs(float(flows[0].get("amount") or 0))
                next_amount = abs(float(flows[1].get("amount") or 0))
            except (TypeError, ValueError):
                first_amount = next_amount = 0.0
            expected_stub = next_amount * first_days / 365.25
            if expected_stub > 0 and not 0.5 <= first_amount / expected_stub <= 1.75:
                issues.append(
                    "DCF/FCFE first stub amount does not reconcile to the elapsed-day "
                    "fraction of the following full-year cash flow; rebuild the stub from "
                    "actual calendar days"
                )
    return list(dict.fromkeys(issues))


def valuation_method_policy_issues(
    policy: Mapping[str, Any], case: Mapping[str, Any]
) -> list[str]:
    issues = valuation_case_integrity_issues(case)
    if not policy.get("locked"):
        return issues
    methods = _positive_methods(case)
    intrinsic = [
        method for method in methods if str(method.get("type") or "") in {"dcf", "fcfe"}
    ]
    multiples = [
        method for method in methods if str(method.get("type") or "") == "multiple"
    ]
    unsupported = [
        str(method.get("type") or "<empty>")
        for method in methods
        if str(method.get("type") or "") not in {"dcf", "fcfe", "multiple"}
    ]
    if len(methods) != 2 or len(intrinsic) != 1 or len(multiples) != 1 or unsupported:
        issues.append(
            "profitable non-financial central valuation must contain exactly one DCF/FCFE and "
            "one normalized-earnings multiple; residual-income, asset, and extra methods are "
            "sensitivity-only"
        )
    for label, selected in (("intrinsic DCF/FCFE", intrinsic), ("earnings multiple", multiples)):
        if not selected:
            continue
        try:
            weight = float(selected[0].get("weight_pct") or 0)
        except (TypeError, ValueError):
            weight = 0.0
        if abs(weight - 50.0) > 1e-6:
            issues.append(f"{label} must have exactly 50% central weight")
    if multiples:
        multiple = multiples[0]
        if str(multiple.get("subject_metric_basis") or "").casefold() != "forward":
            issues.append("normalized-earnings multiple subject metric must use a forward basis")
        if str(multiple.get("peer_metric_basis") or "").casefold() != "forward":
            issues.append("normalized-earnings multiple representative multiple must use a forward basis")
        evidence_by_id = {
            str(row.get("id") or ""): row
            for row in case.get("evidence") or []
            if isinstance(row, Mapping)
        }
        subject = evidence_by_id.get(
            str(multiple.get("subject_metric_evidence_id") or "")
        )
        subject_text = " ".join(
            str((subject or {}).get(key) or "")
            for key in ("unit", "rationale")
        ).casefold()
        if "non-gaap" in subject_text or "non gaap" in subject_text:
            issues.append(
                "central normalized earnings must be independently reconciled from GAAP; "
                "management non-GAAP earnings may appear only as a sensitivity"
            )
    for method in intrinsic:
        rationales = " ".join(
            str(flow.get("rationale") or "")
            for flow in method.get("cash_flows_per_share") or []
            if isinstance(flow, Mapping)
        ).casefold()
        if "non-gaap" in rationales or "non gaap" in rationales:
            issues.append(
                "central DCF/FCFE cash flows cannot use management non-GAAP earnings as cash flow"
            )
        if "net income" in rationales and "capex" in rationales:
            has_non_cash = any(
                term in rationales
                for term in ("depreciation", "amortization", "d&a", "non-cash")
            )
            has_working_capital = "working capital" in rationales
            if not has_non_cash or not has_working_capital:
                issues.append(
                    "FCFE built from net income and capex must also bridge non-cash charges and "
                    "working-capital investment"
                )
    return list(dict.fromkeys(issues))


def build_valuation_coherence_audit(
    case: Mapping[str, Any], compiled: Mapping[str, Any]
) -> dict[str, Any]:
    """Create a deterministic economic fingerprint and block obvious scale failures."""

    methods = [
        method
        for method in compiled.get("methods") or []
        if isinstance(method, Mapping)
    ]
    values: list[float] = []
    for method in methods:
        try:
            value = float(method.get("value_per_share") or 0)
        except (TypeError, ValueError):
            continue
        if value > 0:
            values.append(value)
    try:
        target = float(compiled.get("target_price") or 0)
        reference = float(compiled.get("reference_price") or 0)
    except (TypeError, ValueError):
        target = reference = 0.0

    method_ratio = max(values) / min(values) if len(values) >= 2 and min(values) else None
    target_ratio = target / reference if target > 0 and reference > 0 else None
    blocking: list[str] = []
    warnings: list[str] = []
    if method_ratio is not None:
        if method_ratio > 2.0:
            blocking.append(
                f"central valuation methods differ by {method_ratio:.2f}x; recheck units, timing, "
                "share denominator, and forecast basis before publishing"
            )
        elif method_ratio > 1.5:
            warnings.append(
                f"central valuation methods differ by {method_ratio:.2f}x and require explicit reconciliation"
            )
    if target_ratio is not None:
        if target_ratio > 5.0 or target_ratio < 0.10:
            blocking.append(
                f"compiled target is {target_ratio:.2f}x the frozen reference price; this is outside the "
                "broad scale sanity band and requires an explicit unit and assumption rebuild"
            )
        elif target_ratio > 3.0 or target_ratio < 0.25:
            warnings.append(
                f"compiled target is {target_ratio:.2f}x the frozen reference price and requires "
                "explicit reconciliation, but is not blocked solely for that reason"
            )

    evidence = {
        str(row.get("id") or ""): row
        for row in case.get("evidence") or []
        if isinstance(row, Mapping)
    }
    fingerprint: dict[str, Any] = {
        "reference_price": reference,
        "target_price": target,
        "target_to_reference_ratio": target_ratio,
        "method_value_ratio": method_ratio,
        "diluted_shares": case.get("diluted_shares"),
        "methods": [],
    }
    for method in case.get("methods") or []:
        if not isinstance(method, Mapping):
            continue
        item: dict[str, Any] = {
            "name": method.get("name"),
            "type": method.get("type"),
            "weight_pct": method.get("weight_pct"),
        }
        if str(method.get("type") or "") in {"dcf", "fcfe"}:
            flows = method.get("cash_flows_per_share") or []
            item.update(
                {
                    "first_cash_flow_date": flows[0].get("date") if flows else None,
                    "first_cash_flow_amount": flows[0].get("amount") if flows else None,
                    "discount_rate": (
                        evidence.get(
                            str(method.get("discount_rate_evidence_id") or "")
                        )
                        or {}
                    ).get("value"),
                    "terminal_growth": (
                        evidence.get(
                            str(method.get("terminal_growth_evidence_id") or "")
                        )
                        or {}
                    ).get("value"),
                }
            )
        elif str(method.get("type") or "") == "multiple":
            subject = evidence.get(str(method.get("subject_metric_evidence_id") or "")) or {}
            item.update(
                {
                    "subject_metric": subject.get("value"),
                    "subject_metric_unit": subject.get("unit"),
                    "applied_multiple": method.get("applied_multiple"),
                }
            )
        fingerprint["methods"].append(item)

    return {
        "version": COHERENCE_AUDIT_VERSION,
        "passed": not blocking,
        "blocking_issues": blocking,
        "warnings": warnings,
        "fingerprint": fingerprint,
    }


def repair_method_policy_issues(
    policy: Mapping[str, Any],
    prior_case: Mapping[str, Any],
    candidate: Mapping[str, Any],
) -> list[str]:
    """Prevent a repair from changing a valid economic blueprint.

    An invalid initial blueprint may be brought into the deterministic policy.
    Once the prior candidate already conforms, subsequent repairs are local only.
    """

    if not policy.get("locked"):
        return []
    prior_methods = _positive_methods(prior_case)
    prior_intrinsic_methods = [
        method
        for method in prior_methods
        if str(method.get("type") or "") in {"dcf", "fcfe"}
    ]
    prior_multiple_methods = [
        method
        for method in prior_methods
        if str(method.get("type") or "") == "multiple"
    ]
    structurally_locked = (
        len(prior_methods) == 2
        and len(prior_intrinsic_methods) == 1
        and len(prior_multiple_methods) == 1
        and all(
            abs(float(method.get("weight_pct") or 0) - 50.0) <= 1e-6
            for method in prior_methods
        )
        and str(
            prior_multiple_methods[0].get("subject_metric_basis") or ""
        ).casefold()
        == "forward"
        and str(
            prior_multiple_methods[0].get("peer_metric_basis") or ""
        ).casefold()
        == "forward"
    )
    if not structurally_locked:
        return []
    issues: list[str] = []
    candidate_methods = _positive_methods(candidate)
    prior_intrinsic = prior_intrinsic_methods[0]
    candidate_intrinsic = next(
        (
            method
            for method in candidate_methods
            if str(method.get("type") or "") in {"dcf", "fcfe"}
        ),
        None,
    )
    if prior_intrinsic and candidate_intrinsic and (
        str(prior_intrinsic.get("type") or "")
        != str(candidate_intrinsic.get("type") or "")
    ):
        issues.append("repair cannot switch the intrinsic method between DCF and FCFE")
    prior_multiple = prior_multiple_methods[0]
    candidate_multiple = next(
        (
            method
            for method in candidate_methods
            if str(method.get("type") or "") == "multiple"
        ),
        None,
    )
    if prior_multiple and candidate_multiple:
        for field in ("subject_metric_basis", "peer_metric_basis"):
            if str(prior_multiple.get(field) or "") != str(
                candidate_multiple.get(field) or ""
            ):
                issues.append(f"repair cannot change the normalized-earnings {field}")
    return issues


def share_scale_from_text(value: Any, unit: Any, rationale: Any) -> float:
    """Infer only an explicit share scale; never infer an economic value."""

    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 1.0
    if not 0 < parsed < 1_000_000:
        return 1.0
    text = f"{unit} {rationale}".casefold()
    if "million" in text or re.search(r"\b\d+(?:\.\d+)?\s*m(?:n)?\b", text):
        return 1_000_000.0
    if "thousand" in text or "000 shares" in text:
        return 1_000.0
    return 1.0
