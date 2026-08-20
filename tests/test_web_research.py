from __future__ import annotations

import json
from datetime import datetime, timezone

from ai_hedge import web_research


class FakeSearchClient:
    def news(self, query, **_kwargs):
        return [
            {
                "title": f"Recent development for {query}",
                "url": "https://news.example.com/development",
                "body": "A current news result with stakeholder reaction.",
                "source": "Example News",
                "date": "2026-08-19T09:00:00+00:00",
            }
        ]

    def text(self, query, **_kwargs):
        return [
            {
                "title": f"Primary context for {query}",
                "href": "https://company.example.com/update",
                "body": "The company published additional operating context.",
            }
        ]

    def extract(self, url, **_kwargs):
        return {"url": url, "content": f"Extracted source evidence from {url}."}


def test_two_agent_web_research_keeps_original_analysis_out_of_researcher_prompt(tmp_path):
    calls = []

    def fake_llm(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return json.dumps(
                {
                    "queries": [
                        {
                            "query": f"TEST catalyst query {idx}",
                            "research_goal": f"Resolve unknown {idx}",
                            "valuation_relevance": f"Could change assumption {idx}",
                            "focus": "news",
                        }
                        for idx in range(1, 8)
                    ]
                    + [{"query": "TEST catalyst query 1"}]
                }
            )
        return (
            "## TEST catalyst query 1\n"
            "Additive finding ([Recent development](https://news.example.com/development)).\n\n"
            "A fabricated link must be removed ([Bad](https://bad.example.com/fake)).\n\n"
            "## Cross-Query Investment Implications\nNew evidence changes the risk framing."
        )

    payload = web_research.run_web_research(
        ticker="TEST",
        company_name="Test Corp",
        analysis_text="ORIGINAL_ANALYSIS_ONLY_MARKER",
        api_key="test-key",
        output_dir=tmp_path,
        llm=fake_llm,
        search_client_factory=FakeSearchClient,
        now=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )

    assert payload["status"] == "success"
    assert len(payload["queries"]) == web_research.MAX_QUERIES
    assert len({row["query"] for row in payload["queries"]}) == web_research.MAX_QUERIES
    assert "ORIGINAL_ANALYSIS_ONLY_MARKER" in calls[0]["prompt"]
    assert "ORIGINAL_ANALYSIS_ONLY_MARKER" not in calls[1]["prompt"]
    assert "QUERY PLAN AND WEB-SEARCH TOOL EVIDENCE" in calls[1]["prompt"]
    assert "https://news.example.com/development" in payload["report_markdown"]
    assert "https://bad.example.com/fake" not in payload["report_markdown"]
    assert len(payload["sources"]) == 2
    assert (tmp_path / "TEST_web_search.json").exists()
    assert (tmp_path / "TEST_web_search.txt").exists()


def test_web_research_returns_error_artifacts_when_search_has_no_sources(tmp_path):
    class EmptySearchClient:
        def news(self, *_args, **_kwargs):
            return []

        def text(self, *_args, **_kwargs):
            return []

        def extract(self, *_args, **_kwargs):
            raise AssertionError("No source should be extracted")

    def fake_llm(**_kwargs):
        return json.dumps(
            {
                "queries": [
                    {
                        "query": "TEST customer adoption signal 2026",
                        "research_goal": "Find additive adoption evidence",
                        "valuation_relevance": "Tests growth durability",
                        "focus": "customers",
                    }
                ]
            }
        )

    payload = web_research.run_web_research(
        ticker="TEST",
        company_name="Test Corp",
        analysis_text="Completed analysis",
        api_key="test-key",
        output_dir=tmp_path,
        llm=fake_llm,
        search_client_factory=EmptySearchClient,
    )

    assert payload["status"] == "error"
    assert payload["queries"]
    assert not payload["sources"]
    assert "no usable sources" in payload["errors"][-1].lower()
    artifact = json.loads((tmp_path / "TEST_web_search.json").read_text(encoding="utf-8"))
    assert artifact["status"] == "error"


def test_web_search_markdown_contains_queries_report_and_source_index():
    markdown = web_research.build_web_search_markdown(
        {
            "status": "success",
            "queries": [
                {
                    "query": "TEST regulation update",
                    "research_goal": "Understand policy impact",
                    "valuation_relevance": "Could affect margins",
                }
            ],
            "report_markdown": "## Finding\nSourced conclusion.",
            "sources": [
                {
                    "title": "Regulator announcement",
                    "url": "https://regulator.example.org/update",
                    "publisher": "Regulator",
                    "published_at": "2026-08-20",
                }
            ],
        }
    )

    assert "# Web Search" in markdown
    assert "TEST regulation update" in markdown
    assert "Sourced conclusion" in markdown
    assert "[Regulator announcement](https://regulator.example.org/update)" in markdown


def test_search_source_urls_reject_local_and_private_network_targets():
    assert web_research._canonical_url("http://localhost/admin") == ""
    assert web_research._canonical_url("http://127.0.0.1/secrets") == ""
    assert web_research._canonical_url("http://169.254.169.254/metadata") == ""
    assert web_research._canonical_url("https://user:pass@example.com/private") == ""
    assert web_research._canonical_url("https://example.com/research#section") == "https://example.com/research"
