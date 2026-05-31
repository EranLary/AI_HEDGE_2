from __future__ import annotations

import argparse
from pathlib import Path


def _build_html(md_text: str) -> str:
    from markdown import markdown

    html_body = markdown(md_text, extensions=["extra"])

    # Notebook-style HTML/CSS logic
    return f"""
<html>
<head>
<style>
body {{
    font-family: Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.4;
    max-width: 800px;
    margin: 40px auto;
    word-wrap: break-word;
    overflow-wrap: break-word;
}}

h1 {{ font-size: 20pt; }}
h2 {{ font-size: 16pt; }}
h3 {{ font-size: 14pt; }}

ul {{
    padding-left: 20px;
}}

li {{
    margin-bottom: 10px;
}}

table {{
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0 20px;
    font-size: 9.5pt;
}}

th, td {{
    border: 1px solid #d0d7de;
    padding: 6px 8px;
    vertical-align: top;
}}

th {{
    background: #f6f8fa;
    font-weight: 700;
    text-align: left;
}}

td {{
    word-break: normal;
}}
</style>
</head>
<body>
{html_body}
</body>
</html>
""".strip()


def convert_text_to_pdf(input_txt: Path, output_pdf: Path, output_html: Path | None = None) -> None:
    md_text = input_txt.read_text(encoding="utf-8")
    html_full = _build_html(md_text)

    if output_html is not None:
        output_html.write_text(html_full, encoding="utf-8")

    # Prefer notebook-equivalent renderer (weasyprint)
    try:
        from weasyprint import HTML

        HTML(string=html_full).write_pdf(str(output_pdf))
        print(f"PDF ready (weasyprint): {output_pdf}")
        return
    except Exception as weasy_err:
        # Fallback to keep utility usable on Windows without GTK libs
        from xhtml2pdf import pisa

        with output_pdf.open("wb") as f:
            status = pisa.CreatePDF(html_full, dest=f)
        if status.err:
            raise RuntimeError(
                f"Both renderers failed. WeasyPrint error: {weasy_err}; xhtml2pdf failed."
            )
        print(f"PDF ready (xhtml2pdf fallback): {output_pdf}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Notebook-style text->PDF converter for analysis files"
    )
    parser.add_argument(
        "--input",
        default="outputs/AAPL/AAPL_analysis.txt",
        help="Input markdown/text file path",
    )
    parser.add_argument(
        "--output",
        default="outputs/AAPL/AAPL_analysis_check.pdf",
        help="Output PDF file path",
    )
    parser.add_argument(
        "--html-out",
        default="outputs/AAPL/AAPL_analysis_check.html",
        help="Optional HTML debug output path",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()

    input_txt = Path(args.input)
    output_pdf = Path(args.output)
    output_html = Path(args.html_out) if args.html_out else None

    if not input_txt.exists():
        raise FileNotFoundError(f"Input file not found: {input_txt}")

    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    if output_html is not None:
        output_html.parent.mkdir(parents=True, exist_ok=True)

    convert_text_to_pdf(input_txt, output_pdf, output_html)


if __name__ == "__main__":
    main()
