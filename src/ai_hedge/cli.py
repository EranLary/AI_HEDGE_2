from __future__ import annotations

import argparse
import json

from .runner import (
    DEFAULT_ANALYSIS_WORKERS,
    DEFAULT_LLM_WORKERS,
    DEFAULT_VALUATION_BLOCK_WORKERS,
    run_ticker_valuation,
)



def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run valuation flow for one ticker")
    parser.add_argument("--ticker", required=False, help="Ticker symbol, e.g. AAPL")
    parser.add_argument("--pdf", dest="pdf", action="store_true", help="Generate analysis PDF (default)")
    parser.add_argument("--no-pdf", dest="pdf", action="store_false", help="Do not generate analysis PDF")
    parser.set_defaults(pdf=True)
    parser.add_argument("--show-plots", dest="show_plots", action="store_true", help="Display plots interactively (default)")
    parser.add_argument("--no-show-plots", dest="show_plots", action="store_false", help="Do not display plots")
    parser.set_defaults(show_plots=True)
    parser.add_argument("--output-root", default="outputs", help="Root output directory")
    parser.add_argument("--analysis-workers", type=int, default=DEFAULT_ANALYSIS_WORKERS, help="Workers for analysis sections")
    parser.add_argument("--llm-workers", type=int, default=DEFAULT_LLM_WORKERS, help="Workers per valuation block")
    parser.add_argument("--valuation-block-workers", type=int, default=DEFAULT_VALUATION_BLOCK_WORKERS, help="Parallel valuation blocks")
    return parser



def main() -> None:
    args = build_parser().parse_args()
    ticker = (args.ticker or input("Enter ticker: ")).strip().upper()
    if not ticker:
        raise ValueError("Ticker is required")

    artifacts = run_ticker_valuation(
        ticker,
        output_root=args.output_root,
        save_pdf=args.pdf,
        show_plots=args.show_plots,
        analysis_workers=args.analysis_workers,
        llm_workers_each_block=args.llm_workers,
        valuation_blocks_workers=args.valuation_block_workers,
    )
    print(json.dumps(artifacts, indent=2))


if __name__ == "__main__":
    main()
