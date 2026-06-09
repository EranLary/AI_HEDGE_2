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
      main_thesis_questions: [],
      watchlist_kpis: [],
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
        main_thesis: {
          company: tk,
          document_type: "main_thesis_kpis",
          valuation_revolves_around: "",
          main_questions: [],
          kpis: [],
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
    score_card: {
      position_size_pct_of_notional: 0,
      mean_investment_amount: null,
      rationale: "Run valuation to produce a score.",
    },
    technical_analysis: {
      status: "unavailable",
      analysis: {},
      error: "Technical analysis is not available for this report yet.",
    },
    market_review: {
      status: "unavailable",
      name_of_market: "",
      competitors: [],
      review_markdown: "",
      market_agent_markdown: "",
      error: "Market review is not available for this report yet.",
    },
    wall_st: {
      status: "unavailable",
      raw: {
        targets: {},
        recommendations: null,
        down_upgrades: null,
        earnings_estimate: null,
        revenue_estimate: null,
        num_of_analysts: 0,
        currency: {
          original_price_currency: "USD",
          original_financial_currency: "USD",
          price_currency_to_USD: 1,
          financial_currency_to_USD: 1,
        },
      },
      metrics: {
        targets: {},
        recommendations: {
          latest: {},
          previous: {},
          total: 0,
          stance_score: null,
          buy_side_pct: null,
          sell_side_pct: null,
          trend: "unavailable",
          posture: "unavailable",
        },
        recent_actions: [],
        earnings_rows: [],
        revenue_rows: [],
      },
      synthesis: {
        status: "unavailable",
        bullets: [],
      },
      errors: ["Run a fresh analysis to populate analyst expectation data."],
    },
    sec_qna: {
      status: "unavailable",
      ticker: tk,
      text: "",
      questions: [],
      answers: [],
      errors: [],
    },
    artifacts: {},
    downloads: {
      analysis_pdf: `/api/artifacts/${tk}/analysis-pdf`,
      prices_explain_pdf: `/api/artifacts/${tk}/prices-explain-pdf`,
      valuation_pdf: `/api/artifacts/${tk}/valuation-pdf`,
      combined_pdf: `/api/artifacts/${tk}/combined-pdf`,
    },
  };
}
