import { DashboardPayload } from "@/lib/dashboard-types";

export function createFallbackDashboard(ticker: string): DashboardPayload {
  const tk = ticker.toUpperCase();
  return {
    dashboard_version: "v1-fallback",
    ticker: tk,
    header: {
      company_name: tk,
      current_price: null,
      market_cap: null,
      shares_outstanding: null,
      currency: "USD",
      f_score_text: "",
    },
    red_flag_shield: [
      "Dashboard JSON is not generated yet for this ticker.",
      "Run a fresh full valuation to populate executive, bull-case, and bear-case sections.",
    ],
    analysis_matrix: {
      executive_summary_markdown:
        "No structured dashboard summary exists yet for this ticker. Run the valuation pipeline again to generate Executive Summary, Bull Case, and Bear Case from analysis + SEC + reports.",
      bull_case_reasons: [],
      bear_case_reasons: [],
      key_insights: [],
      bull_insights: [],
      red_flag_insights: [],
      documents: {
        executive_summary: {
          company: tk,
          document_type: "executive_summary",
          executive_summary: "",
          key_takeaways: [],
        },
        bull_case: {
          company: tk,
          document_type: "bull_case",
          reasons: [],
        },
        bear_case: {
          company: tk,
          document_type: "bear_case",
          reasons: [],
        },
      },
      swot: {
        strengths: [],
        weaknesses: [],
        opportunities: [],
        threats: [],
      },
      structural_shift: {
        triggered: false,
        direction: "none",
        change_pct_52w: null,
      },
      source: "fallback",
    },
    valuation_hub: {
      method_blocks: [],
      method_tabs: [],
      all_values: {
        metric_means: [],
        source_values: [],
      },
      consensus: {
        current_price: null,
        mean_target_price: null,
        std: null,
        cv: null,
        lmil: [],
      },
    },
    dream_team: [],
    forecast_forensic_matrix: {
      current_revenue: null,
      target_revenue: null,
      current_earnings: null,
      target_earnings: null,
      forensic_flags: [],
    },
    decision_card: {
      action: "N/A",
      position_size_pct_of_notional: 0,
      mean_investment_amount: null,
      rationale: "Run valuation to produce a portfolio signal.",
    },
    technical_analysis: {
      status: "unavailable",
      analysis: {},
      error: "Technical analysis is not available for this report yet.",
    },
    artifacts: {},
    downloads: {
      analysis_pdf: `/api/artifacts/${tk}/analysis-pdf`,
    },
  };
}
