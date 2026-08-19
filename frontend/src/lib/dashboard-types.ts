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

export type TradingAgentsPayload = {
  status?: "success" | "unavailable" | "error" | string;
  ticker?: string;
  generated_at?: string;
  reused?: boolean;
  reused_at?: string;
  reused_from?: string;
  original_generated_at?: string;
  adapter_version?: string;
  config_version?: string;
  provider?: string;
  quick_think_llm?: string;
  deep_think_llm?: string;
  selected_analysts?: string[];
  excluded_analysts?: string[];
  error?: string;
  research_brief?: string;
  compacted?: boolean;
  summary_model?: string;
  fundamentals_report?: string;
  news_report?: string;
  sentiment_report?: string;
  bull_bear_debate?: string;
  risk_debate?: string;
  final_committee_view?: string;
  rating?: string;
  price_target?: number | null;
  time_horizon?: string;
  valuation_prompt_excluded_fields?: string[];
  artifact_json?: string;
  artifact_txt?: string;
};

export type MarketReviewPayload = {
  status?: "success" | "unavailable" | "error" | string;
  generated_at?: string | null;
  name_of_market?: string;
  original_company?: {
    ticker?: string;
    company_name?: string;
    info?: Record<string, unknown>;
    annual_financials?: string;
  };
  competitors?: Array<{
    rank?: number;
    ticker?: string;
    company_name?: string;
    info?: Record<string, unknown>;
    annual_financials?: string;
    similarity_rationale?: string;
    overlap_notes?: string;
    confidence?: string | number | null;
    status?: string;
    error?: string;
  }>;
  return_comparison?: {
    status?: string;
    generated_at?: string;
    period?: string;
    series?: Array<{
      ticker?: string;
      company_name?: string;
      prices?: Array<{
        date?: string;
        close?: number;
      }>;
    }>;
    error?: string;
  };
  review_markdown?: string;
  market_agent_markdown?: string;
  error?: string;
};

export type WallStPayload = {
  status?: "success" | "unavailable" | "error" | string;
  generated_at?: string;
  raw?: {
    targets?: {
      current?: number | null;
      mean?: number | null;
      median?: number | null;
      low?: number | null;
      high?: number | null;
    };
    recommendations?: TablePayload | string | null;
    down_upgrades?: TablePayload | string | null;
    earnings_estimate?: TablePayload | string | null;
    revenue_estimate?: TablePayload | string | null;
    num_of_analysts?: number;
    currency?: {
      original_price_currency?: string;
      original_financial_currency?: string;
      price_currency_to_USD?: number | null;
      financial_currency_to_USD?: number | null;
    };
  };
  metrics?: {
    targets?: {
      current?: number | null;
      mean?: number | null;
      median?: number | null;
      low?: number | null;
      high?: number | null;
      upside_pct?: number | null;
      range_spread_pct?: number | null;
      tone?: "up" | "down" | "neutral" | string;
    };
    recommendations?: {
      latest?: Record<string, unknown>;
      previous?: Record<string, unknown>;
      total?: number;
      stance_score?: number | null;
      buy_side_pct?: number | null;
      sell_side_pct?: number | null;
      trend?: string;
      posture?: string;
    };
    recent_actions?: Array<Record<string, unknown>>;
    earnings_rows?: Array<Record<string, unknown>>;
    revenue_rows?: Array<Record<string, unknown>>;
  };
  synthesis?: {
    status?: "success" | "unavailable" | "error" | string;
    bullets?: string[];
    error?: string;
  };
  errors?: string[];
};

export type TablePayload = {
  index?: string[];
  columns?: string[];
  values?: unknown[][];
};

export type SecQnaPayload = {
  status?: "success" | "unavailable" | "failed" | "error" | string;
  ticker?: string;
  text?: string;
  questions?: string[];
  answers?: Array<{
    question?: string;
    answer?: string;
    evidence?: string;
    filing_refs?: string[];
    confidence?: string;
  }>;
  errors?: string[];
};

export type FinancialsPayload = {
  status?: "success" | "error" | "unavailable" | string;
  generated_at?: string;
  model?: string;
  error?: string;
  analysis?: {
    ticker?: string;
    currency?: string;
    unit?: string;
    title?: string;
    subtitle?: string;
    periods?: Array<{
      key?: string;
      label?: string;
      date?: string;
      period_type?: "annual" | "quarterly" | string;
    }>;
    rows?: Array<{
      metric?: string;
      kind?: "currency" | "percent" | "ratio" | "count" | string;
      values?: Record<string, number | null>;
      quality?: "reported" | "derived" | "unavailable" | "mixed" | string;
      note?: string;
    }>;
    current_metrics?: Array<{
      metric?: string;
      kind?: "currency" | "percent" | "ratio" | "count" | string;
      value?: number | null;
      quality?: "reported" | "derived" | "unavailable" | "mixed" | string;
      note?: string;
    }>;
    added_rows?: string[];
    key_takeaways?: string[];
    warnings?: string[];
  };
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
  };
  red_flag_shield: string[];
  analysis_matrix: {
    executive_summary_markdown: string;
    bull_case_reasons?: string[];
    bear_case_reasons?: string[];
    main_thesis_questions?: string[];
    watchlist_kpis?: Array<{
      name?: string;
      why_it_matters?: string;
      direction_to_watch?: string;
    }>;
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
      main_thesis?: {
        company?: string;
        document_type?: string;
        valuation_revolves_around?: string;
        main_questions?: string[];
        kpis?: Array<{
          name?: string;
          why_it_matters?: string;
          direction_to_watch?: string;
        }>;
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
        current_value?: number | null;
      }>;
      source_values?: Array<{
        method: string;
        persona: string;
        metric_key: string;
        metric_path: string;
        label: string;
        value: number;
      }>;
      assumption_current_values?: Record<string, number | null>;
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
  score_card?: {
    position_size_pct_of_notional: number;
    mean_investment_amount: number | null;
    target_return_pct?: number | null;
    combined_score?: number | null;
    overall_cv?: number | null;
    confidence_factor?: number | null;
    adjusted_score?: number | null;
    rationale: string;
  };
  decision_card?: {
    action?: string;
    position_size_pct_of_notional?: number;
    mean_investment_amount?: number | null;
    target_return_pct?: number | null;
    combined_score?: number | null;
    overall_cv?: number | null;
    confidence_factor?: number | null;
    adjusted_score?: number | null;
    rationale?: string;
  };
  technical_analysis?: {
    status?: "success" | "error" | "unavailable" | string;
    generated_at?: string;
    model?: string;
    error?: string;
    analysis?: {
      ticker?: string;
      analysis_date?: string;
      step_by_step_analysis?: Array<{
        step?: number;
        title?: string;
        bullets?: string[];
      }>;
      key_points?: string[];
      bullish_points?: string[];
      bearish_points?: string[];
      contradictions_or_divergences?: string[];
      volume_insights?: string[];
      momentum_insights?: string[];
      risk_signals?: string[];
      target_price_levels?: {
        support_levels?: Array<{ price?: number; reason?: string; confidence?: string }>;
        resistance_levels?: Array<{ price?: number; reason?: string; confidence?: string }>;
        bullish_targets?: Array<{ price?: number; reason?: string; timeframe?: string; confidence?: string }>;
        bearish_targets?: Array<{ price?: number; reason?: string; timeframe?: string; confidence?: string }>;
      };
      scenario_analysis?: {
        bullish_case?: {
          summary?: string;
          conditions?: string[];
          target_zone?: { low?: number; high?: number };
        };
        base_case?: {
          summary?: string;
          conditions?: string[];
          target_zone?: { low?: number; high?: number };
        };
        bearish_case?: {
          summary?: string;
          conditions?: string[];
          target_zone?: { low?: number; high?: number };
        };
      };
      what_to_watch_next?: string[];
      confidence_score?: number;
      bullish_probability?: number;
      bearish_probability?: number;
      final_decision?: "bullish" | "bearish" | "neutral" | string;
      confidence_explanation?: string;
    };
  };
  trading_agents?: TradingAgentsPayload;
  market_review?: MarketReviewPayload;
  wall_st?: WallStPayload;
  financials?: FinancialsPayload;
  sec_qna?: SecQnaPayload;
  filings?: {
    annual?: {
      available?: boolean;
      source?: string;
      form_type?: string;
      date?: string;
      source_url?: string;
    };
    quarterly?: {
      available?: boolean;
      source?: string;
      form_type?: string;
      date?: string;
      source_url?: string;
    };
  };
  artifacts: {
    analysis_txt?: string;
    prices_plot?: string;
    revenue_plot?: string;
    net_income_plot?: string;
    prices_explain_txt?: string;
    analysis_pdf?: string;
    prices_explain_pdf?: string;
    combined_pdf?: string;
    dashboard_json?: string;
    technical_analysis_json?: string;
    financials_json?: string;
    trading_agents_json?: string;
    trading_agents_txt?: string;
    market_review_json?: string;
  };
  downloads?: {
    analysis_pdf: string;
    prices_explain_txt?: string;
    prices_explain_pdf?: string;
    valuation_pdf?: string;
    combined_pdf?: string;
    dashboard_json?: string;
    analysis_txt?: string;
    market_review_json?: string;
    financials_json?: string;
  };
};

export type DiscoveryRow = {
  ticker: string;
  company_name: string;
  margin_safety_pct: number;
  overvaluation_pct: number;
  dispersion: number;
  return_pct: number;
  investment_allocation_pct: number | null;
  confidence_cv: number;
  points_score?: number | null;
  updated_at: string;
};

export type ReportListItem = {
  report_id: string;
  ticker: string;
  generated_at: string;
  report_file: string;
  updated_at: string;
  score?: number | null;
  mean_target_price?: number | null;
  allocation_pct?: number | null;
};
