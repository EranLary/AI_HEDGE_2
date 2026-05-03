from __future__ import annotations

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
            ],
            [
                {"id": 3, "publishDate": "2026-04-01T00:00:00", "period": "Q1"},
                {"id": 4, "publishDate": "2026-05-01T00:00:00", "period": "Annual"},
            ],
        ]
        annual = maya_reports._pick_latest_annual(session=object(), company_id=123, lang="he")
        quarter = maya_reports._pick_latest_quarter(session=object(), company_id=123, lang="he")

    assert annual and annual["id"] == 2
    assert quarter and quarter["id"] == 3


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
