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
const FILINGS_STATUS_INFLIGHT = new Map<string, Promise<FilingsStatus>>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAYA_BASE_URL = "https://maya.tase.co.il";
const MAYA_FILES_BASE_URL = "https://mayafiles.tase.co.il";

function envMs(name: string, fallbackMs: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.floor(parsed);
}

const STATUS_TIMEOUT_MS = envMs("FILINGS_STATUS_TIMEOUT_MS", 75_000);
const PDF_TIMEOUT_MS = envMs("FILINGS_PDF_TIMEOUT_MS", 180_000);

function normalizeSourceUrl(rawUrl: string, source: string): string {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;

  const src = String(source || "").trim().toUpperCase();
  if (src === "MAYA") {
    if (url.startsWith("/")) {
      if (url.includes("/reports/") || url.includes("/api/")) return `${MAYA_BASE_URL}${url}`;
      return `${MAYA_FILES_BASE_URL}${url}`;
    }
    return `${MAYA_FILES_BASE_URL}/${url.replace(/^\/+/, "")}`;
  }

  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/|$)/.test(url)) return `https://${url}`;
  return url;
}

function normalizeFiling(value: Partial<FilingSnippet> | null | undefined): FilingSnippet {
  const source = String(value?.source || "");
  return {
    available: Boolean(value?.available),
    source,
    form_type: String(value?.form_type || ""),
    date: String(value?.date || ""),
    source_url: normalizeSourceUrl(String(value?.source_url || ""), source),
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

async function runPythonJson(
  scriptName: string,
  payload: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
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
    const timeoutMs = Number(opts?.timeoutMs || 0) > 0 ? Number(opts?.timeoutMs) : 0;
    let finished = false;
    const timeoutHandle =
      timeoutMs > 0
        ? setTimeout(() => {
            if (finished) return;
            try {
              child.kill();
            } catch {
              // no-op
            }
            reject(new Error(`${scriptName} timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
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
    const inflight = FILINGS_STATUS_INFLIGHT.get(tk);
    if (inflight) return inflight;
  }

  const fetchPromise = (async () => {
    const raw = (await runPythonJson(
      "filings_status.py",
      {
        ticker: tk,
      },
      { timeoutMs: STATUS_TIMEOUT_MS },
    )) as DreamTeamContextPayload;

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
  })();

  if (!opts?.forceRefresh) {
    FILINGS_STATUS_INFLIGHT.set(tk, fetchPromise);
  }
  try {
    return await fetchPromise;
  } finally {
    FILINGS_STATUS_INFLIGHT.delete(tk);
  }
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

  const raw = (await runPythonJson(
    "filing_pdf.py",
    {
      ticker: tk,
      kind,
    },
    { timeoutMs: PDF_TIMEOUT_MS },
  )) as FilingPdfPayload;

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
