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
