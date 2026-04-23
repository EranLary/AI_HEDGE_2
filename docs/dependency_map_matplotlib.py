from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import FancyBboxPatch


GROUP_COLORS = {
    "entry": "#E8F0FE",
    "source": "#E6F4EA",
    "build": "#FFF4E5",
    "text": "#FDE7F3",
    "sec": "#E0F2F1",
    "valuation": "#F3E8FD",
    "output": "#ECEFF1",
}


NODES = {
    # Entrypoints
    "full_entry": {"label": "service.run_full_analysis", "pos": (0.19, 0.96), "group": "entry"},
    "lite_entry": {"label": "service.run_lite_analysis", "pos": (0.40, 0.96), "group": "entry"},
    "sec_entry": {"label": "service.run_sec_analysis", "pos": (0.60, 0.96), "group": "entry"},
    "runner": {"label": "runner.run_ticker_valuation", "pos": (0.20, 0.90), "group": "entry"},
    "lite_runner": {"label": "lite_test.run_lite_test", "pos": (0.40, 0.90), "group": "entry"},
    # Sources
    "yf_info": {"label": "Yahoo: profile/news/options/holders", "pos": (0.05, 0.76), "group": "source"},
    "yf_fin": {"label": "Yahoo: financial statements", "pos": (0.05, 0.67), "group": "source"},
    "yf_tnx": {"label": "Yahoo: ^TNX risk-free rate", "pos": (0.05, 0.58), "group": "source"},
    "sec_cik": {"label": "SEC: company_tickers.json", "pos": (0.05, 0.49), "group": "source"},
    "sec_sub": {"label": "SEC: CIK submissions json", "pos": (0.05, 0.40), "group": "source"},
    "sec_doc": {"label": "SEC: filing docs/index", "pos": (0.05, 0.31), "group": "source"},
    "deepseek": {"label": "DeepSeek API", "pos": (0.05, 0.20), "group": "source"},
    # Data build
    "get_info": {"label": "get_info_data -> info_dict", "pos": (0.23, 0.76), "group": "build"},
    "get_files": {"label": "latest_filing_full_text -> files_dict", "pos": (0.23, 0.57), "group": "build"},
    "get_fin": {"label": "get_financial_data -> financial_dict", "pos": (0.23, 0.41), "group": "build"},
    "get_vars": {"label": "get_variables -> variables_dict", "pos": (0.23, 0.27), "group": "build"},
    "get_dicts": {"label": "get_dicts tuple", "pos": (0.23, 0.16), "group": "build"},
    # Text analysis
    "make_analysis": {"label": "make_analysis_file", "pos": (0.42, 0.88), "group": "text"},
    "f_score": {"label": "f_score + inject into dicts", "pos": (0.42, 0.80), "group": "text"},
    "parallel_agents": {"label": "parallel text agents", "pos": (0.42, 0.71), "group": "text"},
    "write_sections": {"label": "append sections -> analysis.txt", "pos": (0.42, 0.63), "group": "text"},
    "tail_agents": {"label": "market/swot/bull-bear/for-value", "pos": (0.42, 0.54), "group": "text"},
    "regular_text": {"label": "regular analysis text ready", "pos": (0.42, 0.46), "group": "text"},
    # SEC short context
    "sec_short": {"label": "build_sec_short_analysis_text", "pos": (0.60, 0.66), "group": "sec"},
    "ctx_combined": {"label": "combined context\nregular + SEC short", "pos": (0.60, 0.56), "group": "sec"},
    "ctx_fallback": {"label": "fallback context\nregular only", "pos": (0.60, 0.46), "group": "sec"},
    # Valuation
    "run_vals": {"label": "run_valuations", "pos": (0.76, 0.88), "group": "valuation"},
    "build_prompt": {"label": "build_prompt (All Reports + info + f_score + text)", "pos": (0.76, 0.78), "group": "valuation"},
    "val_blocks": {"label": "parallel blocks:\nDCF / P-E / EV-S / Dream /\nBBB TP / BBB NI-PE / Forest", "pos": (0.76, 0.66), "group": "valuation"},
    "agg": {"label": "aggregate -> Prices/Revenue/NI/P-E", "pos": (0.76, 0.54), "group": "valuation"},
    # Outputs
    "final_dict": {"label": "final_dict", "pos": (0.92, 0.66), "group": "output"},
    "analysis_out": {"label": "analysis.txt + copied artifacts", "pos": (0.92, 0.56), "group": "output"},
    "plots_pdf": {"label": "plots + PDF/HTML", "pos": (0.92, 0.46), "group": "output"},
    "sec_report_out": {"label": "SEC report txt/pdf (SEC mode)", "pos": (0.92, 0.36), "group": "output"},
    "lite_out": {"label": "lite txt/pdf/chart (Lite mode)", "pos": (0.92, 0.26), "group": "output"},
}


EDGES = [
    # Entrypoints
    ("full_entry", "runner"),
    ("runner", "make_analysis"),
    ("runner", "sec_short"),
    ("runner", "run_vals"),
    ("lite_entry", "lite_runner"),
    ("lite_runner", "get_dicts"),
    ("lite_runner", "regular_text"),
    ("sec_entry", "get_dicts"),
    ("sec_entry", "sec_short"),
    # Sources -> builders
    ("yf_info", "get_info"),
    ("yf_fin", "get_fin"),
    ("yf_tnx", "get_fin"),
    ("sec_cik", "get_files"),
    ("sec_sub", "get_files"),
    ("sec_doc", "get_files"),
    ("deepseek", "f_score"),
    ("deepseek", "parallel_agents"),
    ("deepseek", "tail_agents"),
    ("deepseek", "sec_short"),
    ("deepseek", "val_blocks"),
    # Build chain
    ("get_info", "get_vars"),
    ("get_fin", "get_vars"),
    ("get_info", "get_dicts"),
    ("get_files", "get_dicts"),
    ("get_fin", "get_dicts"),
    ("get_vars", "get_dicts"),
    # make_analysis flow
    ("get_dicts", "make_analysis"),
    ("make_analysis", "f_score"),
    ("f_score", "parallel_agents"),
    ("parallel_agents", "write_sections"),
    ("write_sections", "tail_agents"),
    ("tail_agents", "regular_text"),
    # SEC context flow
    ("get_dicts", "sec_short"),
    ("regular_text", "ctx_combined"),
    ("regular_text", "ctx_fallback"),
    ("sec_short", "ctx_combined"),
    ("sec_short", "ctx_fallback"),
    # Valuation flow
    ("get_dicts", "run_vals"),
    ("regular_text", "run_vals"),
    ("ctx_combined", "run_vals"),
    ("ctx_fallback", "run_vals"),
    ("run_vals", "build_prompt"),
    ("build_prompt", "val_blocks"),
    ("val_blocks", "agg"),
    ("agg", "final_dict"),
    ("agg", "analysis_out"),
    ("agg", "plots_pdf"),
    # SEC/Lite outputs
    ("sec_entry", "sec_report_out"),
    ("lite_runner", "lite_out"),
]


def _draw_node(ax: plt.Axes, x: float, y: float, text: str, color: str) -> None:
    width = 0.16
    height = 0.055
    box = FancyBboxPatch(
        (x - width / 2, y - height / 2),
        width,
        height,
        boxstyle="round,pad=0.01,rounding_size=0.02",
        linewidth=1.2,
        edgecolor="#455A64",
        facecolor=color,
        zorder=2,
    )
    ax.add_patch(box)
    ax.text(x, y, text, ha="center", va="center", fontsize=8.5, color="#1F2937", zorder=3)


def _draw_edge(ax: plt.Axes, start: tuple[float, float], end: tuple[float, float]) -> None:
    ax.annotate(
        "",
        xy=end,
        xytext=start,
        arrowprops={
            "arrowstyle": "-|>",
            "lw": 1.1,
            "color": "#607D8B",
            "shrinkA": 18,
            "shrinkB": 18,
            "connectionstyle": "arc3,rad=0.0",
        },
        zorder=1,
    )


def draw_dependency_map(output_path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(22, 12))
    ax.set_xlim(0, 1)
    ax.set_ylim(0.1, 1.0)
    ax.axis("off")

    # Draw edges first.
    for src, dst in EDGES:
        start = NODES[src]["pos"]
        end = NODES[dst]["pos"]
        _draw_edge(ax, start, end)

    # Draw nodes.
    for node in NODES.values():
        _draw_node(
            ax,
            node["pos"][0],
            node["pos"][1],
            node["label"],
            GROUP_COLORS[node["group"]],
        )

    # Group legend.
    handles = [
        Line2D([0], [0], marker="s", color="w", markerfacecolor=color, markersize=12, label=group.title())
        for group, color in GROUP_COLORS.items()
    ]
    ax.legend(
        handles=handles,
        loc="lower center",
        ncol=len(handles),
        frameon=False,
        bbox_to_anchor=(0.5, 0.02),
    )

    fig.suptitle("AI_HEDGE_2 Dependency Graph (Matplotlib)", fontsize=18, fontweight="bold", y=0.995)
    ax.set_title("Sources -> Data Build -> Text Agents -> SEC Context -> Valuation -> Outputs", fontsize=11, pad=14)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return output_path


def main() -> None:
    out = Path(__file__).resolve().parent / "dependency-map-matplotlib.png"
    saved = draw_dependency_map(out)
    print(f"Saved: {saved}")


if __name__ == "__main__":
    main()
