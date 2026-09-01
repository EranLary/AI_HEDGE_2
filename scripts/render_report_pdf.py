"""Render a standalone HTML report from stdin to PDF bytes on stdout.

The command deliberately does not create a file. It is used by the site only
for an explicit user download, so report PDFs never enter the analysis output
directory, R2, the database, or a server-side cache.
"""

from __future__ import annotations

import io
import re
import sys


FALLBACK_CSS = """
@page { size: A4; margin: 16mm 14mm 18mm; }
body { color: #172033; font-family: Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.45; }
.report-toolbar, .report-toc { display: none; }
.report-shell { width: 100%; }
.report-hero { border-bottom: 1px solid #cbd5e1; margin-bottom: 18px; padding-bottom: 14px; }
.report-brand, .report-kicker, .report-meta-label { color: #047857; font-size: 8pt; font-weight: bold; text-transform: uppercase; }
.report-title { color: #111827; font-size: 28pt; margin: 8px 0 2px; }
.report-company, .report-footer { color: #526174; }
.report-meta { list-style: none; margin: 12px 0 0; padding: 0; }
.report-meta li { display: inline-block; margin-right: 16px; }
.report-meta-label, .report-meta-value { display: block; }
.report-notice, blockquote { background: #ecfdf5; border-left: 3px solid #047857; padding: 8px; }
h1, h2, h3, h4 { color: #111827; page-break-after: avoid; }
h1 { border-bottom: 1px solid #cbd5e1; font-size: 20pt; padding-bottom: 5px; }
h2 { color: #065f46; font-size: 15pt; }
h3 { font-size: 12pt; }
table { border-collapse: collapse; font-size: 7.5pt; width: 100%; }
th, td { border: 1px solid #cbd5e1; padding: 5px; vertical-align: top; }
th { background: #f1f5f4; color: #111827; }
pre, code { background: #f1f5f9; font-family: Courier, monospace; }
.report-footer { border-top: 1px solid #cbd5e1; font-size: 7.5pt; margin-top: 18px; padding-top: 8px; }
"""


def _xhtml2pdf_compatible_html(html: str) -> str:
    simplified = re.sub(
        r"<style\b[^>]*>[\s\S]*?</style>",
        f"<style>{FALLBACK_CSS}</style>",
        html,
        count=1,
        flags=re.IGNORECASE,
    )
    return re.sub(r"<script\b[^>]*>[\s\S]*?</script>", "", simplified, flags=re.IGNORECASE)


def render_pdf(html: str) -> bytes:
    try:
        from weasyprint import HTML

        return bytes(HTML(string=html).write_pdf())
    except Exception as weasy_error:
        try:
            from xhtml2pdf import pisa

            output = io.BytesIO()
            status = pisa.CreatePDF(_xhtml2pdf_compatible_html(html), dest=output)
            if status.err:
                raise RuntimeError("xhtml2pdf reported a rendering error")
            return output.getvalue()
        except Exception as fallback_error:
            raise RuntimeError(
                f"PDF render failed. WeasyPrint: {weasy_error}; "
                f"xhtml2pdf: {fallback_error}"
            ) from fallback_error


def main() -> int:
    html = sys.stdin.buffer.read().decode("utf-8")
    if not html.strip():
        print("HTML input is empty", file=sys.stderr)
        return 2
    try:
        pdf = render_pdf(html)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1
    sys.stdout.buffer.write(pdf)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
