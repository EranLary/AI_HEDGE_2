from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import FancyBboxPatch


GROUP_COLORS = {
    "entry": "#E8F0FE",
    "data": "#FFF4E5",
    "context": "#E0F2F1",
    "valuation": "#F3E8FD",
    "output": "#ECEFF1",
    "llm": "#E6F4EA",
}


NODES = {
    # Main entry
    "runner": {"label": "runner.run_ticker_valuation", "pos": (0.10, 0.93), "group": "entry"},
    # Upstream builders (main flow only)
    "make_analysis": {"label": "make_analysis_file", "pos": (0.10, 0.83), "group": "data"},
    "get_dicts": {"label": "get_dicts", "pos": (0.10, 0.73), "group": "data"},
    "dicts": {"label": "info_dict / files_dict /\nfinancial_dict / variables_dict", "pos": (0.10, 0.62), "group": "data"},
    "analysis_text": {"label": "regular analysis text\n(load_text_from_file)", "pos": (0.10, 0.51), "group": "data"},
    # Context build
    "sec_short": {"label": "build_sec_short_analysis_text\n(optional in main flow)", "pos": (0.34, 0.73), "group": "context"},
    "combined_ctx": {"label": "combined valuation context\nregular + SEC short (if available)", "pos": (0.34, 0.62), "group": "context"},
    "fallback_ctx": {"label": "fallback context\nregular only", "pos": (0.34, 0.51), "group": "context"},
    # Valuation core
    "run_vals": {"label": "run_valuations", "pos": (0.52, 0.83), "group": "valuation"},
    "prompt": {"label": "build_prompt\n(All Reports + info + info_financials + f_score + text)", "pos": (0.52, 0.73), "group": "valuation"},
    "llm": {"label": "DeepSeek LLM\n(deepseek-reasoner in current schedule)", "pos": (0.52, 0.62), "group": "llm"},
    # Parallel blocks
    "dcf": {"label": "dcf_range_full", "pos": (0.70, 0.86), "group": "valuation"},
    "pe": {"label": "profit_pe_range_full", "pos": (0.70, 0.79), "group": "valuation"},
    "ps": {"label": "revenue_ps_range_full", "pos": (0.70, 0.72), "group": "valuation"},
    "dream": {"label": "dream_valuation_full", "pos": (0.70, 0.65), "group": "valuation"},
    "bbb_tp": {"label": "bbb_tp_full", "pos": (0.70, 0.58), "group": "valuation"},
    "bbb_ni_pe": {"label": "bbb_ni_pe_full", "pos": (0.70, 0.51), "group": "valuation"},
    "forest": {"label": "forest_logic_full", "pos": (0.70, 0.44), "group": "valuation"},
    # Aggregation/output
    "agg": {"label": "aggregate block outputs\n-> Prices / Revenue / Net Income / P-E", "pos": (0.86, 0.64), "group": "output"},
    "append_text": {"label": "append valuation summaries\nto analysis.txt (add_text=True)", "pos": (0.86, 0.54), "group": "output"},
    "final_dict": {"label": "final_dict returned", "pos": (0.86, 0.44), "group": "output"},
    "plots": {"label": "plot_all_three + print_overall_valuations", "pos": (0.86, 0.34), "group": "output"},
    "files": {"label": "artifact copy/move\nTXT / PNG / PDF / HTML", "pos": (0.86, 0.24), "group": "output"},
}


EDGES = [
    # Entry and data build
    ("runner", "make_analysis"),
    ("make_analysis", "get_dicts"),
    ("get_dicts", "dicts"),
    ("make_analysis", "analysis_text"),
    # Context
    ("dicts", "sec_short"),
    ("analysis_text", "combined_ctx"),
    ("sec_short", "combined_ctx"),
    ("analysis_text", "fallback_ctx"),
    ("sec_short", "fallback_ctx"),
    # Into valuator
    ("runner", "run_vals"),
    ("dicts", "run_vals"),
    ("combined_ctx", "run_vals"),
    ("fallback_ctx", "run_vals"),
    ("run_vals", "prompt"),
    ("prompt", "dcf"),
    ("prompt", "pe"),
    ("prompt", "ps"),
    ("prompt", "dream"),
    ("prompt", "bbb_tp"),
    ("prompt", "bbb_ni_pe"),
    ("prompt", "forest"),
    ("llm", "dcf"),
    ("llm", "pe"),
    ("llm", "ps"),
    ("llm", "dream"),
    ("llm", "bbb_tp"),
    ("llm", "bbb_ni_pe"),
    ("llm", "forest"),
    # Aggregation
    ("dcf", "agg"),
    ("pe", "agg"),
    ("ps", "agg"),
    ("dream", "agg"),
    ("bbb_tp", "agg"),
    ("bbb_ni_pe", "agg"),
    ("forest", "agg"),
    ("agg", "append_text"),
    ("agg", "final_dict"),
    ("final_dict", "plots"),
    ("final_dict", "files"),
]


def _draw_node(ax: plt.Axes, x: float, y: float, text: str, color: str) -> None:
    width = 0.17
    height = 0.06
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
    ax.text(x, y, text, ha="center", va="center", fontsize=8.6, color="#1F2937", zorder=3)


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


def draw_valuation_main_map(output_path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(22, 12))
    ax.set_xlim(0, 1)
    ax.set_ylim(0.14, 1.0)
    ax.axis("off")

    for src, dst in EDGES:
        _draw_edge(ax, NODES[src]["pos"], NODES[dst]["pos"])

    for node in NODES.values():
        _draw_node(ax, node["pos"][0], node["pos"][1], node["label"], GROUP_COLORS[node["group"]])

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

    fig.suptitle("AI_HEDGE_2 Main Valuator Graph (Matplotlib)", fontsize=18, fontweight="bold", y=0.995)
    ax.set_title("Full valuation path only (no Lite mode, no SEC-only mode)", fontsize=11, pad=14)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return output_path


def main() -> None:
    out = Path(__file__).resolve().parent / "valuation-main-map-matplotlib.png"
    saved = draw_valuation_main_map(out)
    print(f"Saved: {saved}")


if __name__ == "__main__":
    main()
