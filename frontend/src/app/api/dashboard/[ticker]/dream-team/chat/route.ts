import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { fetchReportById } from "@/lib/reports-db";
import { normalizePayload } from "@/lib/dashboard-normalize";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { parseJsonObjectFromMixedOutput } from "@/lib/python-json";
import { repoRoot, TICKER_RE } from "@/lib/site-runner";
import { readJson, resolveDashboardReportPath } from "@/lib/server-outputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatAction = "chat" | "fetch_filings";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type FilingSnippet = {
  available: boolean;
  source: string;
  form_type: string;
  date: string;
  text: string;
};

type FinancialContext = {
  all_reports: string;
  info: unknown;
  currency_statement: string;
  info_financials: unknown;
  rate: unknown;
};

type ContextCacheEntry = {
  financial: FinancialContext | null;
  annual: FilingSnippet | null;
  quarterly: FilingSnippet | null;
  expires_at: number;
};

type PythonContextPayload = {
  ok?: boolean;
  error?: string;
  financial_dict?: Partial<FinancialContext>;
  filings?: {
    annual?: Partial<FilingSnippet>;
    quarterly?: Partial<FilingSnippet>;
  };
};

const CACHE_TTL_MS = 20 * 60 * 1000;
const CONTEXT_CACHE = new Map<string, ContextCacheEntry>();

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 3500;
const MAX_USER_MESSAGE_CHARS = 4000;

function trimText(value: unknown, maxChars: number): string {
  const text = String(value ?? "");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function cacheKey(ticker: string, reportId: string): string {
  return `${String(ticker || "").toUpperCase()}::${String(reportId || "").trim()}`;
}

function getCache(key: string): ContextCacheEntry | null {
  const row = CONTEXT_CACHE.get(key);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    CONTEXT_CACHE.delete(key);
    return null;
  }
  return row;
}

function upsertCache(key: string, patch: Partial<ContextCacheEntry>): ContextCacheEntry {
  const prev = getCache(key);
  const next: ContextCacheEntry = {
    financial: patch.financial ?? prev?.financial ?? null,
    annual: patch.annual ?? prev?.annual ?? null,
    quarterly: patch.quarterly ?? prev?.quarterly ?? null,
    expires_at: Date.now() + CACHE_TTL_MS,
  };
  CONTEXT_CACHE.set(key, next);
  return next;
}

function normalizeFiling(value: Partial<FilingSnippet> | null | undefined): FilingSnippet {
  return {
    available: Boolean(value?.available),
    source: String(value?.source || ""),
    form_type: String(value?.form_type || ""),
    date: String(value?.date || ""),
    text: String(value?.text || ""),
  };
}

function normalizeFinancial(value: Partial<FinancialContext> | null | undefined): FinancialContext {
  return {
    all_reports: String(value?.all_reports || ""),
    info: value?.info ?? {},
    currency_statement: String(value?.currency_statement || ""),
    info_financials: value?.info_financials ?? {},
    rate: value?.rate ?? 0,
  };
}

function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const roleRaw = String((item as { role?: string }).role || "").toLowerCase().trim();
    if (roleRaw !== "user" && roleRaw !== "assistant") continue;
    const content = trimText((item as { content?: unknown }).content, MAX_MESSAGE_CHARS).trim();
    if (!content) continue;
    out.push({ role: roleRaw, content });
  }
  return out;
}

function hasPersona(payload: DashboardPayload, persona: string): boolean {
  const target = String(persona || "").trim().toLowerCase();
  if (!target) return false;

  const hasDream = (payload.dream_team || []).some(
    (row) => String(row.persona || "").trim().toLowerCase() === target,
  );
  if (hasDream) return true;

  const tab = (payload.valuation_hub?.method_tabs || []).find(
    (row) => String(row.name || "").trim().toLowerCase() === "dream team",
  );
  const hasOutput = (tab?.outputs || []).some(
    (row) => String(row.persona || "").trim().toLowerCase() === target,
  );
  return hasOutput;
}

function collectPersonaPlainText(payload: DashboardPayload, persona: string): string {
  const target = String(persona || "").trim().toLowerCase();
  const chunks: string[] = [];

  const dreamCard = (payload.dream_team || []).find(
    (row) => String(row.persona || "").trim().toLowerCase() === target,
  );
  if (dreamCard) {
    if (dreamCard.step_by_step_analysis) chunks.push(String(dreamCard.step_by_step_analysis));
    if (dreamCard.target_market_cap_rationale) chunks.push(String(dreamCard.target_market_cap_rationale));
    if (dreamCard.investment_rationale) chunks.push(String(dreamCard.investment_rationale));
  }

  const dreamTab = (payload.valuation_hub?.method_tabs || []).find(
    (row) => String(row.name || "").trim().toLowerCase() === "dream team",
  );
  const output = (dreamTab?.outputs || []).find(
    (row) => String(row.persona || "").trim().toLowerCase() === target,
  );
  for (const section of output?.reason_sections || []) {
    const label = String(section.label || "").trim();
    const text = String(section.text || "").trim();
    if (!text) continue;
    chunks.push(label ? `${label}: ${text}` : text);
  }

  return trimText(chunks.join("\n\n"), 40000);
}

function toContextBlocks(args: {
  analysisText: string;
  financial: FinancialContext;
  personaPlainText: string;
  annualText: string;
  quarterlyText: string;
}): Record<string, unknown> {
  return {
    analysis_text: trimText(args.analysisText, 50000),
    all_reports: trimText(args.financial.all_reports, 50000),
    financial_info: args.financial.info ?? {},
    currency_statement: trimText(args.financial.currency_statement, 8000),
    today_date: new Date().toISOString().slice(0, 10),
    info_financials: args.financial.info_financials ?? {},
    rate: args.financial.rate ?? 0,
    persona_prior_text: trimText(args.personaPlainText, 35000),
    annual_report_text: trimText(args.annualText, 50000),
    quarterly_report_text: trimText(args.quarterlyText, 50000),
  };
}

async function runPythonJson(scriptName: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const root = repoRoot();
  const scriptPath = path.resolve(root, "scripts", scriptName);
  const pythonExe = process.env.PYTHON_EXECUTABLE || "python";

  return await new Promise((resolve, reject) => {
    const child = spawn(pythonExe, [scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: path.resolve(root, "src"),
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const stderrSnippet = trimText(stderr, 800);
        const stdoutSnippet = trimText(stdout, 800);
        reject(
          new Error(
            `${scriptName} exited with ${code}. stderr=${JSON.stringify(stderrSnippet)} stdout=${JSON.stringify(stdoutSnippet)}`,
          ),
        );
        return;
      }
      const parsed = parseJsonObjectFromMixedOutput(stdout);
      if (parsed) {
        resolve(parsed);
      } else {
        const stderrSnippet = trimText(stderr, 800);
        const stdoutSnippet = trimText(stdout, 800);
        reject(
          new Error(
            `Invalid JSON from ${scriptName}. stderr=${JSON.stringify(stderrSnippet)} stdout=${JSON.stringify(stdoutSnippet)}`,
          ),
        );
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function fetchPythonContext(ticker: string, includeAnnual: boolean, includeQuarterly: boolean): Promise<PythonContextPayload> {
  const raw = await runPythonJson("dream_team_context.py", {
    ticker,
    include_annual: includeAnnual,
    include_quarterly: includeQuarterly,
  });
  return raw as PythonContextPayload;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const params = await context.params;
  const ticker = String(params.ticker || "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const action = String(body.action || "").trim() as ChatAction;
  if (action !== "chat" && action !== "fetch_filings") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const reportId = String(body.report_id || "").trim();
  const persona = String(body.persona || "").trim();
  const includeAnnual = Boolean(body.include_annual);
  const includeQuarterly = Boolean(body.include_quarterly);

  if (!reportId) return NextResponse.json({ error: "report_id is required." }, { status: 400 });
  if (!persona) return NextResponse.json({ error: "persona is required." }, { status: 400 });

  let reportRow: Awaited<ReturnType<typeof fetchReportById>> | null = null;
  let localDashboardPath = "";
  let localDashboard: DashboardPayload | null = null;
  try {
    reportRow = await fetchReportById(reportId);
  } catch {
    reportRow = null;
  }
  if (!reportRow) {
    localDashboardPath = String(resolveDashboardReportPath(reportId) || "");
    if (!localDashboardPath) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
    localDashboard = readJson<DashboardPayload>(localDashboardPath);
    if (!localDashboard) {
      return NextResponse.json({ error: "Failed to load local report payload." }, { status: 500 });
    }
    if (String(localDashboard.ticker || "").trim().toUpperCase() !== ticker) {
      return NextResponse.json({ error: "report_id does not match ticker." }, { status: 400 });
    }
  } else if (String(reportRow.ticker || "").toUpperCase() !== ticker) {
    return NextResponse.json({ error: "report_id does not match ticker." }, { status: 400 });
  }

  const payload = reportRow
    ? normalizePayload(
        ticker,
        ((reportRow.dashboard as DashboardPayload | null) || {}) as DashboardPayload,
        {
          reportId: reportRow.id,
          reportMtime: new Date(reportRow.generated_at).toISOString(),
        },
      )
    : normalizePayload(
        ticker,
        localDashboard || ({} as DashboardPayload),
        {
          reportId,
          reportFile: localDashboardPath,
          reportMtime: fs.existsSync(localDashboardPath)
            ? new Date(fs.statSync(localDashboardPath).mtimeMs).toISOString()
            : undefined,
        },
      );
  if (!hasPersona(payload, persona)) {
    return NextResponse.json({ error: "Persona not found in selected report." }, { status: 400 });
  }

  const key = cacheKey(ticker, reportId);
  let cache = getCache(key);

  if (!cache?.financial) {
    try {
      const contextOut = await fetchPythonContext(ticker, false, false);
      if (!contextOut.ok) {
        return NextResponse.json({ error: contextOut.error || "Failed to build context." }, { status: 500 });
      }
      cache = upsertCache(key, { financial: normalizeFinancial(contextOut.financial_dict) });
    } catch (err) {
      return NextResponse.json({ error: `Failed to build context: ${String(err)}` }, { status: 500 });
    }
  }

  if (action === "fetch_filings") {
    if (!includeAnnual && !includeQuarterly) {
      return NextResponse.json({ error: "At least one filing toggle is required." }, { status: 400 });
    }
    try {
      const filingOut = await fetchPythonContext(ticker, includeAnnual, includeQuarterly);
      if (!filingOut.ok) {
        return NextResponse.json({ error: filingOut.error || "Failed to fetch filings." }, { status: 500 });
      }
      const annual = includeAnnual ? normalizeFiling(filingOut.filings?.annual) : cache?.annual ?? null;
      const quarterly = includeQuarterly ? normalizeFiling(filingOut.filings?.quarterly) : cache?.quarterly ?? null;
      cache = upsertCache(key, {
        annual: annual ?? null,
        quarterly: quarterly ?? null,
      });
      return NextResponse.json({
        ok: true,
        filings: {
          annual: cache.annual,
          quarterly: cache.quarterly,
        },
      });
    } catch (err) {
      return NextResponse.json({ error: `Failed to fetch filings: ${String(err)}` }, { status: 500 });
    }
  }

  const userMessage = trimText(body.user_message, MAX_USER_MESSAGE_CHARS).trim();
  if (!userMessage) {
    return NextResponse.json({ error: "user_message is required for chat action." }, { status: 400 });
  }

  const messages = normalizeMessages(body.messages);
  const personaPriorText = collectPersonaPlainText(payload, persona);
  const localAnalysisPath = localDashboardPath
    ? path.join(path.dirname(localDashboardPath), `${ticker}_analysis.txt`)
    : "";
  const localAnalysisText =
    localAnalysisPath && fs.existsSync(localAnalysisPath)
      ? fs.readFileSync(localAnalysisPath, "utf-8")
      : "";
  const analysisText = trimText(
    reportRow?.analysis_md || localAnalysisText || payload.analysis_matrix?.executive_summary_markdown || "",
    60000,
  );

  let annualText = "";
  let quarterlyText = "";

  const needAnnual = includeAnnual && !cache?.annual;
  const needQuarterly = includeQuarterly && !cache?.quarterly;
  if (needAnnual || needQuarterly) {
    try {
      const filingOut = await fetchPythonContext(ticker, needAnnual, needQuarterly);
      if (filingOut.ok) {
        cache = upsertCache(key, {
          annual: needAnnual ? normalizeFiling(filingOut.filings?.annual) : cache?.annual ?? null,
          quarterly: needQuarterly ? normalizeFiling(filingOut.filings?.quarterly) : cache?.quarterly ?? null,
        });
      }
    } catch {
      // Keep chat functional even if filing fetch fails; chat runs with base context only.
    }
  }

  if (includeAnnual && cache?.annual?.available) {
    annualText = trimText(
      `[${cache.annual.source} ${cache.annual.form_type} ${cache.annual.date}]\n${cache.annual.text}`,
      55000,
    );
  }
  if (includeQuarterly && cache?.quarterly?.available) {
    quarterlyText = trimText(
      `[${cache.quarterly.source} ${cache.quarterly.form_type} ${cache.quarterly.date}]\n${cache.quarterly.text}`,
      55000,
    );
  }

  const contextBlocks = toContextBlocks({
    analysisText,
    financial: cache?.financial || normalizeFinancial({}),
    personaPlainText: personaPriorText,
    annualText,
    quarterlyText,
  });

  try {
    const chatOut = await runPythonJson("dream_team_persona_chat.py", {
      ticker,
      persona,
      user_message: userMessage,
      messages,
      context_blocks: contextBlocks,
    });
    const reply = String(chatOut.reply || "").trim();
    if (!reply) {
      return NextResponse.json({ error: "Empty reply from persona model." }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      reply,
      model: String(chatOut.model || "deepseek-reasoner"),
      context: {
        annual_attached: Boolean(annualText),
        quarterly_attached: Boolean(quarterlyText),
      },
      filings: {
        annual: cache?.annual || null,
        quarterly: cache?.quarterly || null,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `Chat generation failed: ${String(err)}` }, { status: 500 });
  }
}
