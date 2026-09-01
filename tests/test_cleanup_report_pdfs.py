from pathlib import Path

from scripts.cleanup_report_pdfs import (
    _local_pdf_files,
    has_structured_valuation,
    report_is_recoverable,
)


def _dashboard() -> dict:
    return {
        "valuation_hub": {
            "prices": {
                "Current": 100.0,
                "Overall": [120.0, 130.0],
            }
        }
    }


def test_existing_report_is_recoverable_from_structured_valuation() -> None:
    recoverable, reason = report_is_recoverable(
        {
            "analysis_md": "# Stored analysis",
            "prices_explain_md": None,
            "dashboard": _dashboard(),
        }
    )

    assert recoverable is True
    assert reason == "structured historical valuation"
    assert has_structured_valuation(_dashboard()) is True


def test_report_without_analysis_is_not_recoverable() -> None:
    recoverable, reason = report_is_recoverable(
        {
            "analysis_md": "",
            "prices_explain_md": "# Valuation",
            "dashboard": _dashboard(),
        }
    )

    assert recoverable is False
    assert reason == "missing analysis Markdown"


def test_local_cleanup_targets_only_full_report_pdf_set(tmp_path: Path) -> None:
    full = tmp_path / "full"
    full.mkdir()
    for name in (
        "ABC_analysis.pdf",
        "ABC_prices_explain.pdf",
        "ABC_combined.pdf",
        "ABC_dashboard.json",
    ):
        (full / name).write_bytes(b"pdf")

    lite = tmp_path / "lite"
    lite.mkdir()
    (lite / "XYZ_analysis.pdf").write_bytes(b"lite")

    found = {path.name for path in _local_pdf_files(tmp_path)}
    assert found == {"ABC_analysis.pdf", "ABC_prices_explain.pdf", "ABC_combined.pdf"}
