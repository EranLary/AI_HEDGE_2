from __future__ import annotations

import math
import statistics
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any, Mapping, Sequence


class ValuationCompilationError(ValueError):
    def __init__(self, issues: Sequence[str]) -> None:
        self.issues = tuple(issues)
        super().__init__("Valuation case is invalid: " + "; ".join(self.issues))


@dataclass(frozen=True)
class CompiledMethod:
    name: str
    method_type: str
    value_per_share: float
    weight_pct: float
    weighted_contribution: float
    value_date: str


@dataclass(frozen=True)
class CompiledValuation:
    currency: str
    reference_date: str
    reference_price: float
    target_date: str
    diluted_shares: float
    target_price: float
    upside_downside_pct: float
    methods: tuple[CompiledMethod, ...]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["methods"] = [asdict(method) for method in self.methods]
        return payload


def _number(value: Any, label: str, issues: list[str], *, positive: bool = False) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        issues.append(f"{label} must be numeric")
        return 0.0
    if not math.isfinite(result):
        issues.append(f"{label} must be finite")
        return 0.0
    if positive and result <= 0:
        issues.append(f"{label} must be positive")
    return result


def _date(value: Any, label: str, issues: list[str]) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        issues.append(f"{label} must be an ISO date")
        return date.min


def _year_fraction(start: date, end: date) -> float:
    return (end - start).days / 365.25


def _evidence_index(
    rows: Any,
    issues: list[str],
) -> dict[str, Mapping[str, Any]]:
    if not isinstance(rows, list):
        issues.append("evidence must be a list")
        return {}
    index: dict[str, Mapping[str, Any]] = {}
    valid_kinds = {"reported_fact", "market_observation", "third_party_estimate", "analyst_assumption"}
    for position, row in enumerate(rows):
        if not isinstance(row, Mapping):
            issues.append(f"evidence[{position}] must be an object")
            continue
        evidence_id = str(row.get("id") or "").strip()
        if not evidence_id:
            issues.append(f"evidence[{position}] has no id")
            continue
        if evidence_id in index:
            issues.append(f"duplicate evidence id: {evidence_id}")
            continue
        kind = str(row.get("kind") or "")
        if kind not in valid_kinds:
            issues.append(f"evidence {evidence_id} has invalid kind")
        source_url = str(row.get("source_url") or "").strip()
        rationale = str(row.get("rationale") or "").strip()
        if kind != "analyst_assumption" and not source_url.startswith(("https://", "http://")):
            issues.append(f"evidence {evidence_id} requires an exact source URL")
        if kind == "analyst_assumption" and not rationale:
            issues.append(f"analyst assumption {evidence_id} requires a rationale")
        _date(row.get("as_of_date"), f"evidence {evidence_id} as_of_date", issues)
        _number(row.get("value"), f"evidence {evidence_id} value", issues)
        index[evidence_id] = row
    return index


def _evidence_number(
    evidence: Mapping[str, Mapping[str, Any]],
    evidence_id: Any,
    label: str,
    issues: list[str],
) -> float:
    key = str(evidence_id or "").strip()
    row = evidence.get(key)
    if row is None:
        issues.append(f"{label} references missing evidence id {key or '<empty>'}")
        return 0.0
    return _number(row.get("value"), label, issues)


def _evidence_rate(
    evidence: Mapping[str, Mapping[str, Any]],
    evidence_id: Any,
    label: str,
    issues: list[str],
) -> float:
    key = str(evidence_id or "").strip()
    row = evidence.get(key)
    value = _evidence_number(evidence, key, label, issues)
    unit = str(row.get("unit") or "").lower() if row else ""
    if "percent" in unit or "%" in unit:
        value /= 100.0
    return value


def _compile_discount_rate(
    method: Mapping[str, Any],
    *,
    name: str,
    evidence: Mapping[str, Mapping[str, Any]],
    issues: list[str],
) -> float:
    claimed = _evidence_rate(
        evidence,
        method.get("discount_rate_evidence_id")
        or method.get("cost_of_equity_evidence_id"),
        f"{name} discount rate",
        issues,
    )
    formula = str(method.get("discount_rate_formula") or "")
    if formula == "capm":
        risk_free = _evidence_rate(
            evidence,
            method.get("risk_free_evidence_id"),
            f"{name} risk-free rate",
            issues,
        )
        beta = _evidence_number(
            evidence, method.get("beta_evidence_id"), f"{name} beta", issues
        )
        erp = _evidence_rate(
            evidence,
            method.get("equity_risk_premium_evidence_id"),
            f"{name} equity risk premium",
            issues,
        )
        additional_id = method.get("additional_premium_evidence_id")
        additional = (
            _evidence_rate(
                evidence,
                additional_id,
                f"{name} additional premium",
                issues,
            )
            if additional_id
            else 0.0
        )
        recomputed = risk_free + beta * erp + additional
        if abs(recomputed - claimed) > 0.0001:
            issues.append(
                f"{name} discount rate {claimed:.4%} does not reconcile to CAPM {recomputed:.4%}"
            )
    elif formula == "build_up":
        if not str(method.get("discount_rate_rationale") or "").strip():
            issues.append(f"{name} build-up discount rate requires a rationale")
    else:
        issues.append(f"{name} must declare capm or build_up discount_rate_formula")
    return claimed


def _validate_method_common(
    method: Mapping[str, Any],
    *,
    position: int,
    target_date: date,
    evidence: Mapping[str, Mapping[str, Any]],
    issues: list[str],
) -> tuple[str, str, float, date]:
    name = str(method.get("name") or "").strip() or f"method_{position}"
    method_type = str(method.get("type") or "").strip()
    weight = _number(method.get("weight_pct"), f"{name} weight_pct", issues)
    if weight < 0:
        issues.append(f"{name} weight_pct cannot be negative")
    if weight > 0 and not str(method.get("weight_rationale") or "").strip():
        issues.append(f"{name} requires a rationale for its positive weight")
    value_date = _date(method.get("value_date"), f"{name} value_date", issues)
    if value_date != target_date:
        issues.append(
            f"{name} value_date {value_date.isoformat()} does not match target_date {target_date.isoformat()}"
        )
    evidence_ids = method.get("evidence_ids")
    if not isinstance(evidence_ids, list) or not evidence_ids:
        issues.append(f"{name} requires evidence_ids")
    else:
        for evidence_id in evidence_ids:
            if str(evidence_id) not in evidence:
                issues.append(f"{name} references missing evidence id {evidence_id}")
    return name, method_type, weight, value_date


def _compile_dcf(
    method: Mapping[str, Any],
    *,
    name: str,
    value_date: date,
    evidence: Mapping[str, Mapping[str, Any]],
    issues: list[str],
) -> float:
    rate = _compile_discount_rate(
        method, name=name, evidence=evidence, issues=issues
    )
    growth = _evidence_rate(
        evidence, method.get("terminal_growth_evidence_id"), f"{name} terminal growth", issues
    )
    if not 0 < rate < 1:
        issues.append(f"{name} discount rate must be a decimal between 0 and 1")
    if growth >= rate:
        issues.append(f"{name} terminal growth must be below discount rate")
    rows = method.get("cash_flows_per_share")
    if not isinstance(rows, list) or not rows:
        issues.append(f"{name} requires cash_flows_per_share")
        return 0.0
    pv = 0.0
    previous_date = value_date
    last_amount = 0.0
    last_date = value_date
    for position, row in enumerate(rows):
        if not isinstance(row, Mapping):
            issues.append(f"{name} cash flow {position} must be an object")
            continue
        cash_date = _date(row.get("date"), f"{name} cash flow {position} date", issues)
        amount = _number(row.get("amount"), f"{name} cash flow {position} amount", issues)
        if not str(row.get("rationale") or "").strip():
            issues.append(f"{name} cash flow {position} requires a driver rationale")
        row_evidence_ids = row.get("evidence_ids")
        if not isinstance(row_evidence_ids, list) or not row_evidence_ids:
            issues.append(f"{name} cash flow {position} requires evidence_ids")
        else:
            for evidence_id in row_evidence_ids:
                if str(evidence_id) not in evidence:
                    issues.append(
                        f"{name} cash flow {position} references missing evidence id {evidence_id}"
                    )
        if cash_date <= previous_date:
            issues.append(f"{name} cash-flow dates must be strictly increasing after value_date")
        years = _year_fraction(value_date, cash_date)
        if years > 0 and rate > -1:
            pv += amount / ((1 + rate) ** years)
        previous_date = cash_date
        last_date = cash_date
        last_amount = amount
    if rate > growth and last_date > value_date:
        terminal = last_amount * (1 + growth) / (rate - growth)
        pv += terminal / ((1 + rate) ** _year_fraction(value_date, last_date))
    return pv


def _compile_residual_income(
    method: Mapping[str, Any],
    *,
    name: str,
    value_date: date,
    evidence: Mapping[str, Mapping[str, Any]],
    diluted_shares: float,
    issues: list[str],
) -> float:
    beginning_book = _evidence_number(
        evidence,
        method.get("beginning_book_equity_evidence_id"),
        f"{name} beginning book equity",
        issues,
    )
    cost_equity = _compile_discount_rate(
        method, name=name, evidence=evidence, issues=issues
    )
    terminal_growth = _evidence_rate(
        evidence,
        method.get("terminal_growth_evidence_id"),
        f"{name} terminal growth",
        issues,
    )
    terminal_roe = _evidence_rate(
        evidence,
        method.get("terminal_roe_evidence_id"),
        f"{name} terminal ROE",
        issues,
    )
    if not 0 < cost_equity < 1:
        issues.append(f"{name} cost of equity must be a decimal between 0 and 1")
    if terminal_growth >= cost_equity:
        issues.append(f"{name} terminal growth must be below cost of equity")
    periods = method.get("periods")
    if not isinstance(periods, list) or not periods:
        issues.append(f"{name} requires forecast periods")
        return 0.0
    book = beginning_book
    pv_residual = 0.0
    previous_date = value_date
    last_date = value_date
    last_roe = 0.0
    for position, row in enumerate(periods):
        if not isinstance(row, Mapping):
            issues.append(f"{name} period {position} must be an object")
            continue
        end_date = _date(row.get("end_date"), f"{name} period {position} end_date", issues)
        net_income = _number(row.get("net_income"), f"{name} period {position} net_income", issues)
        dividends = _number(row.get("dividends"), f"{name} period {position} dividends", issues)
        if not str(row.get("rationale") or "").strip():
            issues.append(f"{name} period {position} requires a driver rationale")
        row_evidence_ids = row.get("evidence_ids")
        if not isinstance(row_evidence_ids, list) or not row_evidence_ids:
            issues.append(f"{name} period {position} requires evidence_ids")
        else:
            for evidence_id in row_evidence_ids:
                if str(evidence_id) not in evidence:
                    issues.append(
                        f"{name} period {position} references missing evidence id {evidence_id}"
                    )
        period_years = _year_fraction(previous_date, end_date)
        elapsed_years = _year_fraction(value_date, end_date)
        if period_years <= 0:
            issues.append(f"{name} forecast dates must be strictly increasing after value_date")
            continue
        capital_charge = cost_equity * book * period_years
        residual_income = net_income - capital_charge
        pv_residual += residual_income / ((1 + cost_equity) ** elapsed_years)
        last_roe = net_income / book / period_years if book else 0.0
        book = book + net_income - dividends
        previous_date = end_date
        last_date = end_date
    roe_jump = abs(terminal_roe - last_roe)
    if roe_jump > 0.02 and not str(method.get("terminal_roe_bridge_rationale") or "").strip():
        issues.append(
            f"{name} terminal ROE differs from final explicit ROE by {roe_jump:.2%} without a bridge rationale"
        )
    if cost_equity > terminal_growth and last_date > value_date:
        terminal_income = terminal_roe * book
        terminal_residual = terminal_income - cost_equity * book
        terminal_value = terminal_residual / (cost_equity - terminal_growth)
        pv_residual += terminal_value / (
            (1 + cost_equity) ** _year_fraction(value_date, last_date)
        )
    equity_value = beginning_book + pv_residual
    return equity_value / diluted_shares if diluted_shares else 0.0


def _compile_multiple(
    method: Mapping[str, Any],
    *,
    name: str,
    weight: float,
    evidence: Mapping[str, Mapping[str, Any]],
    issues: list[str],
) -> float:
    def canonical_basis(value: Any) -> str:
        normalized = str(value or "").strip().lower()
        if normalized.startswith("forward"):
            return "forward"
        if normalized.startswith("trailing"):
            return "trailing"
        return normalized

    peer_basis = canonical_basis(method.get("peer_metric_basis"))
    subject_basis = canonical_basis(method.get("subject_metric_basis"))
    if peer_basis not in {"trailing", "forward"} or subject_basis not in {"trailing", "forward"}:
        issues.append(f"{name} metric bases must be trailing or forward")
    elif peer_basis != subject_basis:
        issues.append(f"{name} mixes {peer_basis} peer multiples with {subject_basis} subject metrics")
    metric = _evidence_number(
        evidence, method.get("subject_metric_evidence_id"), f"{name} subject metric", issues
    )
    peer_ids = method.get("peer_multiple_evidence_ids")
    if isinstance(peer_ids, list) and peer_ids:
        peer_values = [
            _evidence_number(evidence, evidence_id, f"{name} peer multiple", issues)
            for evidence_id in peer_ids
        ]
        if weight > 0 and len(peer_values) < 3:
            issues.append(f"{name} requires at least three sourced peer multiples")
        peer_statistic = statistics.median(peer_values) if peer_values else 0.0
    else:
        peer_statistic = _evidence_number(
            evidence,
            method.get("peer_statistic_evidence_id"),
            f"{name} peer statistic",
            issues,
        )
        if weight > 0:
            issues.append(f"{name} requires peer_multiple_evidence_ids for deterministic median")
    premium = _evidence_rate(
        evidence,
        method.get("premium_discount_evidence_id"),
        f"{name} premium or discount",
        issues,
    )
    applied_multiple = peer_statistic * (1 + premium)
    claimed_multiple = _number(method.get("applied_multiple"), f"{name} applied multiple", issues)
    if abs(applied_multiple - claimed_multiple) > 0.01:
        issues.append(
            f"{name} applied multiple {claimed_multiple:.4g} does not reconcile to peer statistic "
            f"{peer_statistic:.4g} and premium/discount {premium:.2%}"
        )
    return metric * applied_multiple


def _compile_asset(
    method: Mapping[str, Any],
    *,
    name: str,
    weight: float,
    evidence: Mapping[str, Mapping[str, Any]],
    issues: list[str],
) -> float:
    going_concern = bool(method.get("going_concern_value"))
    if weight > 0 and not going_concern:
        issues.append(f"{name} is not a going-concern value and cannot receive positive target weight")
    asset_value = _evidence_number(
        evidence, method.get("asset_value_per_share_evidence_id"), f"{name} asset value", issues
    )
    adjustment = _evidence_rate(
        evidence, method.get("adjustment_evidence_id"), f"{name} adjustment", issues
    )
    return asset_value * (1 + adjustment)


def compile_valuation_case(payload: Mapping[str, Any]) -> CompiledValuation:
    issues: list[str] = []
    currency = str(payload.get("currency") or "").upper().strip()
    if len(currency) != 3:
        issues.append("currency must be a three-letter code")
    reference_date = _date(payload.get("reference_date"), "reference_date", issues)
    target_date = _date(payload.get("target_date"), "target_date", issues)
    if target_date < reference_date:
        issues.append("target_date cannot precede reference_date")
    reference_price = _number(payload.get("reference_price"), "reference_price", issues, positive=True)
    diluted_shares = _number(payload.get("diluted_shares"), "diluted_shares", issues, positive=True)
    evidence = _evidence_index(payload.get("evidence"), issues)
    reference_evidence = _evidence_number(
        evidence,
        payload.get("reference_price_evidence_id"),
        "reference price evidence",
        issues,
    )
    shares_evidence = _evidence_number(
        evidence,
        payload.get("diluted_shares_evidence_id"),
        "diluted shares evidence",
        issues,
    )
    if reference_price and abs(reference_evidence - reference_price) / reference_price > 0.0001:
        issues.append("reference_price does not reconcile to its evidence item")
    if diluted_shares and abs(shares_evidence - diluted_shares) / diluted_shares > 0.0001:
        issues.append("diluted_shares does not reconcile to its evidence item")
    methods = payload.get("methods")
    if not isinstance(methods, list) or not methods:
        issues.append("methods must be a non-empty list")
        methods = []

    compiled: list[CompiledMethod] = []
    for position, method in enumerate(methods):
        if not isinstance(method, Mapping):
            issues.append(f"method[{position}] must be an object")
            continue
        name, method_type, weight, value_date = _validate_method_common(
            method,
            position=position,
            target_date=target_date,
            evidence=evidence,
            issues=issues,
        )
        if method_type in {"dcf", "fcfe"}:
            value = _compile_dcf(
                method,
                name=name,
                value_date=value_date,
                evidence=evidence,
                issues=issues,
            )
        elif method_type == "residual_income":
            value = _compile_residual_income(
                method,
                name=name,
                value_date=value_date,
                evidence=evidence,
                diluted_shares=diluted_shares,
                issues=issues,
            )
        elif method_type == "multiple":
            value = _compile_multiple(
                method,
                name=name,
                weight=weight,
                evidence=evidence,
                issues=issues,
            )
        elif method_type == "asset":
            value = _compile_asset(
                method,
                name=name,
                weight=weight,
                evidence=evidence,
                issues=issues,
            )
        else:
            issues.append(f"{name} has unsupported method type {method_type or '<empty>'}")
            value = 0.0
        compiled.append(
            CompiledMethod(
                name=name,
                method_type=method_type,
                value_per_share=value,
                weight_pct=weight,
                weighted_contribution=value * weight / 100.0,
                value_date=value_date.isoformat(),
            )
        )

    weight_sum = sum(method.weight_pct for method in compiled if method.weight_pct > 0)
    if abs(weight_sum - 100.0) > 0.01:
        issues.append(f"positive method weights total {weight_sum:.4g}%, not 100%")
    if issues:
        raise ValuationCompilationError(issues)
    target_price = sum(method.weighted_contribution for method in compiled)
    upside = (target_price / reference_price - 1) * 100.0
    return CompiledValuation(
        currency=currency,
        reference_date=reference_date.isoformat(),
        reference_price=reference_price,
        target_date=target_date.isoformat(),
        diluted_shares=diluted_shares,
        target_price=target_price,
        upside_downside_pct=upside,
        methods=tuple(compiled),
    )
