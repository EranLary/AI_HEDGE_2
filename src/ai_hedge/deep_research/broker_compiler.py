from __future__ import annotations

import statistics
from datetime import date
from typing import Any, Mapping

from .compiler import (
    CompiledMethod,
    CompiledValuation,
    ValuationCompilationError,
    _compile_discount_rate,
    _date,
    _evidence_index,
    _evidence_number,
    _evidence_rate,
    _number,
    _year_fraction,
)


BROKER_COMPILER_VERSION = "broker-valuation-compiler-v3"


def _unit_scale(unit: str) -> float:
    normalized = unit.lower().replace(",", " ")
    if "billion" in normalized:
        return 1_000_000_000.0
    if "million" in normalized:
        return 1_000_000.0
    if "thousand" in normalized:
        return 1_000.0
    return 1.0


def _evidence_unit(
    evidence: Mapping[str, Mapping[str, Any]],
    evidence_id: Any,
    label: str,
    issues: list[str],
) -> str:
    key = str(evidence_id or "").strip()
    row = evidence.get(key)
    if row is None:
        return ""
    unit = str(row.get("unit") or "").strip()
    if not unit:
        issues.append(f"{label} requires a unit")
    return unit


def _require_unit(
    evidence: Mapping[str, Mapping[str, Any]],
    evidence_id: Any,
    label: str,
    issues: list[str],
    *,
    contains: tuple[str, ...],
    contains_any: tuple[str, ...] = (),
    scale: float | None = None,
) -> None:
    unit = _evidence_unit(evidence, evidence_id, label, issues)
    normalized = unit.lower()
    if unit and not all(fragment.lower() in normalized for fragment in contains):
        issues.append(f"{label} unit {unit!r} must contain {' and '.join(contains)}")
    if unit and contains_any and not any(
        fragment.lower() in normalized for fragment in contains_any
    ):
        issues.append(
            f"{label} unit {unit!r} must contain one of {', '.join(contains_any)}"
        )
    if unit and scale is not None and _unit_scale(unit) != scale:
        issues.append(f"{label} unit {unit!r} uses a different scale")


def _value(
    evidence: Mapping[str, Mapping[str, Any]],
    row: Mapping[str, Any],
    field: str,
    label: str,
    issues: list[str],
    *,
    rate: bool = False,
) -> float:
    getter = _evidence_rate if rate else _evidence_number
    return getter(evidence, row.get(field), label, issues)


def _require_period_support(
    row: Mapping[str, Any],
    *,
    label: str,
    evidence: Mapping[str, Mapping[str, Any]],
    issues: list[str],
) -> None:
    if not str(row.get("rationale") or "").strip():
        issues.append(f"{label} requires a driver rationale")
    evidence_ids = row.get("evidence_ids")
    if not isinstance(evidence_ids, list) or not evidence_ids:
        issues.append(f"{label} requires evidence_ids")
        return
    for evidence_id in evidence_ids:
        if str(evidence_id) not in evidence:
            issues.append(f"{label} references missing evidence id {evidence_id}")


def compile_broker_valuation_case(payload: Mapping[str, Any]) -> CompiledValuation:
    """Compile a current-fair-value case for a broker or financial institution.

    All balance-sheet, share-count, and method values are forced onto one valuation
    date. The operating forecast is constructed from economic drivers rather than a
    free-standing net-income CAGR.
    """

    issues: list[str] = []
    currency = str(payload.get("currency") or "").upper().strip()
    if len(currency) != 3:
        issues.append("currency must be a three-letter code")
    valuation_date = _date(payload.get("valuation_date"), "valuation_date", issues)
    reference_price = _number(
        payload.get("reference_price"), "reference_price", issues, positive=True
    )
    basic_shares = _number(
        payload.get("basic_shares"), "basic_shares", issues, positive=True
    )
    incremental_dilution = _number(
        payload.get("incremental_dilution"), "incremental_dilution", issues
    )
    if incremental_dilution < 0:
        issues.append("incremental_dilution cannot be negative")
    diluted_shares = _number(
        payload.get("diluted_shares"), "diluted_shares", issues, positive=True
    )
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
    basic_shares_evidence = _evidence_number(
        evidence,
        payload.get("basic_shares_evidence_id"),
        "basic shares evidence",
        issues,
    )
    dilution_evidence = _evidence_number(
        evidence,
        payload.get("incremental_dilution_evidence_id"),
        "incremental dilution evidence",
        issues,
    )
    if reference_price and abs(reference_evidence - reference_price) / reference_price > 0.0001:
        issues.append("reference_price does not reconcile to its evidence item")
    reference_row = evidence.get(str(payload.get("reference_price_evidence_id") or ""))
    reference_price_date = _date(
        reference_row.get("as_of_date") if reference_row else None,
        "reference price evidence date",
        issues,
    )
    reference_age_days = (valuation_date - reference_price_date).days
    if reference_age_days < 0 or reference_age_days > 7:
        issues.append("reference price must be within seven days of valuation_date")
    if diluted_shares and abs(shares_evidence - diluted_shares) / diluted_shares > 0.0001:
        issues.append("diluted_shares does not reconcile to its evidence item")
    if basic_shares and abs(basic_shares_evidence - basic_shares) / basic_shares > 0.0001:
        issues.append("basic_shares does not reconcile to its evidence item")
    if abs(dilution_evidence - incremental_dilution) > 0.0001:
        issues.append("incremental_dilution does not reconcile to its evidence item")
    if diluted_shares and abs(diluted_shares - basic_shares - incremental_dilution) > 0.0001:
        issues.append("diluted_shares must equal basic_shares plus incremental_dilution")
    dilution_method = str(payload.get("dilution_method") or "")
    if dilution_method not in {"treasury_stock", "if_converted", "none"}:
        issues.append("dilution_method is invalid")
    if incremental_dilution > 0 and dilution_method == "none":
        issues.append("positive incremental dilution requires a dilution method")
    if not str(payload.get("dilution_rationale") or "").strip():
        issues.append("dilution_rationale is required")
    _require_unit(
        evidence,
        payload.get("reference_price_evidence_id"),
        "reference price evidence",
        issues,
        contains=(currency, "/share"),
    )
    shares_unit = _evidence_unit(
        evidence,
        payload.get("diluted_shares_evidence_id"),
        "diluted shares evidence",
        issues,
    )
    if shares_unit and "share" not in shares_unit.lower():
        issues.append("diluted shares evidence unit must contain share")
    amount_scale = _unit_scale(shares_unit)
    for field, label in (
        ("basic_shares_evidence_id", "basic shares evidence"),
        ("incremental_dilution_evidence_id", "incremental dilution evidence"),
    ):
        _require_unit(
            evidence,
            payload.get(field),
            label,
            issues,
            contains=("share",),
            scale=amount_scale,
        )

    intrinsic = payload.get("intrinsic_method")
    intrinsic = intrinsic if isinstance(intrinsic, Mapping) else {}
    intrinsic_weight = _number(
        intrinsic.get("weight_pct"), "intrinsic weight_pct", issues
    )
    if intrinsic_weight > 0 and not str(intrinsic.get("weight_rationale") or "").strip():
        issues.append("intrinsic method requires a weight rationale")
    reported_book = _evidence_number(
        evidence,
        intrinsic.get("reported_parent_book_equity_evidence_id"),
        "reported parent book equity",
        issues,
    )
    _require_unit(
        evidence,
        intrinsic.get("reported_parent_book_equity_evidence_id"),
        "reported parent book equity",
        issues,
        contains=(currency,),
        scale=amount_scale,
    )
    reported_book_date = _date(
        intrinsic.get("reported_book_date"), "reported_book_date", issues
    )
    if reported_book_date > valuation_date:
        issues.append("reported_book_date cannot be after valuation_date")
    interim_dividends = _evidence_number(
        evidence,
        intrinsic.get("interim_dividends_evidence_id"),
        "interim dividends",
        issues,
    )
    _require_unit(
        evidence,
        intrinsic.get("interim_dividends_evidence_id"),
        "interim dividends",
        issues,
        contains=(currency,),
        scale=amount_scale,
    )
    base_book = reported_book
    cost_equity = _compile_discount_rate(
        intrinsic,
        name="broker residual income",
        evidence=evidence,
        issues=issues,
    )
    terminal_growth = _evidence_rate(
        evidence,
        intrinsic.get("terminal_growth_evidence_id"),
        "terminal growth",
        issues,
    )
    terminal_roe = _evidence_rate(
        evidence,
        intrinsic.get("terminal_roe_evidence_id"),
        "terminal ROE",
        issues,
    )
    if terminal_growth >= cost_equity:
        issues.append("terminal growth must be below cost of equity")

    periods = intrinsic.get("forecast_periods")
    if not isinstance(periods, list) or not periods:
        issues.append("intrinsic method requires forecast_periods")
        periods = []
    elif len(periods) < 3:
        issues.append("intrinsic method requires at least three forecast periods")
    book = base_book
    pv_residual = 0.0
    previous_date = reported_book_date
    last_date = reported_book_date
    last_roe = 0.0
    last_parent_net_income = 0.0
    last_dividends = 0.0
    fixed_public_share: float | None = None
    for position, raw_row in enumerate(periods):
        if not isinstance(raw_row, Mapping):
            issues.append(f"forecast period {position} must be an object")
            continue
        row = raw_row
        label = f"forecast period {position}"
        _require_period_support(
            row, label=label, evidence=evidence, issues=issues
        )
        start_date = _date(row.get("start_date"), f"{label} start_date", issues)
        end_date = _date(row.get("end_date"), f"{label} end_date", issues)
        if start_date != previous_date:
            issues.append(
                f"{label} start_date must equal prior boundary {previous_date.isoformat()}"
            )
        period_years = _year_fraction(start_date, end_date)
        elapsed_years = _year_fraction(reported_book_date, end_date)
        if period_years <= 0:
            issues.append("broker forecast dates must be strictly increasing")
            continue

        margin_loans = _value(
            evidence, row, "margin_loans_evidence_id", f"{label} margin loans", issues
        )
        margin_yield = _value(
            evidence,
            row,
            "margin_net_yield_evidence_id",
            f"{label} margin net yield",
            issues,
            rate=True,
        )
        segregated_balance = _value(
            evidence,
            row,
            "segregated_cash_securities_balance_evidence_id",
            f"{label} segregated cash and securities balance",
            issues,
        )
        segregated_yield = _value(
            evidence,
            row,
            "segregated_cash_securities_yield_evidence_id",
            f"{label} segregated cash and securities yield",
            issues,
            rate=True,
        )
        credit_balances = _value(
            evidence,
            row,
            "client_credit_ex_sweep_balances_evidence_id",
            f"{label} client credit balances excluding sweeps",
            issues,
        )
        credit_cost_yield = _value(
            evidence,
            row,
            "client_credit_cost_yield_evidence_id",
            f"{label} client credit cost yield",
            issues,
            rate=True,
        )
        securities_lending_income = _value(
            evidence,
            row,
            "securities_lending_income_evidence_id",
            f"{label} securities lending income",
            issues,
        )
        fdic_sweep_income = _value(
            evidence,
            row,
            "fdic_sweep_income_evidence_id",
            f"{label} FDIC sweep income",
            issues,
        )
        other_nii = _value(
            evidence, row, "other_nii_evidence_id", f"{label} other NII", issues
        )
        average_daily_trades = _value(
            evidence,
            row,
            "average_daily_revenue_trades_evidence_id",
            f"{label} average daily revenue trades",
            issues,
        )
        trading_days = _value(
            evidence,
            row,
            "trading_days_evidence_id",
            f"{label} trading days",
            issues,
        )
        commission_per_dart = _value(
            evidence,
            row,
            "commission_per_dart_evidence_id",
            f"{label} commission per DART",
            issues,
        )
        other_revenue = _value(
            evidence, row, "other_revenue_evidence_id", f"{label} other revenue", issues
        )
        non_interest_expense = _value(
            evidence,
            row,
            "non_interest_expense_evidence_id",
            f"{label} non-interest expense",
            issues,
        )
        tax_rate = _value(
            evidence, row, "tax_rate_evidence_id", f"{label} tax rate", issues, rate=True
        )
        public_share = _value(
            evidence,
            row,
            "public_economic_share_evidence_id",
            f"{label} public economic share",
            issues,
            rate=True,
        )
        parent_items = _value(
            evidence,
            row,
            "other_parent_income_evidence_id",
            f"{label} other parent income",
            issues,
        )
        dividends = _value(
            evidence, row, "dividends_evidence_id", f"{label} dividends", issues
        )
        other_equity_flows = _value(
            evidence,
            row,
            "other_equity_flows_evidence_id",
            f"{label} other equity flows",
            issues,
        )
        for field, field_label in (
            ("margin_loans_evidence_id", "margin loans"),
            (
                "segregated_cash_securities_balance_evidence_id",
                "segregated cash and securities balance",
            ),
            (
                "client_credit_ex_sweep_balances_evidence_id",
                "client credit balances excluding sweeps",
            ),
            ("securities_lending_income_evidence_id", "securities lending income"),
            ("fdic_sweep_income_evidence_id", "FDIC sweep income"),
            ("other_nii_evidence_id", "other NII"),
            ("other_revenue_evidence_id", "other revenue"),
            ("non_interest_expense_evidence_id", "non-interest expense"),
            ("other_parent_income_evidence_id", "other parent income"),
            ("dividends_evidence_id", "dividends"),
            ("other_equity_flows_evidence_id", "other equity flows"),
        ):
            _require_unit(
                evidence,
                row.get(field),
                f"{label} {field_label}",
                issues,
                contains=(currency,),
                scale=amount_scale,
            )
        _require_unit(
            evidence,
            row.get("average_daily_revenue_trades_evidence_id"),
            f"{label} average daily revenue trades",
            issues,
            contains=(),
            contains_any=("trade", "dart", "order"),
            scale=amount_scale,
        )
        _require_unit(
            evidence,
            row.get("trading_days_evidence_id"),
            f"{label} trading days",
            issues,
            contains=("day",),
        )
        _require_unit(
            evidence,
            row.get("commission_per_dart_evidence_id"),
            f"{label} commission per DART",
            issues,
            contains=(currency,),
            contains_any=("/trade", "/dart", "/order"),
        )
        if not 0 <= tax_rate < 1:
            issues.append(f"{label} tax rate must be between 0 and 1")
        if not 0 < public_share <= 1:
            issues.append(f"{label} public economic share must be between 0 and 1")
        if fixed_public_share is None:
            fixed_public_share = public_share
        elif abs(public_share - fixed_public_share) > 0.0001:
            issues.append(
                f"{label} public economic share changes without a matching share bridge"
            )
        minimum_trading_days = 150 * period_years
        maximum_trading_days = 300 * period_years
        if not minimum_trading_days <= trading_days <= maximum_trading_days:
            issues.append(
                f"{label} trading days {trading_days:.4g} are inconsistent with its exact period"
            )

        net_interest_income = (
            margin_loans * margin_yield * period_years
            + segregated_balance * segregated_yield * period_years
            - credit_balances * credit_cost_yield * period_years
            + securities_lending_income
            + fdic_sweep_income
            + other_nii
        )
        commission_revenue = average_daily_trades * trading_days * commission_per_dart
        pretax_income = (
            net_interest_income
            + commission_revenue
            + other_revenue
            - non_interest_expense
        )
        consolidated_net_income = pretax_income * (1 - tax_rate)
        parent_net_income = consolidated_net_income * public_share + parent_items
        capital_charge = cost_equity * book * period_years
        residual_income = parent_net_income - capital_charge
        pv_residual += residual_income / ((1 + cost_equity) ** elapsed_years)
        last_roe = parent_net_income / book / period_years if book else 0.0
        book = book + parent_net_income - dividends + other_equity_flows
        last_parent_net_income = parent_net_income
        last_dividends = dividends
        previous_date = end_date
        last_date = end_date

    roe_jump = abs(terminal_roe - last_roe)
    if roe_jump > 0.02 and not str(
        intrinsic.get("terminal_roe_bridge_rationale") or ""
    ).strip():
        issues.append(
            f"terminal ROE differs from final explicit ROE by {roe_jump:.2%} without a bridge rationale"
        )
    if periods and cost_equity > terminal_growth:
        terminal_income = terminal_roe * book
        terminal_residual = terminal_income - cost_equity * book
        terminal_value = terminal_residual / (cost_equity - terminal_growth)
        pv_residual += terminal_value / (
            (1 + cost_equity) ** _year_fraction(reported_book_date, last_date)
        )
    implied_terminal_payout = 1 - terminal_growth / terminal_roe if terminal_roe else 0.0
    explicit_payout = (
        last_dividends / last_parent_net_income if last_parent_net_income > 0 else 0.0
    )
    if abs(explicit_payout - implied_terminal_payout) > 0.15 and not str(
        intrinsic.get("terminal_capital_policy_rationale") or ""
    ).strip():
        issues.append(
            "terminal payout differs materially from the final explicit payout without a capital-policy bridge"
        )
    intrinsic_at_report_date = (
        (base_book + pv_residual) / diluted_shares if diluted_shares else 0.0
    )
    carry_years = _year_fraction(reported_book_date, valuation_date)
    intrinsic_value = (
        intrinsic_at_report_date * ((1 + cost_equity) ** carry_years)
        - interim_dividends / diluted_shares
        if diluted_shares
        else 0.0
    )

    comparable = payload.get("comparable_method")
    comparable = comparable if isinstance(comparable, Mapping) else {}
    comparable_weight = _number(
        comparable.get("weight_pct"), "comparable weight_pct", issues
    )
    if comparable_weight > 0 and not str(
        comparable.get("weight_rationale") or ""
    ).strip():
        issues.append("comparable method requires a weight rationale")
    subject_eps = _evidence_number(
        evidence,
        comparable.get("subject_eps_evidence_id"),
        "subject EPS",
        issues,
    )
    _require_unit(
        evidence,
        comparable.get("subject_eps_evidence_id"),
        "subject EPS",
        issues,
        contains=(currency, "/share"),
    )
    subject_period = _date(
        comparable.get("subject_eps_period_end"), "subject EPS period end", issues
    )
    subject_basis = str(comparable.get("subject_eps_basis") or "")
    if subject_basis not in {"ttm_gaap", "forward_fiscal_gaap"}:
        issues.append("subject EPS basis must be ttm_gaap or forward_fiscal_gaap")
    subject_eps_row = evidence.get(str(comparable.get("subject_eps_evidence_id") or ""))
    if subject_eps_row and "annualized" in str(subject_eps_row.get("unit") or "").lower():
        issues.append("annualized single-quarter subject EPS is not permitted")
    peer_rows = comparable.get("peers")
    if not isinstance(peer_rows, list) or len(peer_rows) < 5:
        issues.append("comparable method requires at least five peers")
        peer_rows = []
    peer_multiples: list[float] = []
    for position, raw_peer in enumerate(peer_rows):
        if not isinstance(raw_peer, Mapping):
            issues.append(f"peer {position} must be an object")
            continue
        peer = raw_peer
        peer_name = str(peer.get("ticker") or f"peer_{position}")
        peer_price = _evidence_number(
            evidence,
            peer.get("price_evidence_id"),
            f"{peer_name} price",
            issues,
        )
        peer_eps = _evidence_number(
            evidence,
            peer.get("eps_evidence_id"),
            f"{peer_name} EPS",
            issues,
        )
        _require_unit(
            evidence,
            peer.get("price_evidence_id"),
            f"{peer_name} price",
            issues,
            contains=(currency, "/share"),
        )
        _require_unit(
            evidence,
            peer.get("eps_evidence_id"),
            f"{peer_name} EPS",
            issues,
            contains=(currency, "/share"),
        )
        peer_period = _date(
            peer.get("eps_period_end"), f"{peer_name} EPS period end", issues
        )
        peer_basis = str(peer.get("eps_basis") or "")
        if peer_period != subject_period:
            issues.append(f"{peer_name} EPS period does not match subject EPS period")
        if peer_basis != subject_basis:
            issues.append(f"{peer_name} EPS basis does not match subject EPS basis")
        price_row = evidence.get(str(peer.get("price_evidence_id") or ""))
        price_date = _date(
            price_row.get("as_of_date") if price_row else None,
            f"{peer_name} price evidence date",
            issues,
        )
        price_age_days = (valuation_date - price_date).days
        if price_age_days < 0 or price_age_days > 7:
            issues.append(f"{peer_name} price must be within seven days of valuation_date")
        if peer_eps <= 0:
            issues.append(f"{peer_name} EPS must be positive")
        else:
            peer_multiples.append(peer_price / peer_eps)
        if not str(peer.get("comparability_rationale") or "").strip():
            issues.append(f"{peer_name} requires a comparability rationale")
    peer_median = statistics.median(peer_multiples) if peer_multiples else 0.0
    premium = _evidence_rate(
        evidence,
        comparable.get("premium_discount_evidence_id"),
        "comparable premium or discount",
        issues,
    )
    comparable_value = subject_eps * peer_median * (1 + premium)

    weight_sum = intrinsic_weight + comparable_weight
    if abs(weight_sum - 100.0) > 0.01:
        issues.append(f"method weights total {weight_sum:.4g}%, not 100%")
    if issues:
        raise ValuationCompilationError(issues)

    intrinsic_method = CompiledMethod(
        name="Broker residual income",
        method_type="broker_residual_income",
        value_per_share=intrinsic_value,
        weight_pct=intrinsic_weight,
        weighted_contribution=intrinsic_value * intrinsic_weight / 100.0,
        value_date=valuation_date.isoformat(),
    )
    comparable_method = CompiledMethod(
        name="Matched-period peer P/E",
        method_type="matched_peer_multiple",
        value_per_share=comparable_value,
        weight_pct=comparable_weight,
        weighted_contribution=comparable_value * comparable_weight / 100.0,
        value_date=valuation_date.isoformat(),
    )
    methods = (intrinsic_method, comparable_method)
    fair_value = sum(method.weighted_contribution for method in methods)
    return CompiledValuation(
        currency=currency,
        reference_date=valuation_date.isoformat(),
        reference_price=reference_price,
        target_date=valuation_date.isoformat(),
        diluted_shares=diluted_shares,
        target_price=fair_value,
        upside_downside_pct=(fair_value / reference_price - 1) * 100.0,
        methods=methods,
    )
