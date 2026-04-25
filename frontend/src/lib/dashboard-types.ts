export type DashboardMethodBlock = {
  name: string;
  target_price: number | null;
  upside_pct: number | null;
  investment_amount: number | null;
  investment_pct: number | null;
  key_metric_means: Record<string, number>;
  sample_rationale: string;
};

export type DashboardMethodOutput = {
  output_id: number;
  persona: string;
  target_price: number | null;
  investment_amount: number | null;
  key_numeric_values: Array<{
    path: string;
    metric_key: string;
    label: string;
    value: number;
  }>;
  reason_sections: Array<{
    path: string;
    label: string;
    text: string;
  }>;
};

export type DashboardMethodTab = {
  name: string;
  target_price: number | null;
  investment_amount: number | null;
  key_metric_means: Record<string, number>;
  outputs: DashboardMethodOutput[];
};

export type DashboardPayload = {
  dashboard_version?: string;
  generated_at?: string;
  analysis_duration_minutes?: number | null;
  report_id?: string;
  report_file?: string;
  report_mtime?: string;
  ticker: string;
  header: {
    company_name?: string;
    current_price?: number | null;
    market_cap?: number | null;
    shares_outstanding?: number | null;
    currency?: string;
    display_currency?: "USD" | "ILS" | string;
    is_israeli?: boolean;
    original_price_currency?: string;
    original_financial_currency?: string;
    price_currency_to_usd?: number | null;
    financial_currency_to_usd?: number | null;
    price_usd_to_display?: number | null;
    financial_usd_to_display?: number | null;
    price_unit_note?: string;
    price_performance_pct?: {
      "1D"?: number | null;
      "1W"?: number | null;
      "1M"?: number | null;
      "3M"?: number | null;
      "6M"?: number | null;
      "1Y"?: number | null;
      "3Y"?: number | null;
      "5Y"?: number | null;
    };
    f_score_text?: string;
  };
  red_flag_shield: string[];
  analysis_matrix: {
    executive_summary_markdown: string;
    bull_case_reasons?: string[];
    bear_case_reasons?: string[];
    key_insights: string[];
    bull_insights: string[];
    red_flag_insights: string[];
    swot: {
      strengths: string[];
      weaknesses: string[];
      opportunities: string[];
      threats: string[];
    };
    documents?: {
      executive_summary?: {
        company?: string;
        document_type?: string;
        executive_summary?: string;
        key_takeaways?: string[];
      };
      bull_case?: {
        company?: string;
        document_type?: string;
        reasons?: string[];
      };
      bear_case?: {
        company?: string;
        document_type?: string;
        reasons?: string[];
      };
    };
    structural_shift?: {
      triggered: boolean;
      direction: "up" | "down" | "none";
      change_pct_52w: number | null;
    };
    source?: string;
  };
  valuation_hub: {
    method_blocks: DashboardMethodBlock[];
    method_tabs?: DashboardMethodTab[];
    all_values?: {
      metric_means?: Array<{
        metric_key: string;
        label: string;
        mean: number;
        min: number;
        max: number;
        sample_count: number;
        method_count: number;
        methods: string[];
        source_paths: string[];
      }>;
      source_values?: Array<{
        method: string;
        persona: string;
        metric_key: string;
        metric_path: string;
        label: string;
        value: number;
      }>;
    };
    consensus: {
      current_price?: number | null;
      mean_target_price?: number | null;
      std?: number | null;
      cv?: number | null;
      lmil?: number[] | null;
    };
    prices?: Record<string, unknown>;
    revenue?: Record<string, unknown>;
    net_income?: Record<string, unknown>;
    pe?: Record<string, unknown>;
  };
  dream_team: Array<{
    persona: string;
    target_price: number | null;
    target_market_cap: number | null;
    investment_amount: number | null;
    step_by_step_analysis?: string;
    target_market_cap_rationale?: string;
    investment_rationale?: string;
  }>;
  forecast_forensic_matrix: {
    current_revenue: number | null;
    target_revenue: number | null;
    current_earnings: number | null;
    target_earnings: number | null;
    forensic_flags: string[];
  };
  decision_card: {
    action: string;
    position_size_pct_of_notional: number;
    mean_investment_amount: number | null;
    target_return_pct?: number | null;
    combined_score?: number | null;
    overall_cv?: number | null;
    confidence_factor?: number | null;
    adjusted_score?: number | null;
    rationale: string;
  };
  artifacts: {
    analysis_txt?: string;
    prices_plot?: string;
    revenue_plot?: string;
    net_income_plot?: string;
    prices_explain_txt?: string;
    analysis_pdf?: string;
    prices_explain_pdf?: string;
    dashboard_json?: string;
  };
  downloads?: {
    analysis_pdf: string;
    prices_explain_txt?: string;
    prices_explain_pdf?: string;
    dashboard_json?: string;
    analysis_txt?: string;
  };
};

export type DiscoveryRow = {
  ticker: string;
  company_name: string;
  margin_safety_pct: number;
  overvaluation_pct: number;
  dispersion: number;
  return_pct: number;
  confidence_cv: number;
  decision_label?: string;
  decision_tone?: "buy" | "sell" | "hold";
  updated_at: string;
};

export type ReportListItem = {
  report_id: string;
  ticker: string;
  generated_at: string;
  report_file: string;
  updated_at: string;
};
