import fs from "node:fs";

import { NextResponse } from "next/server";

import { createFallbackDashboard } from "@/lib/dashboard-fallback";
import { DashboardPayload } from "@/lib/dashboard-types";
import {
  findLatestByFileName,
  readJson,
  readUtf8,
  resolveDashboardReportPath,
} from "@/lib/server-outputs";

function normalizePayload(
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
      method_blocks: payload.valuation_hub?.method_blocks || [],
      method_tabs: payload.valuation_hub?.method_tabs || [],
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

  merged.downloads = {
    analysis_pdf: `/api/artifacts/${tk}/analysis-pdf`,
  };

  return merged;
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

function buildFallbackFromArtifacts(ticker: string): DashboardPayload {
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
        name: titleLine,
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

export async function GET(
  req: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const params = await context.params;
  const ticker = String(params.ticker || "").toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required." }, { status: 400 });
  }
  const url = new URL(req.url);
  const requestedReportId = String(url.searchParams.get("report") || "").trim();

  let dashboardPath = "";
  let dashboardMtime = 0;

  if (requestedReportId) {
    const resolved = resolveDashboardReportPath(requestedReportId);
    if (resolved) {
      const base = resolved.split(/[\\/]/).pop() || "";
      if (base.toUpperCase().startsWith(`${ticker}_DASHBOARD.JSON`)) {
        dashboardPath = resolved;
        try {
          dashboardMtime = fs.statSync(resolved).mtimeMs;
        } catch {
          dashboardMtime = 0;
        }
      }
    }
  }

  if (!dashboardPath) {
    const dashboardName = `${ticker}_dashboard.json`;
    const latest = findLatestByFileName(dashboardName);
    if (latest) {
      dashboardPath = latest.path;
      dashboardMtime = latest.mtimeMs;
    }
  }

  if (!dashboardPath) {
    return NextResponse.json(
      normalizePayload(ticker, buildFallbackFromArtifacts(ticker), {
        reportId: requestedReportId || undefined,
      }),
    );
  }

  const parsed = readJson<DashboardPayload>(dashboardPath);
  if (!parsed) {
    return NextResponse.json(
      normalizePayload(ticker, buildFallbackFromArtifacts(ticker), {
        reportId: requestedReportId || undefined,
        reportFile: dashboardPath,
        reportMtime: dashboardMtime ? new Date(dashboardMtime).toISOString() : undefined,
      }),
    );
  }

  return NextResponse.json(
    normalizePayload(ticker, parsed, {
      reportId: requestedReportId || undefined,
      reportFile: dashboardPath,
      reportMtime: dashboardMtime ? new Date(dashboardMtime).toISOString() : undefined,
    }),
  );
}
