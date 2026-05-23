import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { parseJsonObjectFromMixedOutput } from "@/lib/python-json";
import { repoRoot, TICKER_RE } from "@/lib/site-runner";

export type FilingKind = "annual" | "quarterly";

export type FilingSnippet = {
  available: boolean;
  source: string;
  form_type: string;
  date: string;
  source_url: string;
  text: string;
};

export type FilingsStatus = {
  ticker: string;
  filings: {
    annual: FilingSnippet;
    quarterly: FilingSnippet;
  };
  context_error?: string;
};

type DreamTeamContextPayload = {
  ok?: boolean;
  error?: string;
  context_error?: string;
  filings?: {
    annual?: Partial<FilingSnippet>;
    quarterly?: Partial<FilingSnippet>;
  };
};

type FilingPdfPayload = {
  ok?: boolean;
  error?: string;
  ticker?: string;
  kind?: string;
  pdf_path?: string;
  file_name?: string;
  filing?: Partial<FilingSnippet>;
};

type CacheEntry = {
  value: FilingsStatus;
  expiresAt: number;
};

const FILINGS_STATUS_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeFiling(value: Partial<FilingSnippet> | null | undefined): FilingSnippet {
  return {
    available: Boolean(value?.available),
    source: String(value?.source || ""),
    form_type: String(value?.form_type || ""),
    date: String(value?.date || ""),
    source_url: String(value?.source_url || ""),
    text: String(value?.text || ""),
  };
}

function readCache(ticker: string): FilingsStatus | null {
  const key = String(ticker || "").toUpperCase();
  const row = FILINGS_STATUS_CACHE.get(key);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    FILINGS_STATUS_CACHE.delete(key);
    return null;
  }
  return row.value;
}

function writeCache(status: FilingsStatus): void {
  const key = String(status.ticker || "").toUpperCase();
  FILINGS_STATUS_CACHE.set(key, {
    value: status,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function ensureTicker(ticker: string): string {
  const tk = String(ticker || "").trim().toUpperCase();
  if (!TICKER_RE.test(tk)) {
    throw new Error("Invalid ticker format.");
  }
  return tk;
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
        reject(
          new Error(
            `${scriptName} exited with ${code}. stderr=${JSON.stringify(stderr.slice(-1000))} stdout=${JSON.stringify(stdout.slice(-1000))}`,
          ),
        );
        return;
      }
      const parsed = parseJsonObjectFromMixedOutput(stdout);
      if (!parsed) {
        reject(
          new Error(
            `Invalid JSON from ${scriptName}. stderr=${JSON.stringify(stderr.slice(-1000))} stdout=${JSON.stringify(stdout.slice(-1000))}`,
          ),
        );
        return;
      }
      resolve(parsed);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function getTickerFilingsStatus(ticker: string, opts?: { forceRefresh?: boolean }): Promise<FilingsStatus> {
  const tk = ensureTicker(ticker);
  if (!opts?.forceRefresh) {
    const cached = readCache(tk);
    if (cached) return cached;
  }

  const raw = (await runPythonJson("dream_team_context.py", {
    ticker: tk,
    include_annual: true,
    include_quarterly: true,
  })) as DreamTeamContextPayload;

  if (!raw.ok) {
    throw new Error(String(raw.error || "Failed to fetch filing status."));
  }

  const out: FilingsStatus = {
    ticker: tk,
    filings: {
      annual: normalizeFiling(raw.filings?.annual),
      quarterly: normalizeFiling(raw.filings?.quarterly),
    },
    context_error: String(raw.context_error || ""),
  };
  writeCache(out);
  return out;
}

export async function buildFilingPdf(ticker: string, kind: FilingKind): Promise<{
  filePath: string;
  fileName: string;
  filing: FilingSnippet;
}> {
  const tk = ensureTicker(ticker);
  if (kind !== "annual" && kind !== "quarterly") {
    throw new Error("Invalid filing kind.");
  }

  const raw = (await runPythonJson("filing_pdf.py", {
    ticker: tk,
    kind,
  })) as FilingPdfPayload;

  if (!raw.ok) {
    const code = String(raw.error || "filing_pdf_failed");
    throw new Error(code);
  }

  const filePath = String(raw.pdf_path || "").trim();
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("filing_pdf_not_found");
  }
  const fileName = String(raw.file_name || `${tk}_${kind}_filing.pdf`).trim();
  return {
    filePath,
    fileName,
    filing: normalizeFiling(raw.filing),
  };
}
