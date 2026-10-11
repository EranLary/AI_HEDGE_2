from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from ai_hedge.deep_research.audit import (
    build_audit_prompt,
    validate_audit_arithmetic,
    valuation_audit_schema,
)
from ai_hedge.deep_research.case_builder import (
    compile_run_valuation_case,
    valuation_case_schema,
)
from ai_hedge.deep_research.broker_compiler import compile_broker_valuation_case
from ai_hedge.deep_research.broker_case import (
    BROKER_CASE_VERSION,
    broker_valuation_case_schema,
    build_broker_research_prompt,
)
from ai_hedge.deep_research.broker_research import research_broker_valuation_case
from ai_hedge.deep_research.case_audit import (
    audit_compiled_valuation_case,
    valuation_case_audit_schema,
)
from ai_hedge.deep_research.config import DeepResearchConfig
from ai_hedge.deep_research.compiler import (
    ValuationCompilationError,
    compile_valuation_case,
)
from ai_hedge.deep_research.engine import DeepResearchEngine, extract_sources
from ai_hedge.deep_research.prompt import PROMPT_VERSION, build_research_prompt
from ai_hedge.deep_research.profiles import ValuationProfile, detect_valuation_profile
from ai_hedge.deep_research.quality import evaluate_report_quality
from ai_hedge.deep_research.repair import run_repair
from ai_hedge.deep_research.selection import select_best_candidate
from ai_hedge.deep_research.snapshot import CompanySnapshot, freeze_company_snapshot
from ai_hedge.deep_research.valuation_research import research_valuation_case


def _snapshot() -> CompanySnapshot:
    return CompanySnapshot(
        ticker="IBKR",
        company_name="Interactive Brokers Group, Inc.",
        exchange="NasdaqGS",
        security_type="EQUITY",
        quote_currency="USD",
        reporting_currency="USD",
        current_price=64.25,
        as_of_utc="2026-10-03T10:00:00Z",
    )


def test_snapshot_resolves_identity_without_analysis_or_share_count() -> None:
    provider = SimpleNamespace(
        info={
            "longName": "Interactive Brokers Group, Inc.",
            "fullExchangeName": "NasdaqGS",
            "quoteType": "EQUITY",
            "currency": "USD",
            "financialCurrency": "USD",
            "currentPrice": 64.25,
            "sharesOutstanding": 1_000_000,
            "recommendationKey": "buy",
            "targetMeanPrice": 75.0,
        }
    )
    snapshot = freeze_company_snapshot(
        "ibkr",
        ticker_factory=lambda _ticker: provider,
        now=datetime(2026, 10, 3, 10, 0, tzinfo=timezone.utc),
    )

    payload = snapshot.to_dict()
    assert snapshot.ticker == "IBKR"
    assert snapshot.current_price == 64.25
    assert "shares" not in " ".join(payload).lower()
    assert "target" not in " ".join(payload).lower()
    assert "recommendation" not in " ".join(payload).lower()


def test_master_prompt_is_complete_and_independent() -> None:
    prompt = build_research_prompt(_snapshot())

    assert PROMPT_VERSION in prompt
    assert "Interactive Brokers Group, Inc. (IBKR)" in prompt
    assert "latest annual filing" in prompt
    assert "Seven sector-critical operating KPIs" in prompt
    assert "Method 1 — Intrinsic valuation" in prompt
    assert "Method 2 — Comparable-company valuation" in prompt
    assert "Method 3 — SOTP, asset, or alternative valuation" in prompt
    assert "Valuation control summary" in prompt
    assert "{{" not in prompt
    assert "AI_HEDGE" not in prompt
    assert "Match the basis: trailing peer multiples to trailing company metrics" in prompt
    assert "one common valuation basis" in prompt


def test_request_payload_uses_quality_first_responses_contract() -> None:
    config = DeepResearchConfig(
        model="gpt-5.5",
        reasoning_effort="xhigh",
        max_tool_calls=80,
        timeout_seconds=3600,
        poll_seconds=1,
    )
    engine = DeepResearchEngine(config=config, client=SimpleNamespace())
    payload = engine.request_payload(_snapshot(), run_id="run-test")

    assert payload["model"] == "gpt-5.5"
    assert payload["reasoning"] == {"effort": "xhigh"}
    assert payload["background"] is True
    assert payload["max_tool_calls"] == 80
    assert payload["include"] == ["web_search_call.action.sources"]
    assert payload["tools"][0] == {
        "type": "web_search",
        "return_token_budget": "unlimited",
    }
    assert payload["tools"][1]["type"] == "code_interpreter"
    assert "OPENAI_API_KEY" not in json.dumps(payload)


def test_dry_run_writes_auditable_artifacts_without_api_key(tmp_path: Path) -> None:
    engine = DeepResearchEngine(
        config=DeepResearchConfig(poll_seconds=1),
        now=lambda: datetime(2026, 10, 3, 10, 0, tzinfo=timezone.utc),
    )
    result = engine.run(_snapshot(), output_root=tmp_path, dry_run=True)

    assert result.status == "dry_run"
    assert result.prompt_path.exists()
    request = json.loads((result.output_dir / "request.json").read_text(encoding="utf-8"))
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert request["background"] is True
    assert manifest["prompt_version"] == PROMPT_VERSION
    assert manifest["response_id"] == ""
    assert not result.report_path.exists()


class _FakeResponses:
    def __init__(self) -> None:
        self.create_payload = None
        self.retrieve_calls = 0

    def create(self, **payload):
        self.create_payload = payload
        return SimpleNamespace(id="resp_test", status="queued")

    def retrieve(self, response_id: str, **_kwargs):
        assert response_id == "resp_test"
        self.retrieve_calls += 1
        if self.retrieve_calls == 1:
            return SimpleNamespace(id="resp_test", status="in_progress")
        return SimpleNamespace(
            id="resp_test",
            status="completed",
            model="gpt-5.5-2026-04-24",
            output_text="# Institutional report\n\nCompleted research.",
            usage=SimpleNamespace(input_tokens=100, output_tokens=200),
            error=None,
            incomplete_details=None,
            output=[
                {
                    "type": "web_search_call",
                    "action": {
                        "type": "search",
                        "sources": [
                            {
                                "url": "https://www.sec.gov/Archives/example",
                                "title": "SEC filing",
                            }
                        ],
                    },
                },
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "Completed research.",
                            "annotations": [
                                {
                                    "type": "url_citation",
                                    "url": "https://www.sec.gov/Archives/example",
                                    "title": "SEC filing",
                                    "start_index": 0,
                                    "end_index": 8,
                                }
                            ],
                        }
                    ],
                },
            ],
        )


def test_live_run_polls_and_persists_response_sources_and_usage(tmp_path: Path) -> None:
    responses = _FakeResponses()
    client = SimpleNamespace(responses=responses)
    engine = DeepResearchEngine(
        config=DeepResearchConfig(poll_seconds=0.01),
        client=client,
        sleep=lambda _seconds: None,
    )

    result = engine.run(_snapshot(), output_root=tmp_path)

    assert result.status == "completed"
    assert result.response_id == "resp_test"
    assert responses.retrieve_calls == 2
    assert result.report_path.read_text(encoding="utf-8").startswith(
        "# Institutional report"
    )
    sources = json.loads(result.sources_path.read_text(encoding="utf-8"))["sources"]
    assert sources == [
        {
            "url": "https://www.sec.gov/Archives/example",
            "title": "SEC filing",
            "consulted": True,
            "cited": True,
            "citation_spans": [{"start_index": 0, "end_index": 8}],
        }
    ]
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest["model_actual"] == "gpt-5.5-2026-04-24"
    assert manifest["usage"] == {"input_tokens": 100, "output_tokens": 200}


def test_repair_is_a_fresh_rebuild_not_a_chained_response(tmp_path: Path) -> None:
    responses = _FakeResponses()
    client = SimpleNamespace(responses=responses)
    audit = {
        "issues": [
            {
                "severity": "major",
                "category": "valuation_method",
                "description": "The comparable basis is inconsistent.",
                "report_evidence": "TTM peer P/E was applied to forward EPS.",
            },
            {
                "severity": "minor",
                "category": "writing",
                "description": "A sentence is wordy.",
                "report_evidence": "Example.",
            },
        ],
        "deterministic_arithmetic": {"usable_target": False},
    }

    result = run_repair(
        client=client,
        config=DeepResearchConfig(poll_seconds=0.01),
        snapshot=_snapshot(),
        run_dir=tmp_path,
        previous_response_id="resp_prior",
        audit=audit,
        attempt=1,
        sleep=lambda _seconds: None,
    )

    assert result.status == "completed"
    assert "previous_response_id" not in responses.create_payload
    assert "Mandatory fresh-rebuild quality packet" in responses.create_payload["input"]
    assert "The comparable basis is inconsistent" in responses.create_payload["input"]
    assert "A sentence is wordy" not in responses.create_payload["input"]
    manifest = json.loads(
        (tmp_path / result.manifest_filename).read_text(encoding="utf-8")
    )
    assert manifest["mode"] == "fresh-rebuild"
    assert manifest["previous_response_id"] == "resp_prior"


def test_candidate_selection_never_promotes_a_regressing_latest_repair(
    tmp_path: Path,
) -> None:
    def write_candidate(suffix: str, score: int, major: int, passed: bool) -> None:
        (tmp_path / f"research_report{suffix}.md").write_text(
            "# Report\n", encoding="utf-8"
        )
        (tmp_path / f"research_quality{suffix}.json").write_text(
            json.dumps({"score": 100, "passed": True}), encoding="utf-8"
        )
        issues = [
            {
                "severity": "major",
                "category": "valuation_method",
                "description": f"Issue {index}",
                "report_evidence": "Evidence",
            }
            for index in range(major)
        ]
        (tmp_path / f"research_audit{suffix}.json").write_text(
            json.dumps(
                {
                    "overall_quality_score": score,
                    "issues": issues,
                    "valuation": {
                        "target_price": 100.0,
                        "recommendation": "Hold",
                    },
                    "deterministic_arithmetic": {"usable_target": passed},
                }
            ),
            encoding="utf-8",
        )

    write_candidate("", score=82, major=0, passed=True)
    write_candidate("_repair_1", score=40, major=3, passed=False)

    selection = select_best_candidate(tmp_path)

    assert selection["selected_candidate"] == "base"
    assert selection["publication_ready"] is False
    assert (tmp_path / "research_selection.json").exists()


def _compiler_case() -> dict:
    return {
        "currency": "USD",
        "reference_date": "2026-10-03",
        "reference_price": 80.0,
        "reference_price_evidence_id": "reference_price",
        "target_date": "2027-10-03",
        "diluted_shares": 100.0,
        "diluted_shares_evidence_id": "diluted_shares",
        "evidence": [
            {
                "id": "reference_price",
                "kind": "market_observation",
                "value": 80.0,
                "unit": "USD/share",
                "as_of_date": "2026-10-03T10:00:00Z",
                "source_url": "https://example.com/reference-price",
            },
            {
                "id": "diluted_shares",
                "kind": "analyst_assumption",
                "value": 100.0,
                "unit": "million shares",
                "as_of_date": "2026-10-03",
                "rationale": "Current basic shares plus incremental dilution.",
            },
            {
                "id": "discount_rate",
                "kind": "analyst_assumption",
                "value": 0.10,
                "as_of_date": "2026-10-03",
                "rationale": "CAPM components are compiled in the evidence workbook.",
            },
            {
                "id": "terminal_growth",
                "kind": "analyst_assumption",
                "value": 0.03,
                "as_of_date": "2026-10-03",
                "rationale": "Below nominal long-run growth.",
            },
            {
                "id": "risk_free",
                "kind": "market_observation",
                "value": 4.0,
                "unit": "percent",
                "as_of_date": "2026-10-03",
                "source_url": "https://example.com/risk-free",
            },
            {
                "id": "beta",
                "kind": "market_observation",
                "value": 1.2,
                "unit": "x",
                "as_of_date": "2026-10-03",
                "source_url": "https://example.com/beta",
            },
            {
                "id": "erp",
                "kind": "analyst_assumption",
                "value": 5.0,
                "unit": "percent",
                "as_of_date": "2026-10-03",
                "rationale": "Conservative long-run market premium.",
            },
            {
                "id": "forward_eps",
                "kind": "third_party_estimate",
                "value": 4.0,
                "as_of_date": "2026-10-03",
                "source_url": "https://example.com/forward-eps",
            },
            {
                "id": "forward_peer_pe",
                "kind": "market_observation",
                "value": 20.0,
                "as_of_date": "2026-10-03",
                "source_url": "https://example.com/forward-peer-pe",
            },
            {
                "id": "forward_peer_pe_low",
                "kind": "market_observation",
                "value": 18.0,
                "as_of_date": "2026-10-03",
                "source_url": "https://example.com/forward-peer-pe-low",
            },
            {
                "id": "forward_peer_pe_high",
                "kind": "market_observation",
                "value": 22.0,
                "as_of_date": "2026-10-03",
                "source_url": "https://example.com/forward-peer-pe-high",
            },
            {
                "id": "peer_premium",
                "kind": "analyst_assumption",
                "value": 0.10,
                "as_of_date": "2026-10-03",
                "rationale": "Higher growth and margins than the peer median.",
            },
        ],
        "methods": [
            {
                "name": "FCFE",
                "type": "fcfe",
                "value_date": "2027-10-03",
                "weight_pct": 50.0,
                "weight_rationale": "Primary cash-flow method with adequate evidence.",
                "evidence_ids": [
                    "discount_rate",
                    "terminal_growth",
                    "risk_free",
                    "beta",
                    "erp",
                ],
                "discount_rate_evidence_id": "discount_rate",
                "discount_rate_formula": "capm",
                "discount_rate_rationale": None,
                "risk_free_evidence_id": "risk_free",
                "beta_evidence_id": "beta",
                "equity_risk_premium_evidence_id": "erp",
                "additional_premium_evidence_id": None,
                "terminal_growth_evidence_id": "terminal_growth",
                "cash_flows_per_share": [
                    {
                        "date": "2028-10-03",
                        "amount": 5.0,
                        "rationale": "First explicit forecast year.",
                        "evidence_ids": ["forward_eps"],
                    },
                    {
                        "date": "2029-10-03",
                        "amount": 5.5,
                        "rationale": "Growth fades toward the terminal state.",
                        "evidence_ids": ["forward_eps"],
                    },
                ],
            },
            {
                "name": "Forward P/E",
                "type": "multiple",
                "value_date": "2027-10-03",
                "weight_pct": 50.0,
                "weight_rationale": "Independent market cross-check.",
                "evidence_ids": [
                    "forward_eps",
                    "forward_peer_pe_low",
                    "forward_peer_pe",
                    "forward_peer_pe_high",
                    "peer_premium",
                ],
                "peer_metric_basis": "forward",
                "subject_metric_basis": "forward",
                "subject_metric_evidence_id": "forward_eps",
                "peer_statistic_evidence_id": "forward_peer_pe",
                "peer_multiple_evidence_ids": [
                    "forward_peer_pe_low",
                    "forward_peer_pe",
                    "forward_peer_pe_high",
                ],
                "premium_discount_evidence_id": "peer_premium",
                "applied_multiple": 22.0,
            },
        ],
    }


def test_valuation_compiler_recomputes_methods_consensus_and_return() -> None:
    result = compile_valuation_case(_compiler_case())

    expected_dcf = 5.0 / 1.1 + 5.5 / (1.1**2) + (5.5 * 1.03 / 0.07) / (1.1**2)
    assert result.methods[0].value_per_share == pytest.approx(expected_dcf, rel=0.001)
    assert result.methods[1].value_per_share == pytest.approx(88.0)
    expected_target = (expected_dcf + 88.0) / 2
    assert result.target_price == pytest.approx(expected_target, rel=0.001)
    assert result.upside_downside_pct == pytest.approx(
        (result.target_price / 80.0 - 1) * 100.0
    )


def test_valuation_compiler_rejects_mixed_dates_and_multiple_basis() -> None:
    case = _compiler_case()
    case["methods"][1]["value_date"] = "2026-10-03"
    case["methods"][1]["subject_metric_basis"] = "trailing"

    with pytest.raises(ValuationCompilationError) as exc_info:
        compile_valuation_case(case)

    assert any("does not match target_date" in issue for issue in exc_info.value.issues)
    assert any("mixes forward peer multiples with trailing" in issue for issue in exc_info.value.issues)


def test_valuation_compiler_rejects_unsourced_facts_and_non_going_concern_weight() -> None:
    case = _compiler_case()
    case["evidence"].append(
        {
            "id": "book_anchor",
            "kind": "reported_fact",
            "value": 15.0,
            "as_of_date": "2026-06-30",
            "source_url": "",
        }
    )
    case["evidence"].append(
        {
            "id": "haircut",
            "kind": "analyst_assumption",
            "value": -0.05,
            "as_of_date": "2026-10-03",
            "rationale": "Liquidation friction.",
        }
    )
    case["methods"][0]["weight_pct"] = 45.0
    case["methods"][1]["weight_pct"] = 45.0
    case["methods"].append(
        {
            "name": "Liquidation anchor",
            "type": "asset",
            "value_date": "2027-10-03",
            "weight_pct": 10.0,
            "weight_rationale": "Purported downside method.",
            "evidence_ids": ["book_anchor", "haircut"],
            "going_concern_value": False,
            "asset_value_per_share_evidence_id": "book_anchor",
            "adjustment_evidence_id": "haircut",
        }
    )

    with pytest.raises(ValuationCompilationError) as exc_info:
        compile_valuation_case(case)

    assert any("requires an exact source URL" in issue for issue in exc_info.value.issues)
    assert any("cannot receive positive target weight" in issue for issue in exc_info.value.issues)


def test_valuation_case_schema_is_strict_at_nested_boundaries() -> None:
    schema = valuation_case_schema()

    assert schema["additionalProperties"] is False
    evidence = schema["properties"]["evidence"]["items"]
    method = schema["properties"]["methods"]["items"]
    cash_flow = method["properties"]["cash_flows_per_share"]["items"]
    period = method["properties"]["periods"]["items"]
    assert evidence["additionalProperties"] is False
    assert method["additionalProperties"] is False
    assert cash_flow["additionalProperties"] is False
    assert period["additionalProperties"] is False


def test_case_extraction_is_followed_by_deterministic_compilation(tmp_path: Path) -> None:
    valuation_case = _compiler_case()
    valuation_case["case_version"] = "model-output"
    response = SimpleNamespace(output_text=json.dumps(valuation_case))
    client = SimpleNamespace(
        responses=SimpleNamespace(create=lambda **_payload: response)
    )
    (tmp_path / "research_report.md").write_text("# Report\n", encoding="utf-8")
    (tmp_path / "research_sources.json").write_text(
        json.dumps({"sources": []}), encoding="utf-8"
    )

    payload, valid = compile_run_valuation_case(
        client=client,
        run_dir=tmp_path,
        snapshot=_snapshot(),
        model="gpt-5.5",
        reasoning_effort="high",
    )

    assert valid is True
    assert payload["compiled"]["target_price"] > 0
    saved_case = json.loads((tmp_path / "valuation_case.json").read_text("utf-8"))
    assert saved_case["case_version"] == "valuation-case-v1"
    assert (tmp_path / "valuation_compiled.json").exists()


def test_structured_valuation_research_uses_tools_then_compiles(tmp_path: Path) -> None:
    valuation_case = _compiler_case()
    valuation_case["case_version"] = "model-output"

    class Responses:
        def __init__(self) -> None:
            self.payload = None

        def create(self, **payload):
            self.payload = payload
            return SimpleNamespace(id="resp_value", status="queued")

        def retrieve(self, response_id: str, **_kwargs):
            assert response_id == "resp_value"
            return SimpleNamespace(
                id="resp_value",
                status="completed",
                model="gpt-5.5-test",
                output_text=json.dumps(valuation_case),
                output=[],
                usage=SimpleNamespace(input_tokens=10, output_tokens=20),
            )

    responses = Responses()
    result = research_valuation_case(
        client=SimpleNamespace(responses=responses),
        config=DeepResearchConfig(poll_seconds=0.01),
        snapshot=_snapshot(),
        run_dir=tmp_path,
        report="# Research",
        audit={"issues": []},
        extracted_case={},
        compile_issues=["missing source"],
        sleep=lambda _seconds: None,
    )

    assert result.compiled is True
    assert responses.payload["background"] is True
    assert responses.payload["tools"][0]["type"] == "web_search"
    assert responses.payload["text"]["format"]["strict"] is True
    assert (tmp_path / result.compiled_filename).exists()


def test_valuation_case_audit_schema_is_strict() -> None:
    schema = valuation_case_audit_schema()

    assert schema["additionalProperties"] is False
    issue = schema["properties"]["issues"]["items"]
    assert issue["additionalProperties"] is False
    assert "required_correction" in issue["required"]


def test_valuation_case_audit_requires_no_major_issues_for_publication(
    tmp_path: Path,
) -> None:
    output = {
        "audit_version": "model-output",
        "strengths": ["Arithmetic is compiled."],
        "issues": [],
        "quality_score": 90,
    }

    class Responses:
        def create(self, **_payload):
            return SimpleNamespace(id="resp_audit", status="queued")

        def retrieve(self, response_id: str, **_kwargs):
            assert response_id == "resp_audit"
            return SimpleNamespace(
                id="resp_audit",
                status="completed",
                model="gpt-5.5-test",
                output_text=json.dumps(output),
                output=[],
                usage=None,
            )

    audit, ready = audit_compiled_valuation_case(
        client=SimpleNamespace(responses=Responses()),
        config=DeepResearchConfig(poll_seconds=0.01),
        snapshot=_snapshot(),
        run_dir=tmp_path,
        valuation_case=_compiler_case(),
        compiled={"target_price": 100.0},
        attempt=1,
        sleep=lambda _seconds: None,
    )

    assert ready is True
    assert audit["publication_ready"] is True
    assert (tmp_path / "valuation_case_audit_1.json").exists()


def _broker_case() -> dict:
    evidence: list[dict] = []

    def add(
        evidence_id: str,
        value: float,
        *,
        unit: str = "USD million",
        assumption: bool = True,
    ) -> str:
        row = {
            "id": evidence_id,
            "kind": "analyst_assumption" if assumption else "reported_fact",
            "value": value,
            "unit": unit,
            "as_of_date": "2026-10-03",
        }
        if assumption:
            row["rationale"] = f"Driver assumption for {evidence_id}."
        else:
            row["source_url"] = f"https://example.com/{evidence_id}"
        evidence.append(row)
        return evidence_id

    price_id = add("price", 80.0, unit="USD/share", assumption=False)
    basic_shares_id = add("basic_shares", 98.0, unit="million shares", assumption=False)
    incremental_dilution_id = add(
        "incremental_dilution", 2.0, unit="million shares"
    )
    shares_id = add("shares", 100.0, unit="million shares")
    book_id = add("book", 500.0, assumption=False)
    discount_id = add("cost_equity", 10.0, unit="percent")
    risk_free_id = add("risk_free", 4.0, unit="percent", assumption=False)
    beta_id = add("beta", 1.2, unit="x", assumption=False)
    erp_id = add("erp", 5.0, unit="percent")
    growth_id = add("terminal_growth", 3.0, unit="percent")
    terminal_roe_id = add("terminal_roe", 15.0, unit="percent")
    interim_dividends_id = add("interim_dividends", 1.0)
    bridge_ids = {
        "parent_net_income_evidence_id": add("bridge_parent_income", 30.0),
        "dividends_evidence_id": add("bridge_dividends", 10.0),
        "oci_evidence_id": add("bridge_oci", 0.0),
        "share_comp_and_issuance_evidence_id": add("bridge_share_flows", 0.0),
        "ownership_exchange_equity_evidence_id": add("bridge_exchange", 0.0),
        "tax_tra_evidence_id": add("bridge_tax_tra", 0.0),
        "other_equity_flows_evidence_id": add("bridge_other", 0.0),
    }

    periods = []
    period_specs = (
        (2026, "2026-06-30", "2026-12-31", 127.0, 0.0),
        (2027, "2026-12-31", "2027-12-31", 250.0, 10.0),
        (2028, "2027-12-31", "2028-12-31", 251.0, 20.0),
    )
    for year, start_date, end_date, trading_days, net_income_step in period_specs:
        ids = {
            "margin_loans_evidence_id": add(f"margin_loans_{year}", 1000 + 100 * net_income_step),
            "margin_net_yield_evidence_id": add(
                f"margin_yield_{year}", 4.0, unit="percent"
            ),
            "segregated_cash_securities_balance_evidence_id": add(
                f"segregated_balance_{year}", 1500.0
            ),
            "segregated_cash_securities_yield_evidence_id": add(
                f"segregated_yield_{year}", 3.0, unit="percent"
            ),
            "client_credit_ex_sweep_balances_evidence_id": add(
                f"credits_{year}", 2000.0
            ),
            "client_credit_cost_yield_evidence_id": add(
                f"credit_cost_yield_{year}", 1.0, unit="percent"
            ),
            "securities_lending_income_evidence_id": add(
                f"securities_lending_{year}", 15.0
            ),
            "fdic_sweep_income_evidence_id": add(f"fdic_sweep_{year}", 5.0),
            "other_nii_evidence_id": add(f"other_nii_{year}", 20.0),
            "average_daily_revenue_trades_evidence_id": add(
                f"darts_{year}", 0.4, unit="million trades/day"
            ),
            "trading_days_evidence_id": add(
                f"trading_days_{year}", trading_days, unit="days"
            ),
            "commission_per_dart_evidence_id": add(
                f"commission_{year}", 1.0, unit="USD/trade"
            ),
            "other_revenue_evidence_id": add(f"other_revenue_{year}", 50.0),
            "non_interest_expense_evidence_id": add(f"expense_{year}", 100.0),
            "tax_rate_evidence_id": add(f"tax_{year}", 20.0, unit="percent"),
            "public_economic_share_evidence_id": add(
                f"public_share_{year}", 100.0, unit="percent"
            ),
            "other_parent_income_evidence_id": add(f"parent_items_{year}", 0.0),
            "dividends_evidence_id": add(f"dividends_{year}", 50.0),
            "other_equity_flows_evidence_id": add(f"equity_flows_{year}", 0.0),
        }
        periods.append(
            {
                "start_date": start_date,
                "end_date": end_date,
                "rationale": "Driver-based forecast using balances, yields, activity and costs.",
                "evidence_ids": list(ids.values()),
                **ids,
            }
        )

    subject_eps = add("subject_eps", 4.0, unit="USD/share")
    premium = add("peer_premium", 0.0, unit="decimal")
    peers = []
    for ticker, price, eps in (
        ("AAA", 60.0, 3.0),
        ("BBB", 80.0, 4.0),
        ("CCC", 100.0, 5.0),
        ("DDD", 120.0, 6.0),
        ("EEE", 140.0, 7.0),
    ):
        peer_price = add(f"{ticker}_price", price, unit="USD/share", assumption=False)
        peer_eps = add(f"{ticker}_eps", eps, unit="USD/share")
        peers.append(
            {
                "ticker": ticker,
                "price_evidence_id": peer_price,
                "eps_evidence_id": peer_eps,
                "eps_period_end": "2027-12-31",
                "eps_basis": "ttm_gaap",
                "comparability_rationale": "Comparable regulated brokerage economics.",
            }
        )

    return {
        "currency": "USD",
        "valuation_date": "2026-10-03",
        "reference_price": 80.0,
        "reference_price_evidence_id": price_id,
        "basic_shares": 98.0,
        "basic_shares_evidence_id": basic_shares_id,
        "incremental_dilution": 2.0,
        "incremental_dilution_evidence_id": incremental_dilution_id,
        "diluted_shares": 100.0,
        "diluted_shares_evidence_id": shares_id,
        "dilution_method": "treasury_stock",
        "dilution_rationale": "Point-in-time award dilution added to basic shares.",
        "evidence": evidence,
        "intrinsic_method": {
            "weight_pct": 50.0,
            "weight_rationale": "Primary public-equity intrinsic method.",
            "reported_parent_book_equity_evidence_id": book_id,
            "reported_book_date": "2026-06-30",
            "interim_dividends_evidence_id": interim_dividends_id,
            "discount_rate_evidence_id": discount_id,
            "cost_of_equity_evidence_id": discount_id,
            "discount_rate_formula": "capm",
            "discount_rate_rationale": None,
            "risk_free_evidence_id": risk_free_id,
            "beta_evidence_id": beta_id,
            "equity_risk_premium_evidence_id": erp_id,
            "additional_premium_evidence_id": None,
            "terminal_growth_evidence_id": growth_id,
            "terminal_roe_evidence_id": terminal_roe_id,
            "terminal_roe_bridge_rationale": "ROE fades to a stable mature level.",
            "terminal_capital_policy_rationale": "Payout rises as growth matures.",
            "forecast_periods": periods,
        },
        "comparable_method": {
            "weight_pct": 50.0,
            "weight_rationale": "Matched-period independent market cross-check.",
            "subject_eps_evidence_id": subject_eps,
            "subject_eps_period_end": "2027-12-31",
            "subject_eps_basis": "ttm_gaap",
            "premium_discount_evidence_id": premium,
            "peers": peers,
        },
    }


def test_broker_compiler_builds_income_from_drivers_and_matched_peer_eps() -> None:
    result = compile_broker_valuation_case(_broker_case())

    assert result.target_date == result.reference_date == "2026-10-03"
    assert result.methods[0].method_type == "broker_residual_income"
    assert result.methods[1].value_per_share == pytest.approx(80.0)
    assert result.target_price > 0


def test_broker_compiler_rejects_misaligned_book_and_peer_periods() -> None:
    case = _broker_case()
    case["intrinsic_method"]["reported_book_date"] = "2026-10-04"
    case["comparable_method"]["peers"][0]["eps_period_end"] = "2026-12-31"

    with pytest.raises(ValuationCompilationError) as exc_info:
        compile_broker_valuation_case(case)

    assert any("reported_book_date cannot be after" in issue for issue in exc_info.value.issues)
    assert any("EPS period does not match" in issue for issue in exc_info.value.issues)


def test_broker_compiler_rejects_monetary_and_share_scale_mismatch() -> None:
    case = _broker_case()
    shares = next(row for row in case["evidence"] if row["id"] == "shares")
    shares["unit"] = "shares"

    with pytest.raises(ValuationCompilationError) as exc_info:
        compile_broker_valuation_case(case)

    assert any("different scale" in issue for issue in exc_info.value.issues)


def test_broker_compiler_accepts_dart_as_trade_unit_synonym() -> None:
    case = _broker_case()
    for row in case["evidence"]:
        if row["id"].startswith("darts_"):
            row["unit"] = "million DARTs/day"
        elif row["id"].startswith("commission_"):
            row["unit"] = "USD/DART or commissionable order"

    result = compile_broker_valuation_case(case)

    assert result.target_price > 0


def test_broker_compiler_rejects_overlapping_period_and_free_public_share_accretion() -> None:
    case = _broker_case()
    second = case["intrinsic_method"]["forecast_periods"][1]
    second["start_date"] = "2026-12-30"
    public_share_id = second["public_economic_share_evidence_id"]
    public_share = next(row for row in case["evidence"] if row["id"] == public_share_id)
    public_share["value"] = 95.0

    with pytest.raises(ValuationCompilationError) as exc_info:
        compile_broker_valuation_case(case)

    assert any("start_date must equal prior boundary" in issue for issue in exc_info.value.issues)
    assert any("public economic share changes" in issue for issue in exc_info.value.issues)


def test_broker_compiler_rejects_unreconciled_dilution_and_annualized_quarter_eps() -> None:
    case = _broker_case()
    case["incremental_dilution"] = 3.0
    subject_eps_id = case["comparable_method"]["subject_eps_evidence_id"]
    subject_eps = next(row for row in case["evidence"] if row["id"] == subject_eps_id)
    subject_eps["unit"] = "USD/share annualized quarter"

    with pytest.raises(ValuationCompilationError) as exc_info:
        compile_broker_valuation_case(case)

    assert any("incremental_dilution does not reconcile" in issue for issue in exc_info.value.issues)
    assert any("annualized single-quarter" in issue for issue in exc_info.value.issues)


def test_broker_schema_is_strict_through_nested_driver_and_peer_objects() -> None:
    schema = broker_valuation_case_schema()

    assert schema["additionalProperties"] is False
    intrinsic = schema["properties"]["intrinsic_method"]
    assert intrinsic["additionalProperties"] is False
    period = intrinsic["properties"]["forecast_periods"]["items"]
    assert period["additionalProperties"] is False
    peer = schema["properties"]["comparable_method"]["properties"]["peers"]["items"]
    assert peer["additionalProperties"] is False
    assert intrinsic["properties"]["forecast_periods"]["minItems"] == 3


def test_broker_prompt_requires_current_date_scope_units_and_driver_forecasts() -> None:
    prompt = build_broker_research_prompt(
        snapshot=_snapshot(),
        report="IBKR earns net interest income from margin loans.",
        narrative_audit={"issues": []},
    )

    assert "CURRENT FAIR VALUE" in prompt
    assert "same date" in prompt
    assert "Up-C" in prompt
    assert "USD millions must pair with millions of shares" in prompt
    assert "average daily revenue trades x trading days" in prompt
    assert "opaque forward-P/E" in prompt


def test_valuation_profile_router_requires_multiple_broker_signals_and_allows_override() -> None:
    assert (
        detect_valuation_profile(
            _snapshot(),
            "Margin loans and DARTs drive net interest income and commissions.",
        )
        is ValuationProfile.BROKER
    )
    assert (
        detect_valuation_profile(_snapshot(), "The company mentioned its broker once.")
        is ValuationProfile.GENERIC
    )
    assert (
        detect_valuation_profile(_snapshot(), "Ordinary manufacturer", requested="broker")
        is ValuationProfile.BROKER
    )


def test_broker_research_compiles_strict_response_and_retains_manifest(tmp_path: Path) -> None:
    case = _broker_case()
    case["case_version"] = BROKER_CASE_VERSION

    class Responses:
        def create(self, **payload):
            assert payload["text"]["format"]["schema"]["additionalProperties"] is False
            assert payload["background"] is True
            return SimpleNamespace(
                id="resp_broker",
                status="completed",
                model="gpt-test",
                output_text=json.dumps(case),
                output=[],
                usage={"input_tokens": 100, "output_tokens": 50},
            )

    result = research_broker_valuation_case(
        client=SimpleNamespace(responses=Responses()),
        config=DeepResearchConfig(poll_seconds=0.01),
        snapshot=_snapshot(),
        run_dir=tmp_path,
        report="Margin loans, DARTs, net interest income and commissions.",
        narrative_audit={"issues": []},
        sleep=lambda _seconds: None,
    )

    assert result.compiled is True
    compiled = json.loads((tmp_path / result.compiled_filename).read_text(encoding="utf-8"))
    assert compiled["compiler_version"]
    manifest = json.loads((tmp_path / result.manifest_filename).read_text(encoding="utf-8"))
    assert manifest["case_version"] == BROKER_CASE_VERSION
    assert manifest["compiled"] is True


def test_extract_sources_deduplicates_consulted_and_cited_urls() -> None:
    response = SimpleNamespace(
        output=[
            {
                "type": "web_search_call",
                "action": {
                    "sources": [
                        {"url": "https://example.com/page#section", "title": "A"}
                    ]
                },
            },
            {
                "type": "message",
                "content": [
                    {
                        "annotations": [
                            {
                                "type": "url_citation",
                                "url": "https://example.com/page",
                                "title": "A cited",
                                "start_index": 3,
                                "end_index": 9,
                            }
                        ]
                    }
                ],
            },
        ]
    )

    assert extract_sources(response) == [
        {
            "url": "https://example.com/page",
            "title": "A",
            "consulted": True,
            "cited": True,
            "citation_spans": [{"start_index": 3, "end_index": 9}],
        }
    ]


def test_quality_gate_requires_depth_sources_and_valuation_controls() -> None:
    headings = "\n".join(f"## {marker.title()}" for marker in (
        "Business in plain language",
        "Economic and business model",
        "Financial analysis",
        "Accounting",
        "Market and competitive",
        "Operating KPI",
        "Public peers",
        "Competitive moat",
        "The stock",
        "Customers",
        "Management",
        "Material event",
        "Opportunities",
        "SWOT",
        "Forward-monitoring",
        "Valuation basis",
        "Intrinsic valuation",
        "Comparable-company valuation",
        "SOTP",
        "Weighted fair value",
        "Valuation control summary",
        "Final investment decision",
    ))
    report = (
        headings
        + "\n\n"
        + "sensitivity enterprise value equity value diluted target price upside "
        + ("analysis evidence valuation assumption cash flow risk return " * 700)
    )
    sources = [
        {
            "url": f"https://example.com/{index}",
            "cited": index < 12,
            "consulted": True,
        }
        for index in range(18)
    ]

    result = evaluate_report_quality(report, sources)

    assert result.passed is True
    assert result.score == 100


def test_structured_audit_schema_is_strict_at_every_object_boundary() -> None:
    schema = valuation_audit_schema()

    assert schema["additionalProperties"] is False
    assert schema["properties"]["identity"]["additionalProperties"] is False
    assert schema["properties"]["coverage"]["additionalProperties"] is False
    assert schema["properties"]["valuation"]["additionalProperties"] is False
    method = schema["properties"]["valuation"]["properties"]["methods"]["items"]
    assert method["additionalProperties"] is False
    issue = schema["properties"]["issues"]["items"]
    assert issue["additionalProperties"] is False


def test_audit_prompt_contains_report_and_source_index_without_existing_model() -> None:
    prompt = build_audit_prompt(
        _snapshot(),
        "# Report\nTarget price is $100.",
        [{"title": "SEC", "url": "https://sec.gov/x", "cited": True}],
    )

    assert "Target price is $100" in prompt
    assert "https://sec.gov/x" in prompt
    assert "also_in_expanded_search_log" in prompt
    assert "false does NOT mean the source" in prompt
    assert "AI_HEDGE" not in prompt


def test_arithmetic_audit_recomputes_weighted_target_and_return() -> None:
    payload = {
        "valuation": {
            "reference_price": 80.0,
            "target_price": 110.0,
            "upside_downside_pct": 37.5,
            "currency": "USD",
            "diluted_shares_used": 100_000_000,
            "methods": [
                {
                    "name": "Intrinsic",
                    "value_per_share": 120.0,
                    "weight_pct": 50.0,
                    "used_in_final": True,
                    "currency": "USD",
                },
                {
                    "name": "Comps",
                    "value_per_share": 100.0,
                    "weight_pct": 50.0,
                    "used_in_final": True,
                    "currency": "USD",
                },
            ],
        },
        "issues": [],
    }

    result = validate_audit_arithmetic(payload, _snapshot())

    assert result.usable_target is True
    assert result.recomputed_target_price == 110.0
    assert result.recomputed_upside_downside_pct == pytest.approx(37.5)
    assert result.effective_weight_pct == 100.0
    assert result.issues == ()


def test_arithmetic_audit_rejects_non_reconciling_target_and_currency() -> None:
    payload = {
        "valuation": {
            "reference_price": 80.0,
            "target_price": 200.0,
            "upside_downside_pct": 10.0,
            "currency": "EUR",
            "diluted_shares_used": None,
            "methods": [
                {
                    "name": "Intrinsic",
                    "value_per_share": 100.0,
                    "weight_pct": 40.0,
                    "used_in_final": True,
                    "currency": "EUR",
                }
            ],
        },
        "issues": [],
    }

    result = validate_audit_arithmetic(payload, _snapshot())

    assert result.usable_target is False
    categories = {issue["category"] for issue in result.issues}
    assert {"arithmetic", "currency", "share_count"}.issubset(categories)


def test_arithmetic_audit_marks_major_semantic_issue_amber_but_usable() -> None:
    payload = {
        "valuation": {
            "reference_price": 80.0,
            "target_price": 100.0,
            "upside_downside_pct": 25.0,
            "currency": "USD",
            "diluted_shares_used": 100_000_000,
            "methods": [
                {
                    "name": "Intrinsic",
                    "value_per_share": 100.0,
                    "weight_pct": 100.0,
                    "used_in_final": True,
                    "currency": "USD",
                }
            ],
        },
        "issues": [
            {
                "severity": "major",
                "category": "valuation_method",
                "description": "Period mismatch",
            }
        ],
    }

    result = validate_audit_arithmetic(payload, _snapshot())

    assert result.usable_target is True
    assert result.publication_status == "amber"


def test_arithmetic_audit_blocks_critical_material_semantic_issue() -> None:
    payload = {
        "valuation": {
            "reference_price": 80.0,
            "target_price": 100.0,
            "upside_downside_pct": 25.0,
            "currency": "USD",
            "diluted_shares_used": 100_000_000,
            "methods": [
                {
                    "name": "Intrinsic",
                    "value_per_share": 100.0,
                    "weight_pct": 100.0,
                    "used_in_final": True,
                    "currency": "USD",
                }
            ],
        },
        "issues": [
            {
                "severity": "critical",
                "category": "arithmetic",
                "description": "Material formula mismatch",
            }
        ],
    }

    result = validate_audit_arithmetic(payload, _snapshot())

    assert result.usable_target is False
    assert result.publication_status == "red"
    assert result.hard_blockers


@pytest.mark.parametrize("ticker", ["", "../AAPL", "AAPL USD", "A" * 33])
def test_snapshot_rejects_unsafe_ticker_formats(ticker: str) -> None:
    with pytest.raises(ValueError):
        freeze_company_snapshot(ticker, ticker_factory=lambda _ticker: SimpleNamespace(info={}))
