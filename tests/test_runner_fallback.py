from __future__ import annotations

from ai_hedge import runner


def test_has_filing_text_false_for_empty_or_missing_text():
    assert runner._has_filing_text({}) is False
    assert runner._has_filing_text({"MAYA Annual Report": {"text": ""}}) is False
    assert runner._has_filing_text({"SEC": {"text": None}}) is False


def test_has_filing_text_true_for_any_non_empty_text():
    payload = {
        "MAYA Annual Report": {"text": ""},
        "MAYA Quarterly Report": {"text": "some filing text"},
    }
    assert runner._has_filing_text(payload) is True


def test_build_sec_sources_footer_for_maya_reports():
    files_dict = {
        "MAYA Annual Report": {
            "text": "annual body",
            "date": "2026-03-31T08:00:06.36",
            "source": "MAYA",
        },
        "MAYA Quarterly Report": {
            "text": "quarter body",
            "date": "2025-11-30T08:00:02.813",
            "source": "MAYA",
        },
    }
    footer = runner._build_sec_sources_footer(files_dict)
    assert "Source: MAYA" in footer
    assert "Annual report date: 2026-03-31T08:00:06.36" in footer
    assert "Quarterly report date: 2025-11-30T08:00:02.813" in footer


def test_build_sec_sources_footer_for_sec_reports():
    files_dict = {
        "10-K": {"text": "annual body", "date": "2026-02-10"},
        "6-K": {"text": "quarter body", "date": "2026-05-05"},
    }
    footer = runner._build_sec_sources_footer(files_dict)
    assert "Source: SEC" in footer
    assert "Annual report date: 2026-02-10" in footer
    assert "Quarterly report date: 2026-05-05" in footer
