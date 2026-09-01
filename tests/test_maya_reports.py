from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

from ai_hedge import maya_reports
from ai_hedge.service import _build_sec_text_payload


def test_latest_filing_full_text_routes_ta_to_maya():
    from ai_hedge import legacy_port

    with patch("ai_hedge.maya_reports.fetch_latest_maya_reports", return_value={"MAYA Annual Report": {"text": "x"}}) as p_maya, patch(
        "ai_hedge.legacy_port._latest_filing_full_text_sec", return_value={"10-K": {"text": "sec"}}
    ) as p_sec:
        out_ta = legacy_port.latest_filing_full_text("STRS.TA")
        out_us = legacy_port.latest_filing_full_text("AAPL")

    assert "MAYA Annual Report" in out_ta
    assert "10-K" in out_us
    assert p_maya.call_count == 1
    assert p_sec.call_count == 1


def test_pick_latest_annual_and_quarter():
    with patch("ai_hedge.maya_reports._fetch_finance_rows") as p_rows:
        p_rows.side_effect = [
            [
                {"id": 1, "publishDate": "2026-01-01T00:00:00", "period": "שנתי"},
                {"id": 2, "publishDate": "2026-03-01T00:00:00", "period": "שנתי"},
                {
                    "id": 5,
                    "publishDate": "2026-08-01T00:00:00",
                    "period": "רבעון 2/חצי שנתי",
                    "title": "דוח רבעון 2/חצי שנתי לשנת 2026",
                },
            ],
            [
                {"id": 3, "publishDate": "2026-04-01T00:00:00", "period": "Q1"},
                {"id": 4, "publishDate": "2026-05-01T00:00:00", "period": "Annual"},
                {
                    "id": 5,
                    "publishDate": "2026-08-01T00:00:00",
                    "period": "רבעון 2/חצי שנתי",
                    "title": "דוח רבעון 2/חצי שנתי לשנת 2026",
                },
            ],
        ]
        annual = maya_reports._pick_latest_annual(session=object(), company_id=123, lang="he")
        quarter = maya_reports._pick_latest_quarter(session=object(), company_id=123, lang="he")

    assert annual and annual["id"] == 2
    assert quarter and quarter["id"] == 5


def test_pick_latest_annual_rejects_semiannual_only_rows():
    rows = [
        {
            "id": 10,
            "publishDate": "2026-08-01T00:00:00",
            "period": "חצי שנתי",
            "title": "דוח רבעון 2/חצי שנתי לשנת 2026",
        },
        {
            "id": 11,
            "publishDate": "2026-08-02T00:00:00",
            "period": "Semi-annual",
            "title": "Semi-annual report 2026",
        },
    ]

    with patch("ai_hedge.maya_reports._fetch_finance_rows", return_value=rows):
        annual = maya_reports._pick_latest_annual(session=object(), company_id=123, lang="he")

    assert annual is None
    assert not maya_reports._matches_expected_title("Semi-annual report 2026", report_kind="annual")
    assert maya_reports._matches_expected_title("Semi-annual report 2026", report_kind="quarterly")
    assert maya_reports._matches_expected_title("דוח למחצית הראשונה של 2026", report_kind="quarterly")
    assert not maya_reports._matches_expected_title("Half-year annual report 2026", report_kind="annual")


def test_companies_feed_fallback_finds_annual_and_quarter():
    annual_row = {"id": 11, "publishDate": "2026-03-26T07:30:04", "title": "דוח תקופתי ושנתי לשנת 2025"}
    quarter_row = {"id": 22, "publishDate": "2025-11-25T07:28:06", "title": "דוח רבעון 3 לשנת 2025"}

    def _fake_detail(_session, report_id: int, lang: str):
        if report_id == 11:
            return {"id": 11, "title": annual_row["title"], "publishDate": annual_row["publishDate"], "attachments": []}
        if report_id == 22:
            return {"id": 22, "title": quarter_row["title"], "publishDate": quarter_row["publishDate"], "attachments": []}
        return None

    with patch("ai_hedge.maya_reports._resolve_company_id", return_value=585), patch(
        "ai_hedge.maya_reports._pick_latest_annual", return_value=None
    ), patch(
        "ai_hedge.maya_reports._pick_latest_quarter", return_value=None
    ), patch(
        "ai_hedge.maya_reports._fetch_finance_rows", return_value=[]
    ), patch(
        "ai_hedge.maya_reports._fetch_companies_feed_rows", side_effect=[[annual_row], [quarter_row]]
    ), patch(
        "ai_hedge.maya_reports._report_detail", side_effect=_fake_detail
    ), patch(
        "ai_hedge.maya_reports._download_report_text", side_effect=[("annual text", "u1"), ("quarter text", "u2")]
    ):
        out = maya_reports.fetch_latest_maya_reports("HARL.TA")

    assert set(out.keys()) == {"MAYA Annual Report", "MAYA Quarterly Report"}
    assert out["MAYA Annual Report"]["text"]
    assert out["MAYA Quarterly Report"]["text"]
    assert out["MAYA Annual Report"]["date"] > out["MAYA Quarterly Report"]["date"]


def test_fetch_does_not_return_same_semiannual_report_as_annual_and_quarterly():
    semiannual_row = {
        "id": 33,
        "publishDate": "2026-08-01T07:30:04",
        "period": "רבעון 2/חצי שנתי",
        "title": "דוח רבעון 2/חצי שנתי לשנת 2026",
    }

    with patch("ai_hedge.maya_reports._resolve_company_id", return_value=585), patch(
        "ai_hedge.maya_reports._pick_latest_annual", return_value=semiannual_row
    ), patch(
        "ai_hedge.maya_reports._pick_latest_quarter", return_value=semiannual_row
    ), patch(
        "ai_hedge.maya_reports._fetch_finance_rows", return_value=[]
    ), patch(
        "ai_hedge.maya_reports._report_detail",
        return_value={
            "id": 33,
            "title": semiannual_row["title"],
            "publishDate": semiannual_row["publishDate"],
            "attachments": [],
        },
    ), patch(
        "ai_hedge.maya_reports._download_report_text",
        return_value=("semiannual text", "https://mayafiles.tase.co.il/q2.pdf"),
    ):
        out = maya_reports.fetch_latest_maya_reports("HARL.TA")

    assert set(out) == {"MAYA Quarterly Report"}
    assert "semiannual text" in out["MAYA Quarterly Report"]["text"]


def test_partial_availability_returns_single_report():
    annual_row = {"id": 100, "publishDate": "2026-01-01T00:00:00", "title": "דוח תקופתי ושנתי לשנת 2025"}

    with patch("ai_hedge.maya_reports._resolve_company_id", return_value=746), patch(
        "ai_hedge.maya_reports._pick_latest_annual", return_value=annual_row
    ), patch(
        "ai_hedge.maya_reports._pick_latest_quarter", return_value=None
    ), patch(
        "ai_hedge.maya_reports._fetch_finance_rows", return_value=[]
    ), patch(
        "ai_hedge.maya_reports._fetch_companies_feed_rows", return_value=[]
    ), patch(
        "ai_hedge.maya_reports._report_detail",
        return_value={"id": 100, "title": "דוח תקופתי ושנתי לשנת 2025", "publishDate": "2026-01-01T00:00:00", "attachments": []},
    ), patch("ai_hedge.maya_reports._download_report_text", return_value=("annual text", "https://mayafiles.tase.co.il/x")):
        out = maya_reports.fetch_latest_maya_reports("STRS.TA")

    assert set(out.keys()) == {"MAYA Annual Report"}
    assert out["MAYA Annual Report"]["text"]


def test_empty_results_are_safe():
    with patch("ai_hedge.maya_reports._resolve_company_id", return_value=746), patch(
        "ai_hedge.maya_reports._pick_latest_annual", return_value=None
    ), patch(
        "ai_hedge.maya_reports._pick_latest_quarter", return_value=None
    ), patch(
        "ai_hedge.maya_reports._fetch_finance_rows", return_value=[]
    ), patch(
        "ai_hedge.maya_reports._fetch_companies_feed_rows", return_value=[]
    ):
        out = maya_reports.fetch_latest_maya_reports("STRS.TA")
    assert out == {}


def test_unresolved_ta_company_id_is_recorded():
    unresolved_path = Path("tests") / f"_tmp_maya_unresolved_{uuid4().hex}.json"
    env = {"MAYA_UNRESOLVED_TICKERS_PATH": str(unresolved_path)}
    try:
        with patch.dict(os.environ, env, clear=False), patch(
            "ai_hedge.maya_reports._resolve_company_id", return_value=None
        ):
            out = maya_reports.fetch_latest_maya_reports("MISS.TA")

        assert out == {}
        payload = json.loads(unresolved_path.read_text(encoding="utf-8"))
        assert "MISS.TA" in payload
        row = payload["MISS.TA"]
        assert row["last_reason"] == "company_id_not_found"
        assert int(row["count"]) >= 1
        assert row["first_seen_at"]
        assert row["last_seen_at"]
        assert isinstance(row["terms"], list)
    finally:
        if unresolved_path.exists():
            unresolved_path.unlink()


def test_collect_ticker_terms_uses_supplied_yahoo_info_without_refetch():
    with patch("ai_hedge.maya_reports.yf.Ticker") as p_ticker:
        terms = maya_reports._collect_ticker_terms(
            "AMRK.TA",
            company_info={
                "shortName": "AMIR MARKETING AND",
                "longName": "Amir Marketing and Investments in Agriculture Ltd",
            },
        )

    assert p_ticker.call_count == 0
    assert terms[:5] == [
        "AMRK",
        "Amir Marketing and Investments in Agriculture Ltd",
        "AMIR MARKETING INVESTMENTS AGRICULTURE",
        "AMIR MARKETING AND",
        "AMIR MARKETING",
    ]


def test_dynamic_company_resolution_rejects_zero_match_candidates():
    rows = [
        {
            "companies": [
                {"companyId": 1084, "name": "Tower Semiconductor Ltd."},
            ]
        }
    ]

    with patch("ai_hedge.maya_reports._safe_request_json", return_value=rows):
        company_id = maya_reports._resolve_company_id_dynamic(
            "AMRK.TA",
            session=object(),
            company_info={"shortName": "AMIR MARKETING AND"},
        )

    assert company_id is None


def test_dynamic_company_resolution_uses_supplied_company_name():
    rows = [
        {
            "companies": [
                {"companyId": 1084, "name": "Tower Semiconductor Ltd."},
                {"companyId": 2204, "name": "Amir Marketing and Investments in Agriculture Ltd."},
            ]
        }
    ]

    with patch("ai_hedge.maya_reports._safe_request_json", return_value=rows):
        company_id = maya_reports._resolve_company_id_dynamic(
            "AMRK.TA",
            session=object(),
            company_info={"shortName": "AMIR MARKETING AND"},
        )

    assert company_id == 2204


def test_dynamic_company_resolution_uses_reporter_id_from_direct_report_rows():
    rows = [
        {
            "id": 1738575,
            "title": "Form 20-F For the fiscal year ended December 31, 2025",
            "publishDate": "2026-04-30T23:00:03.293",
            "reporterId": 2028,
            "reporterSecurityId": 1082379,
        }
    ]

    with patch("ai_hedge.maya_reports._safe_request_json", return_value=rows):
        company_id = maya_reports._resolve_company_id_dynamic(
            "AMRK.TA",
            session=object(),
            company_info={"shortName": "AMIR MARKETING AND"},
        )

    assert company_id == 2028


def test_dynamic_company_resolution_prefers_repeated_hebrew_reporter_hits():
    tower_rows = [
        {
            "id": 1738575,
            "title": "Form 20-F For the fiscal year ended December 31, 2025",
            "reporterId": 2028,
            "reporterSecurityId": 1082379,
            "companies": [{"companyId": 2028, "name": "TOWER"}],
        }
    ]
    amrk_rows = [
        {
            "id": 1740428 + idx,
            "title": "מרשם בעלי מניות",
            "reporterId": 1232,
            "reporterSecurityId": 1092204,
            "companies": [{"companyId": 1232, "name": "עמיר שיווק"}],
        }
        for idx in range(4)
    ]

    def _fake_search(_session, *, method: str, url: str, headers: dict, payload: dict | None = None):
        term = str((payload or {}).get("freeText", ""))
        language = str((headers or {}).get("Accept-Language", ""))
        if term == "AMIR MARKETING" and language.startswith("he-IL"):
            return amrk_rows
        if term in {"AMIR MARKETING", "AMIR MARKETING AND"}:
            return tower_rows
        return []

    with patch("ai_hedge.maya_reports._safe_request_json", side_effect=_fake_search):
        company_id = maya_reports._resolve_company_id_dynamic(
            "AMRK.TA",
            session=object(),
            company_info={"shortName": "AMIR MARKETING AND"},
        )

    assert company_id == 1232


def test_sec_payload_contract_accepts_maya_dict():
    files_dict = {
        "MAYA Annual Report": {
            "url": "https://mayafiles.tase.co.il/rhtm/a.htm",
            "text": "דוח תקופתי ושנתי לשנת 2025",
            "tables": [],
            "date": "2026-02-01T10:00:00",
        },
        "MAYA Quarterly Report": {
            "url": "https://mayafiles.tase.co.il/rhtm/q.htm",
            "text": "דוח רבעון 1 לשנת 2026",
            "tables": [],
            "date": "2026-05-01T10:00:00",
        },
    }
    bundle, notes = _build_sec_text_payload(files_dict)
    assert "MAYA Annual Report" in bundle
    assert "MAYA Quarterly Report" in bundle
    assert "דוח תקופתי ושנתי" in bundle
    assert notes == []

def test_download_prefers_pdf_over_html_for_maya_full_report():
    detail = {
        "attachments": [
            {"fileType": "htm", "url": "rhtm/1/H1.htm", "translated": False},
            {"fileType": "pdf1", "url": "rpdf/1/P1.pdf", "translated": False},
        ]
    }
    with patch("ai_hedge.maya_reports._safe_request_bytes", return_value=b"%PDF fake"), patch(
        "ai_hedge.maya_reports._extract_text_from_pdf_bytes", return_value="FULL PDF REPORT"
    ), patch("ai_hedge.maya_reports._safe_request_text", return_value="HTML SHELL"):
        text, url = maya_reports._download_report_text(session=object(), detail=detail)

    assert text == "FULL PDF REPORT"
    assert url.endswith("/rpdf/1/P1.pdf")


def test_sec_payload_quarterly_not_truncated_and_annual_gets_remaining_budget():
    annual_text = "A" * 400_000
    quarter_text = "Q" * 300_000
    files_dict = {
        "MAYA Annual Report": {"text": annual_text, "date": "2026-03-01", "title": "annual"},
        "MAYA Quarterly Report": {"text": quarter_text, "date": "2026-05-01", "title": "quarter"},
    }

    bundle, notes = _build_sec_text_payload(files_dict)

    annual_header = "## Filing: MAYA Annual Report | Date: 2026-03-01\n"
    quarter_header = "## Filing: MAYA Quarterly Report | Date: 2026-05-01\n"
    assert annual_header in bundle
    assert quarter_header in bundle

    quarter_block = bundle.split(quarter_header, 1)[1].split("\n\n## Filing: MAYA Annual Report | Date: 2026-03-01\n", 1)[0]
    annual_block = bundle.split(annual_header, 1)[1]

    # Quarterly is never truncated.
    assert len(quarter_block) == len(quarter_text)
    # Annual gets the remainder: 500k - quarterly chars.
    assert len(annual_block) == 200_000
    assert notes == []


def test_sec_payload_annual_is_500k_when_no_quarterly_exists():
    annual_text = "A" * 700_000
    files_dict = {
        "MAYA Annual Report": {"text": annual_text, "date": "2026-03-01", "title": "annual"},
    }
    bundle, notes = _build_sec_text_payload(files_dict)
    annual_header = "## Filing: MAYA Annual Report | Date: 2026-03-01\n"
    assert annual_header in bundle
    annual_block = bundle.split(annual_header, 1)[1]
    assert len(annual_block) == 500_000
    assert notes == []
