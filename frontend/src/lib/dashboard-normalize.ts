import fs from "node:fs";
import path from "node:path";

import { createFallbackDashboard } from "@/lib/dashboard-fallback";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { canonicalModelName } from "@/lib/method-display";
import { findLatestByFileName, readJson, readUtf8 } from "@/lib/server-outputs";

function asFinite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function inferLegacyModelTargetScale(payload: DashboardPayload): number {
  const displayCurrency = String(payload.header?.display_currency || payload.header?.currency || "").toUpperCase();
  const originalPriceCurrency = String(payload.header?.original_price_currency || "").toUpperCase();
  const isNonUsd =
    displayCurrency !== "USD" ||
    (originalPriceCurrency && originalPriceCurrency !== "USD");
  const fxFromHeader = asFinite(payload.header?.price_currency_to_usd);

  const consensusMean = asFinite(payload.valuation_hub?.consensus?.mean_target_price);
  if (consensusMean === null || Math.abs(consensusMean) < 1e-9) {
    return 1;
  }

  const targets = (payload.valuation_hub?.method_blocks || [])
    .map((row) => asFinite(row?.target_price))
    .filter((v): v is number => v !== null && Math.abs(v) > 1e-9)
    .map((v) => Math.abs(v));

  if (!targets.length) {
    return 1;
  }

  const mean = targets.reduce((sum, value) => sum + value, 0) / targets.length;
  if (!Number.isFinite(mean) || mean <= 0) {
    return 1;
  }

  const ratio = Math.abs(consensusMean) / mean;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 1;
  }

  if (ratio >= 0.8 && ratio <= 1.25) {
    return 1;
  }

  if (isNonUsd && typeof fxFromHeader === "number" && fxFromHeader > 0) {
    const closeness = ratio / fxFromHeader;
    if (closeness >= 0.7 && closeness <= 1.3) {
      return fxFromHeader;
    }
    return 1;
  }

  return ratio >= 5 ? ratio : 1;
}

function applyLegacyModelTargetScale(payload: DashboardPayload, scale: number): DashboardPayload {
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-9) {
    return payload;
  }

  const currentPrice = asFinite(payload.valuation_hub?.consensus?.current_price);
  const scaleValue = (value: number | null | undefined): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value * scale : null;

  const methodBlocks = (payload.valuation_hub?.method_blocks || []).map((block) => {
    const scaledTarget = scaleValue(block.target_price);
    const upside =
      typeof scaledTarget === "number" &&
      typeof currentPrice === "number" &&
      Math.abs(currentPrice) > 1e-9
        ? ((scaledTarget - currentPrice) / currentPrice) * 100
        : null;
    return {
      ...block,
      name: canonicalModelName(String(block.name || "")),
      target_price: scaledTarget,
      upside_pct: upside,
    };
  });

  const methodTabs = (payload.valuation_hub?.method_tabs || []).map((tab) => ({
    ...tab,
    name: canonicalModelName(String(tab.name || "")),
    target_price: scaleValue(tab.target_price),
    outputs: (tab.outputs || []).map((output) => ({
      ...output,
      target_price: scaleValue(output.target_price),
    })),
  }));

  const dreamTeam = (payload.dream_team || []).map((entry) => ({
    ...entry,
    target_price: scaleValue(entry.target_price),
  }));

  return {
    ...payload,
    valuation_hub: {
      ...payload.valuation_hub,
      method_blocks: methodBlocks,
      method_tabs: methodTabs,
    },
    dream_team: dreamTeam,
  };
}

function hasUsableTechnicalAnalysis(payload: DashboardPayload): boolean {
  const technical = payload.technical_analysis;
  if (!technical || typeof technical !== "object") return false;
  if (String(technical.status || "").toLowerCase() !== "success") return false;
  const analysis = technical.analysis;
  if (!analysis || typeof analysis !== "object") return false;
  const stepCount = Array.isArray(analysis.step_by_step_analysis) ? analysis.step_by_step_analysis.length : 0;
  const keyPointCount = Array.isArray(analysis.key_points) ? analysis.key_points.length : 0;
  return stepCount > 0 || keyPointCount > 0;
}

function normalizeTechnicalAnalysisPayload(
  raw: unknown,
  ticker: string,
): DashboardPayload["technical_analysis"] | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const analysis = (src.analysis && typeof src.analysis === "object" ? src.analysis : src) as Record<string, unknown>;
  const stepCount = Array.isArray(analysis.step_by_step_analysis) ? analysis.step_by_step_analysis.length : 0;
  const keyPointCount = Array.isArray(analysis.key_points) ? analysis.key_points.length : 0;
  if (stepCount === 0 && keyPointCount === 0) return null;
  return {
    status: String(src.status || "success"),
    generated_at: typeof src.generated_at === "string" ? src.generated_at : undefined,
    model: typeof src.model === "string" ? src.model : undefined,
    analysis: {
      ...(analysis as NonNullable<NonNullable<DashboardPayload["technical_analysis"]>["analysis"]>),
      ticker: String(analysis.ticker || ticker).toUpperCase(),
    },
  };
}

function hydrateTechnicalAnalysis(
  payload: DashboardPayload,
  ticker: string,
  reportMeta?: { reportId?: string; reportFile?: string; reportMtime?: string },
): DashboardPayload {
  if (hasUsableTechnicalAnalysis(payload)) return payload;

  const tk = ticker.toUpperCase();
  const candidates: string[] = [];

  const artifactJson = payload.artifacts?.technical_analysis_json;
  if (typeof artifactJson === "string" && artifactJson.trim()) {
    candidates.push(artifactJson.trim());
  }

  if (reportMeta?.reportFile) {
    candidates.push(path.join(path.dirname(reportMeta.reportFile), `${tk}_technical_analysis.json`));
  }

  const latestTechnical = findLatestByFileName(`${tk}_technical_analysis.json`);
  if (latestTechnical?.path) {
    candidates.push(latestTechnical.path);
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const candidatePath = String(candidate || "").trim();
    if (!candidatePath || seen.has(candidatePath)) continue;
    seen.add(candidatePath);
    if (!fs.existsSync(candidatePath)) continue;

    const parsed = readJson<unknown>(candidatePath);
    const normalized = normalizeTechnicalAnalysisPayload(parsed, tk);
    if (!normalized) continue;

    return {
      ...payload,
      technical_analysis: normalized,
      artifacts: {
        ...(payload.artifacts || {}),
        technical_analysis_json: candidatePath,
      },
    };
  }

  return payload;
}

export function normalizePayload(
  ticker: string,
  payload: DashboardPayload,
  reportMeta?: { reportId?: string; reportFile?: string; reportMtime?: string },
): DashboardPayload {
  const tk = ticker.toUpperCase();
  const base = createFallbackDashboard(tk);
  const normalizedBull = payload.analysis_matrix?.bull_case_reasons || payload.analysis_matrix?.bull_insights || [];
  const normalizedBear = payload.analysis_matrix?.bear_case_reasons || payload.analysis_matrix?.red_flag_insights || [];
  const merged: DashboardPayload = {
    ...base,
    ...payload,
    ticker: tk,
    generated_at: payload.generated_at || reportMeta?.reportMtime || new Date().toISOString(),
    header: { ...base.header, ...(payload.header || {}) },
    analysis_matrix: {
      ...base.analysis_matrix,
      ...(payload.analysis_matrix || {}),
      bull_case_reasons: normalizedBull,
      bear_case_reasons: normalizedBear,
      documents: {
        ...(base.analysis_matrix.documents || {}),
        ...(payload.analysis_matrix?.documents || {}),
      },
      swot: {
        ...base.analysis_matrix.swot,
        ...(payload.analysis_matrix?.swot || {}),
      },
    },
    valuation_hub: {
      ...base.valuation_hub,
      ...(payload.valuation_hub || {}),
      method_blocks: (payload.valuation_hub?.method_blocks || []).map((block) => ({
        ...block,
        name: canonicalModelName(String(block.name || "")),
      })),
      method_tabs: (payload.valuation_hub?.method_tabs || []).map((tab) => ({
        ...tab,
        name: canonicalModelName(String(tab.name || "")),
      })),
      all_values: payload.valuation_hub?.all_values || base.valuation_hub?.all_values,
      consensus: {
        ...base.valuation_hub.consensus,
        ...(payload.valuation_hub?.consensus || {}),
      },
    },
    forecast_forensic_matrix: {
      ...base.forecast_forensic_matrix,
      ...(payload.forecast_forensic_matrix || {}),
    },
    decision_card: {
      ...base.decision_card,
      ...(payload.decision_card || {}),
    },
    artifacts: {
      ...base.artifacts,
      ...(payload.artifacts || {}),
    },
    red_flag_shield: payload.red_flag_shield || [],
    dream_team: payload.dream_team || [],
    report_id: reportMeta?.reportId || payload.report_id,
    report_file: reportMeta?.reportFile || payload.report_file,
    report_mtime: reportMeta?.reportMtime || payload.report_mtime,
  };

  const reportQuery = merged.report_id
    ? `?report_id=${encodeURIComponent(String(merged.report_id))}`
    : "";

  merged.downloads = {
    analysis_pdf: `/api/artifacts/${tk}/analysis-pdf${reportQuery}`,
    analysis_txt: `/api/artifacts/${tk}/analysis-txt${reportQuery}`,
    prices_explain_txt: `/api/artifacts/${tk}/prices-explain-txt${reportQuery}`,
    prices_explain_pdf: `/api/artifacts/${tk}/prices-explain-pdf${reportQuery}`,
    dashboard_json: `/api/artifacts/${tk}/dashboard-json${reportQuery}`,
  };

  const scale = inferLegacyModelTargetScale(merged);
  const scaled = applyLegacyModelTargetScale(merged, scale);
  return hydrateTechnicalAnalysis(scaled, tk, reportMeta);
}

function parseMoney(text: string): number | null {
  const cleaned = String(text || "").replace(/[$,]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseAssumptionsPackRows(text: string, sourcePath: string) {
  const src = String(text || "");
  const specs = [
    { label: "Predicted Revenue", key: "predicted_revenue" },
    { label: "Predicted Earnings", key: "predicted_earnings" },
    { label: "Predicted P/E", key: "predicted_pe" },
  ];
  const rows: Array<{
    metric_key: string;
    label: string;
    mean: number;
    min: number;
    max: number;
    sample_count: number;
    method_count: number;
    methods: string[];
    source_paths: string[];
  }> = [];

  for (const spec of specs) {
    const escaped = spec.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(
      `-\\s*${escaped}\\s*\\(Mean\\/Min\\/Max\\):\\s*([+-]?[0-9,]+(?:\\.[0-9]+)?)\\s*\\/\\s*([+-]?[0-9,]+(?:\\.[0-9]+)?)\\s*\\/\\s*([+-]?[0-9,]+(?:\\.[0-9]+)?)`,
      "i",
    );
    const match = src.match(rx);
    if (!match) continue;
    const mean = parseMoney(match[1]);
    const min = parseMoney(match[2]);
    const max = parseMoney(match[3]);
    if (mean === null || min === null || max === null) continue;
    rows.push({
      metric_key: spec.key,
      label: spec.label,
      mean,
      min,
      max,
      sample_count: 1,
      method_count: 1,
      methods: ["Overall"],
      source_paths: [sourcePath],
    });
  }
  return rows;
}

export function buildFallbackFromArtifacts(ticker: string): DashboardPayload {
  const base = createFallbackDashboard(ticker);
  const analysisFile = findLatestByFileName(`${ticker}_analysis.txt`);
  const explainFile = findLatestByFileName(`${ticker}_prices_explain.txt`);

  if (analysisFile) {
    const analysisText = readUtf8(analysisFile.path);
    base.generated_at = new Date(analysisFile.mtimeMs).toISOString();
    base.report_file = analysisFile.path;
    base.report_mtime = new Date(analysisFile.mtimeMs).toISOString();
    base.analysis_matrix.executive_summary_markdown = analysisText.slice(0, 7000);

    const bullets = analysisText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim());
    const bull = bullets.filter((x) => /growth|moat|margin|pricing|cash|scale|upside/i.test(x)).slice(0, 15);
    const bear = bullets.filter((x) => /risk|debt|dilution|pressure|decline|weak|headwind/i.test(x)).slice(0, 15);
    base.analysis_matrix.bull_case_reasons = bull;
    base.analysis_matrix.bear_case_reasons = bear;
    base.analysis_matrix.key_insights = [];
    base.analysis_matrix.bull_insights = bull.slice(0, 10);
    base.analysis_matrix.red_flag_insights = [];
    base.analysis_matrix.documents = {
      ...(base.analysis_matrix.documents || {}),
      bull_case: {
        company: ticker,
        document_type: "bull_case",
        reasons: bull,
      },
      bear_case: {
        company: ticker,
        document_type: "bear_case",
        reasons: bear,
      },
    };

    const p = analysisText.match(/Current Price:\s*([0-9.,]+)/i);
    if (p) {
      base.header.current_price = parseMoney(p[1]);
      base.valuation_hub.consensus.current_price = parseMoney(p[1]);
    }

    const fLine = analysisText.match(/Piotroski F-Score[\s\S]{0,500}/i);
    if (fLine) {
      base.header.f_score_text = fLine[0];
    }
  }

  if (explainFile) {
    const txt = readUtf8(explainFile.path);
    const assumptionsRows = parseAssumptionsPackRows(txt, "prices_explain.assumptions_pack");
    if (assumptionsRows.length) {
      const existing = base.valuation_hub.all_values?.metric_means || [];
      base.valuation_hub.all_values = {
        metric_means: [...existing, ...assumptionsRows],
        source_values: base.valuation_hub.all_values?.source_values || [],
      };
    }

    const sections = txt.split(/\n##\s+/g);
    const blocks: DashboardPayload["valuation_hub"]["method_blocks"] = [];

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed || !/Method Target Price:/i.test(trimmed)) {
        continue;
      }
      const titleLine = trimmed.split("\n")[0].replace(/^#+\s*/, "").trim();
      const targetMatch = trimmed.match(/Method Target Price:\s*\$?([0-9,.\-]+)/i);
      const investMatch = trimmed.match(/Method Mean Investment:\s*\$?([0-9,.\-]+)/i);

      const keyMetricPairs: Record<string, number> = {};
      const numericSection = trimmed.match(/#### Key Numeric Values([\s\S]*?)(####|###|$)/i);
      if (numericSection) {
        const metricLines = numericSection[1]
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("- "));
        for (const line of metricLines) {
          const pair = line.slice(2).split(":");
          if (pair.length < 2) {
            continue;
          }
          const key = pair[0].trim().replace(/\s+/g, "_");
          const val = Number(pair.slice(1).join(":").trim().replace(/,/g, ""));
          if (Number.isFinite(val)) {
            keyMetricPairs[key] = val;
          }
        }
      }

      const targetPrice = parseMoney(targetMatch?.[1] || "");
      const current = base.valuation_hub.consensus.current_price || 0;
      const upside = current && targetPrice ? ((targetPrice - current) / current) * 100 : null;
      const invest = parseMoney(investMatch?.[1] || "");
      blocks.push({
        name: canonicalModelName(titleLine),
        target_price: targetPrice,
        upside_pct: upside,
        investment_amount: invest,
        investment_pct: invest !== null ? (invest / 100000) * 100 : null,
        key_metric_means: keyMetricPairs,
        sample_rationale: "",
      });
    }

    if (blocks.length) {
      base.valuation_hub.method_blocks = blocks;
      const targets = blocks.map((b) => b.target_price).filter((v): v is number => typeof v === "number");
      if (targets.length) {
        base.valuation_hub.consensus.mean_target_price =
          targets.reduce((acc, v) => acc + v, 0) / targets.length;
      }
    }
  }

  return base;
}
