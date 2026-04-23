from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Tuple

from . import legacy_port as legacy


def _require_api_key() -> None:
    if not os.getenv("DEEPSEEK_API_KEY"):
        raise RuntimeError("Missing DEEPSEEK_API_KEY environment variable")


def _mean(values: List[float]) -> float:
    if not values:
        return 0.0
    return float(sum(values) / len(values))


def _plot_lite_prices(
    *,
    ticker: str,
    current_price: float,
    dcf_prices: List[float],
    pe_prices: List[float],
    output_dir: Path,
    show_plot: bool,
) -> str:
    try:
        import matplotlib
        import matplotlib.pyplot as plt
        if show_plot and "agg" in matplotlib.get_backend().lower():
            plt.switch_backend("TkAgg")
    except Exception:
        return ""

    series: List[Tuple[str, List[float]]] = []
    if dcf_prices:
        series.append(("DCF", dcf_prices))
    if pe_prices:
        series.append(("P/E", pe_prices))
    if not series:
        return ""

    output_dir.mkdir(parents=True, exist_ok=True)
    plot_path = output_dir / f"{ticker}_lite_prices_valuation.png"

    labels: List[str] = []
    mins: List[float] = []
    maxs: List[float] = []
    mids: List[float] = []
    for name, vals in series:
        labels.append(name)
        mins.append(float(min(vals)))
        maxs.append(float(max(vals)))
        mids.append(_mean(vals))

    y = list(range(len(labels)))
    fig, ax = plt.subplots(figsize=(9, 3.5))
    for i in range(len(labels)):
        ax.hlines(y=i, xmin=mins[i], xmax=maxs[i], linewidth=4)
        ax.plot(mids[i], i, marker="o")
        ax.annotate(f"{mins[i]:.2f}", (mins[i], i), xytext=(-6, 0), textcoords="offset points", ha="right", va="center", fontsize=9)
        ax.annotate(f"{maxs[i]:.2f}", (maxs[i], i), xytext=(6, 0), textcoords="offset points", ha="left", va="center", fontsize=9)

    ax.axvline(current_price, linestyle="--", linewidth=2, color="black", label=f"Current ({current_price:.2f})")
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.set_xlabel("Price")
    ax.set_title(f"{ticker} Lite Valuation Ranges")
    ax.grid(True, axis="x", alpha=0.25)
    ax.legend(loc="best")
    fig.tight_layout()
    fig.savefig(str(plot_path), dpi=180, bbox_inches="tight")

    if show_plot:
        plt.show(block=True)
    else:
        plt.close(fig)

    return str(plot_path.resolve())


def run_lite_test(
    ticker: str,
    *,
    text_agents: int = 3,
    valuation_iterations: int = 1,
    llm_workers: int = 4,
    output_root: str = "outputs",
    show_plots: bool = True,
    save_pdf: bool = True,
) -> Dict[str, Any]:
    """
    Fast smoke test:
    - Runs only N text-maker agents (default: 3)
    - Runs only 2 valuation blocks (DCF + P/E/Earnings)
    """
    _require_api_key()
    ticker = ticker.upper().strip()
    legacy.ticker = ticker

    info_dict, files_dict, financial_dict, variables_dict = legacy.get_dicts(ticker)
    if not info_dict.get("short_name"):
        raise ValueError(f"Ticker '{ticker}' is invalid or unavailable")

    legacy.reset_file_if_not_empty()
    legacy.generate_first_text(ticker, variables_dict)

    text_tasks: List[Tuple[str, str]] = []
    available_agents = [
        legacy.what_it_does_insights_result,
        legacy.info_insights_result,
        legacy.news_insights_result,
    ]
    for fn in available_agents[: max(1, text_agents)]:
        header, body = fn(info_dict)
        legacy.append_text_to_file(text=body, header=header)
        text_tasks.append((fn.__name__, header))

    text = legacy.load_text_from_file("analysis.txt")

    # Preserve legacy expectations in valuation helper funcs.
    globals()["ticker"] = ticker
    globals()["variables_dict"] = variables_dict
    legacy.ticker = ticker
    legacy.variables_dict = variables_dict

    runtime_context = legacy.build_runtime_context(
        ticker_input=ticker,
        variables_dict_input=variables_dict,
        info_dict_input=info_dict,
        financial_dict_input=financial_dict,
        text_input=text,
    )

    dcf_prices, dcf_summary = legacy.dcf_range_full(
        financial_dict,
        text,
        num_iterations=valuation_iterations,
        llm_workers=llm_workers,
        runtime_context=runtime_context,
    )
    pe_prices, pe_values, ni_values, pe_summary = legacy.profit_pe_range_full(
        financial_dict,
        text,
        num_iterations=valuation_iterations,
        llm_workers=llm_workers,
        runtime_context=runtime_context,
    )
    out_dir = Path(output_root) / ticker
    lite_prices_plot = _plot_lite_prices(
        ticker=ticker,
        current_price=float(variables_dict.get("price", 0) or 0),
        dcf_prices=dcf_prices,
        pe_prices=pe_prices,
        output_dir=out_dir,
        show_plot=show_plots,
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    analysis_src = Path("analysis.txt")
    analysis_dst = out_dir / f"{ticker}_lite_analysis.txt"
    if analysis_src.exists():
        shutil.copy(analysis_src, analysis_dst)

    pdf_dst = ""
    if save_pdf:
        try:
            legacy.pdf_downloader(ticker)
        except Exception as pdf_err:
            print(f"Warning: Lite PDF generation failed, continuing without PDF. Error: {pdf_err}")
        pdf_src = Path(f"{ticker}_analysis.pdf")
        html_src = Path(f"{ticker}_analysis.html")
        if pdf_src.exists():
            target_pdf = out_dir / f"{ticker}_lite_analysis.pdf"
            shutil.move(str(pdf_src), target_pdf)
            pdf_dst = str(target_pdf.resolve())
        if html_src.exists():
            target_html = out_dir / f"{ticker}_lite_analysis.html"
            shutil.move(str(html_src), target_html)

    result: Dict[str, Any] = {
        "ticker": ticker,
        "output_dir": str(out_dir.resolve()),
        "text_agents_ran": text_tasks,
        "valuation_blocks_ran": ["dcf_range_full", "profit_pe_range_full"],
        "metrics": {
            "current_price": variables_dict.get("price", 0),
            "dcf_count": len(dcf_prices),
            "dcf_mean": _mean(dcf_prices),
            "pe_count": len(pe_prices),
            "pe_price_mean": _mean(pe_prices),
            "pe_mean": _mean(pe_values),
            "ni_mean": _mean(ni_values),
        },
        "summaries": {
            "dcf": {"text": dcf_summary[0], "header": dcf_summary[1]},
            "pe": {"text": pe_summary[0], "header": pe_summary[1]},
        },
        "analysis_txt": str(analysis_dst.resolve()),
        "analysis_pdf": pdf_dst,
        "lite_prices_plot": lite_prices_plot,
    }
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a light smoke test: 3 text agents + 2 valuation blocks"
    )
    parser.add_argument("--ticker", required=False, help="Ticker symbol, e.g. AAPL")
    parser.add_argument(
        "--text-agents",
        type=int,
        default=3,
        help="How many text-maker agents to run (1-3)",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=1,
        help="Valuation iterations per block (1 recommended for smoke test)",
    )
    parser.add_argument(
        "--llm-workers",
        type=int,
        default=4,
        help="LLM workers for the 2 valuation blocks",
    )
    parser.add_argument("--show-plots", dest="show_plots", action="store_true", help="Display lite plot interactively (default)")
    parser.add_argument("--no-show-plots", dest="show_plots", action="store_false", help="Do not display lite plot")
    parser.set_defaults(show_plots=True)
    parser.add_argument("--pdf", dest="pdf", action="store_true", help="Generate lite PDF (default)")
    parser.add_argument("--no-pdf", dest="pdf", action="store_false", help="Do not generate lite PDF")
    parser.set_defaults(pdf=True)
    parser.add_argument("--output-root", default="outputs", help="Root output directory")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    ticker = (args.ticker or input("Enter ticker: ")).strip().upper()
    if not ticker:
        raise ValueError("Ticker is required")

    out = run_lite_test(
        ticker,
        text_agents=args.text_agents,
        valuation_iterations=args.iterations,
        llm_workers=args.llm_workers,
        output_root=args.output_root,
        show_plots=args.show_plots,
        save_pdf=args.pdf,
    )
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
