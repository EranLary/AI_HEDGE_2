from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .snapshot import CompanySnapshot


POLICY_VERSION = "consensus-deep-research-v1"
CONSENSUS_BASIS = "weighted_components_v2"
DEFAULT_TIMEOUT_SECONDS = 2400
DEFAULT_MAX_COST_USD = 1.5


def _boolean_env(name: str, default: bool) -> bool:
    raw = str(os.getenv(name, "") or "").strip().casefold()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def integration_enabled() -> bool:
    return _boolean_env("DEEP_RESEARCH_ENABLED", True)


def _finite(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def snapshot_from_platform_inputs(
    ticker: str,
    info_dict: Mapping[str, Any],
    *,
    now: datetime | None = None,
) -> CompanySnapshot:
    info = info_dict.get("info") if isinstance(info_dict.get("info"), Mapping) else {}
    generated = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    company_name = str(
        info.get("longName")
        or info.get("shortName")
        or info_dict.get("short_name")
        or ticker
    ).strip()
    return CompanySnapshot(
        ticker=ticker.upper().strip(),
        company_name=company_name,
        exchange=str(info.get("fullExchangeName") or info.get("exchange") or "").strip(),
        security_type=str(info.get("quoteType") or "").strip(),
        quote_currency=str(info.get("currency") or "").strip().upper(),
        reporting_currency=str(info.get("financialCurrency") or "").strip().upper(),
        current_price=_finite(
            info.get("currentPrice")
            or info.get("regularMarketPrice")
            or info.get("navPrice")
        ),
        as_of_utc=generated.isoformat().replace("+00:00", "Z"),
        provider="AI Hedge raw Yahoo identity snapshot",
    )


@dataclass
class DeepResearchProcess:
    process: subprocess.Popen[str] | None
    root: Path
    result_path: Path
    started_monotonic: float
    startup_error: str = ""

    def collect(self, *, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
        if self.process is None:
            return unavailable_summary("failed", self.startup_error or "Deep Research failed to start")
        remaining = max(0.0, timeout_seconds - (time.monotonic() - self.started_monotonic))
        try:
            stdout, stderr = self.process.communicate(timeout=remaining)
        except subprocess.TimeoutExpired:
            self.process.kill()
            stdout, stderr = self.process.communicate()
            return unavailable_summary(
                "timed_out",
                f"Deep Research exceeded the {timeout_seconds // 60}-minute limit.",
                stdout=stdout,
                stderr=stderr,
            )
        if self.result_path.exists():
            try:
                payload = json.loads(self.result_path.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                return unavailable_summary("failed", f"Invalid Deep Research result: {exc}")
            if isinstance(payload, dict):
                return payload
        reason = (stderr or stdout or f"worker exited with code {self.process.returncode}").strip()
        return unavailable_summary("failed", reason[-2000:])


def unavailable_summary(status: str, reason: str, **diagnostics: Any) -> dict[str, Any]:
    return {
        "status": status,
        "target_usable": False,
        "target_price": None,
        "investment_amount": None,
        "investment_pct": None,
        "unavailable_reason": str(reason or "Deep Research unavailable"),
        "methods": [],
        "assumptions": [],
        "limitations": [],
        "quality": {"publication_status": "red"},
        "provider": "deepseek",
        "models": {},
        "duration_seconds": None,
        "cost_usd": None,
        "artifacts": {},
        "diagnostics": {key: value for key, value in diagnostics.items() if value},
    }


def start_isolated_research(
    *,
    snapshot: CompanySnapshot,
    run_dir: Path,
) -> DeepResearchProcess:
    root = Path(run_dir) / "deep_research"
    root.mkdir(parents=True, exist_ok=True)
    result_path = root / "integration_result.json"
    snapshot_path = root / "snapshot.json"
    snapshot_path.write_text(
        json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if not integration_enabled():
        return DeepResearchProcess(
            process=None,
            root=root,
            result_path=result_path,
            started_monotonic=time.monotonic(),
            startup_error="Deep Research is disabled by DEEP_RESEARCH_ENABLED.",
        )
    if not str(os.getenv("DEEPSEEK_API_KEY", "") or "").strip():
        return DeepResearchProcess(
            process=None,
            root=root,
            result_path=result_path,
            started_monotonic=time.monotonic(),
            startup_error="DEEPSEEK_API_KEY is unavailable.",
        )
    command = [
        sys.executable,
        "-m",
        "ai_hedge.deep_research.integration_worker",
        "--snapshot",
        str(snapshot_path),
        "--output-root",
        str(root),
        "--result",
        str(result_path),
    ]
    try:
        process = subprocess.Popen(
            command,
            cwd=str(Path.cwd()),
            env=os.environ.copy(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except Exception as exc:  # noqa: BLE001
        return DeepResearchProcess(
            process=None,
            root=root,
            result_path=result_path,
            started_monotonic=time.monotonic(),
            startup_error=f"{type(exc).__name__}: {exc}",
        )
    return DeepResearchProcess(
        process=process,
        root=root,
        result_path=result_path,
        started_monotonic=time.monotonic(),
    )


_ASSUMPTION_LABELS = {
    "discount_rate_evidence_id": "Discount Rate / WACC",
    "cost_of_equity_evidence_id": "Cost of Equity",
    "risk_free_evidence_id": "Risk-Free Rate",
    "beta_evidence_id": "Beta",
    "equity_risk_premium_evidence_id": "Equity Risk Premium",
    "additional_premium_evidence_id": "Additional Risk Premium",
    "terminal_growth_evidence_id": "Terminal Growth",
    "terminal_roe_evidence_id": "Terminal ROE",
    "subject_metric_evidence_id": "Representative Earnings / Metric",
    "peer_statistic_evidence_id": "Representative Multiple",
    "beginning_book_equity_evidence_id": "Beginning Book Equity",
    "asset_value_per_share_evidence_id": "Asset Value per Share",
    "central_costs_evidence_id": "Central Costs",
    "minority_interests_evidence_id": "Minority Interests",
    "tax_leakage_evidence_id": "Tax Leakage",
    "debt_evidence_id": "Debt",
    "cash_evidence_id": "Cash",
}


def _assumptions(case: Mapping[str, Any]) -> list[dict[str, Any]]:
    evidence = {
        str(row.get("id") or ""): row
        for row in case.get("evidence") or []
        if isinstance(row, Mapping)
    }
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for method in case.get("methods") or []:
        if not isinstance(method, Mapping):
            continue
        method_name = str(method.get("name") or method.get("type") or "Method")
        fields = dict(_ASSUMPTION_LABELS)
        fields["diluted_shares_evidence_id"] = "Diluted Shares"
        for field, label in fields.items():
            evidence_id = str(
                case.get(field) if field == "diluted_shares_evidence_id" else method.get(field)
                or ""
            )
            item = evidence.get(evidence_id)
            if not item or (method_name, evidence_id) in seen:
                continue
            seen.add((method_name, evidence_id))
            rows.append(
                {
                    "key": field.removesuffix("_evidence_id"),
                    "label": label,
                    "value": item.get("value"),
                    "unit": item.get("unit"),
                    "date": item.get("as_of_date"),
                    "source_type": item.get("kind"),
                    "rationale": item.get("rationale"),
                    "method": method_name,
                }
            )
        for component in method.get("sotp_components") or []:
            if not isinstance(component, Mapping):
                continue
            evidence_id = str(component.get("value_evidence_id") or "")
            item = evidence.get(evidence_id)
            if not item:
                continue
            rows.append(
                {
                    "key": "sotp_component",
                    "label": f"SOTP — {component.get('name') or 'Component'}",
                    "value": item.get("value"),
                    "unit": item.get("unit"),
                    "date": item.get("as_of_date"),
                    "source_type": item.get("kind"),
                    "rationale": component.get("rationale") or item.get("rationale"),
                    "method": method_name,
                    "ownership_pct": component.get("ownership_pct"),
                    "value_basis": component.get("value_basis"),
                }
            )
    return rows


def build_summary(run_dir: Path) -> dict[str, Any]:
    run_dir = Path(run_dir)
    manifest = json.loads((run_dir / "research_manifest.json").read_text(encoding="utf-8"))
    grade = json.loads((run_dir / "research_grade.json").read_text(encoding="utf-8"))
    compiled_payload = json.loads((run_dir / "valuation_compiled.json").read_text(encoding="utf-8"))
    case = json.loads((run_dir / "valuation_case.json").read_text(encoding="utf-8"))
    compiled = compiled_payload.get("compiled") if compiled_payload.get("valid") else {}
    compiled = compiled if isinstance(compiled, Mapping) else {}
    target = _finite(compiled.get("target_price"))
    target_usable = bool(grade.get("target_usable") and target and target > 0)
    methods_by_name = {
        str(method.get("name") or ""): method
        for method in case.get("methods") or []
        if isinstance(method, Mapping)
    }
    methods = []
    for method in compiled.get("methods") or []:
        if not isinstance(method, Mapping):
            continue
        source = methods_by_name.get(str(method.get("name") or ""), {})
        methods.append(
            {
                "role": method.get("role") or source.get("role"),
                "type": method.get("method_type"),
                "label": method.get("name"),
                "value_per_share": method.get("value_per_share"),
                "weight_pct": method.get("weight_pct"),
                "contribution": method.get("weighted_contribution"),
            }
        )
    investment = _finite(compiled.get("investment_amount"))
    usage = manifest.get("usage_and_cost") if isinstance(manifest.get("usage_and_cost"), Mapping) else {}
    cost_usd = _finite(usage.get("estimated_cost_usd"))
    budget_exceeded = cost_usd is not None and cost_usd > DEFAULT_MAX_COST_USD + 1e-9
    if budget_exceeded:
        target_usable = False
        investment = None
    artifacts = {
        "full_report": str(run_dir / "research_report.md"),
        "analysis": str(run_dir / "deep_research_analysis.md"),
        "valuation": str(run_dir / "deep_research_valuation.md"),
        "manifest": str(run_dir / "research_manifest.json"),
        "evidence_ledger": str(run_dir / "evidence_ledger.json"),
        "valuation_case": str(run_dir / "valuation_case.json"),
        "compiled_result": str(run_dir / "valuation_compiled.json"),
    }
    limitations = list(compiled.get("limitations") or []) + list(compiled.get("warnings") or [])
    return {
        "status": "budget_exceeded" if budget_exceeded else grade.get("publication_status") or "amber",
        "target_usable": target_usable,
        "target_price": target if target_usable else None,
        "investment_amount": investment,
        "investment_pct": investment / 1000.0 if investment is not None else None,
        "investment_rationale": compiled.get("investment_rationale"),
        "reference_date": compiled.get("reference_date"),
        "target_date": compiled.get("target_date"),
        "horizon": "1 year",
        "currency": compiled.get("currency"),
        "rating": compiled.get("rating"),
        "methods": methods,
        "assumptions": _assumptions(case),
        "limitations": list(dict.fromkeys(str(item) for item in limitations if str(item))),
        "quality": grade,
        "provider": "deepseek",
        "models": {
            "controller": manifest.get("controller_model"),
            "helper": manifest.get("helper_model"),
        },
        "duration_seconds": manifest.get("duration_seconds"),
        "cost_usd": cost_usd,
        "unavailable_reason": (
            f"Deep Research cost ${cost_usd:.4f} exceeded the ${DEFAULT_MAX_COST_USD:.2f} cap."
            if budget_exceeded and cost_usd is not None
            else None
        ),
        "artifacts": artifacts,
        "policy_version": POLICY_VERSION,
    }

