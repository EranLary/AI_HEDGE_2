from __future__ import annotations

from ai_hedge.sector_classifier import classify_sector, classification_context, resolve_sector_for_valuation


def test_classifier_sends_only_bounded_named_sections_and_retries_invalid_output() -> None:
    prompts: list[str] = []
    answers = iter(["Technology sector", "Technology"])

    def call(prompt: str) -> str:
        prompts.append(prompt)
        return next(answers)

    text = """# Other\nSecret unrelated text\n# What the company is doing\nBuilds chips.\n# Market Definition\nSemiconductors.\n# Risks\nOther secret."""
    assert classify_sector(ticker="T", company_name="Test", analysis_text=text, call_llm=call) == "Technology"
    assert len(prompts) == 2
    assert "Builds chips." in prompts[0]
    assert "Semiconductors." in prompts[0]
    assert "Secret unrelated" not in prompts[0]
    assert "Other secret" not in prompts[0]


def test_sector_resolution_prefers_profile_then_prior_report_after_llm_failure() -> None:
    sector, source = resolve_sector_for_valuation(
        ticker="BANK",
        info_dict={"info": {"sector": "Financial Services"}},
        analysis_text="",
        call_llm=lambda _prompt: (_ for _ in ()).throw(AssertionError("must not call")),
    )
    assert (sector, source) == ("Financial Services", "yfinance.info")

    sector, source = resolve_sector_for_valuation(
        ticker="OLD",
        info_dict={"info": {}},
        analysis_text="",
        call_llm=lambda _prompt: "invalid",
        prior_loader=lambda _ticker: "Utilities",
    )
    assert (sector, source) == ("Utilities", "report.previous_llm")


def test_context_is_empty_when_sections_are_missing() -> None:
    assert classification_context("# Risks\nNo profile") == {
        "what_the_company_is_doing": "",
        "market_definition": "",
    }
