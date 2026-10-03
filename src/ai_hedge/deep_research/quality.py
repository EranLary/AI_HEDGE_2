from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping


_SECTION_MARKERS = (
    "business in plain language",
    "economic and business model",
    "financial analysis",
    "accounting",
    "market and competitive",
    "operating kpi",
    "public peers",
    "competitive moat",
    "the stock",
    "customers",
    "management",
    "material event",
    "opportunities",
    "swot",
    "forward-monitoring",
    "valuation basis",
    "intrinsic valuation",
    "comparable-company valuation",
    "sotp",
    "weighted fair value",
    "final investment decision",
)

_VALUATION_MARKERS = (
    "sensitivity",
    "diluted",
    "target price",
    "upside",
)

_VALUE_BRIDGE_MARKERS = (
    "enterprise value",
    "equity value",
    "fair value per share",
    "book value",
)


@dataclass(frozen=True)
class QualityFinding:
    severity: str
    code: str
    message: str


@dataclass(frozen=True)
class QualityGateResult:
    passed: bool
    score: int
    word_count: int
    source_count: int
    cited_source_count: int
    covered_sections: int
    required_sections: int
    findings: tuple[QualityFinding, ...]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["findings"] = [asdict(finding) for finding in self.findings]
        return payload


def _normalized_headings(markdown: str) -> str:
    headings = [
        re.sub(r"[^a-z0-9 /&+-]+", " ", line.lstrip("#").strip().lower())
        for line in markdown.splitlines()
        if line.lstrip().startswith("#")
    ]
    return "\n".join(re.sub(r"\s+", " ", heading) for heading in headings)


def evaluate_report_quality(
    report: str,
    sources: Iterable[Mapping[str, Any]],
) -> QualityGateResult:
    text = str(report or "").strip()
    source_rows = [source for source in sources if isinstance(source, Mapping)]
    cited_sources = [source for source in source_rows if source.get("cited")]
    words = re.findall(r"\b[\w'-]+\b", text, flags=re.UNICODE)
    word_count = len(words)
    headings = _normalized_headings(text)
    covered = sum(1 for marker in _SECTION_MARKERS if marker in headings)
    valuation_coverage = sum(
        1 for marker in _VALUATION_MARKERS if marker in text.lower()
    )
    has_value_bridge = any(marker in text.lower() for marker in _VALUE_BRIDGE_MARKERS)

    findings: list[QualityFinding] = []
    score = 100
    if not text:
        findings.append(QualityFinding("critical", "empty_report", "Report is empty."))
        score -= 100
    elif word_count < 3_500:
        findings.append(
            QualityFinding(
                "critical",
                "report_too_short",
                f"Report has {word_count} words; minimum research gate is 3,500.",
            )
        )
        score -= 25
    elif word_count < 5_000:
        findings.append(
            QualityFinding(
                "warning",
                "limited_depth",
                f"Report has {word_count} words; the quality target is at least 5,000.",
            )
        )
        score -= 8

    if len(source_rows) < 15:
        findings.append(
            QualityFinding(
                "critical",
                "insufficient_sources",
                f"Only {len(source_rows)} unique web sources were retained; minimum is 15.",
            )
        )
        score -= 20
    if len(cited_sources) < 10:
        findings.append(
            QualityFinding(
                "critical",
                "insufficient_citations",
                f"Only {len(cited_sources)} unique sources are cited in the report; minimum is 10.",
            )
        )
        score -= 20

    minimum_sections = 17
    if covered < minimum_sections:
        findings.append(
            QualityFinding(
                "critical",
                "incomplete_section_coverage",
                f"Only {covered}/{len(_SECTION_MARKERS)} required topic headings were detected; "
                f"minimum is {minimum_sections}.",
            )
        )
        score -= min(25, (minimum_sections - covered) * 3)

    if valuation_coverage < len(_VALUATION_MARKERS):
        missing = [
            marker for marker in _VALUATION_MARKERS if marker not in text.lower()
        ]
        findings.append(
            QualityFinding(
                "critical",
                "incomplete_valuation_controls",
                "Missing valuation control concepts: " + ", ".join(missing),
            )
        )
        score -= 20

    if not has_value_bridge:
        findings.append(
            QualityFinding(
                "critical",
                "missing_value_bridge",
                "No enterprise-, equity-, book-, or per-share value bridge was found.",
            )
        )
        score -= 20

    if "valuation control summary" not in headings:
        findings.append(
            QualityFinding(
                "warning",
                "missing_control_summary",
                "The report has no explicit Valuation Control Summary heading.",
            )
        )
        score -= 5

    if re.search(r"\{\{[^}]+\}\}|\bTODO\b|\bTBD\b", text, flags=re.IGNORECASE):
        findings.append(
            QualityFinding(
                "critical",
                "unresolved_placeholder",
                "The report contains an unresolved template placeholder.",
            )
        )
        score -= 20

    score = max(0, min(100, score))
    passed = score >= 80 and not any(
        finding.severity == "critical" for finding in findings
    )
    return QualityGateResult(
        passed=passed,
        score=score,
        word_count=word_count,
        source_count=len(source_rows),
        cited_source_count=len(cited_sources),
        covered_sections=covered,
        required_sections=len(_SECTION_MARKERS),
        findings=tuple(findings),
    )


def evaluate_run_artifacts(
    output_dir: Path,
    *,
    report_filename: str = "research_report.md",
    sources_filename: str = "research_sources.json",
) -> QualityGateResult:
    report_path = Path(output_dir) / report_filename
    sources_path = Path(output_dir) / sources_filename
    report = report_path.read_text(encoding="utf-8")
    payload = json.loads(sources_path.read_text(encoding="utf-8"))
    sources = payload.get("sources") if isinstance(payload, Mapping) else []
    return evaluate_report_quality(report, sources or [])


def write_quality_report(
    output_dir: Path,
    result: QualityGateResult,
    *,
    output_filename: str = "research_quality.json",
) -> Path:
    path = Path(output_dir) / output_filename
    path.write_text(
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return path
