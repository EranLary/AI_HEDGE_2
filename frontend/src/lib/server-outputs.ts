import fs from "node:fs";
import path from "node:path";

const MAX_SCAN_DEPTH = 4;

export type FoundFile = {
  path: string;
  mtimeMs: number;
};

export type DashboardReportEntry = {
  report_id: string;
  ticker: string;
  path: string;
  mtimeMs: number;
};

export function outputsRoot(): string {
  const direct = path.resolve(process.cwd(), "outputs");
  const parent = path.resolve(process.cwd(), "..", "outputs");

  const directOk = fs.existsSync(direct);
  const parentOk = fs.existsSync(parent);

  if (directOk && !parentOk) return direct;
  if (!directOk && parentOk) return parent;
  if (directOk && parentOk) {
    // Prefer nearer root when both exist to avoid reading a sibling project by mistake.
    return direct;
  }
  // Fallback for fresh envs where outputs is not created yet.
  return parent;
}

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function walkFiles(dir: string, depth = 0, out: FoundFile[] = []): FoundFile[] {
  if (depth > MAX_SCAN_DEPTH) {
    return out;
  }
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const stat = safeStat(full);
    if (!stat) {
      continue;
    }
    out.push({ path: full, mtimeMs: stat.mtimeMs });
  }
  return out;
}

export function findLatestByFileName(fileName: string): FoundFile | null {
  const root = outputsRoot();
  const files = walkFiles(root).filter((item) => path.basename(item.path).toUpperCase() === fileName.toUpperCase());
  if (!files.length) {
    return null;
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0];
}

export function listTickersFromOutputs(): string[] {
  const root = outputsRoot();
  const all = walkFiles(root);
  const tickers = new Set<string>();
  const re = /^([A-Z0-9.\-]{1,10})_(dashboard\.json|analysis\.txt)$/i;

  for (const item of all) {
    const base = path.basename(item.path);
    const match = base.match(re);
    if (!match) {
      continue;
    }
    const ticker = String(match[1] || "").toUpperCase().trim();
    if (ticker) {
      tickers.add(ticker);
    }
  }

  return Array.from(tickers).sort((a, b) => a.localeCompare(b));
}

export function listDashboardFiles(): FoundFile[] {
  const root = outputsRoot();
  const re = /^[A-Z0-9.\-]{1,10}_dashboard\.json$/i;
  return walkFiles(root).filter((item) => re.test(path.basename(item.path)));
}

function toReportId(filePath: string): string {
  const rel = path.relative(outputsRoot(), filePath).replace(/\\/g, "/");
  return Buffer.from(rel, "utf-8").toString("base64url");
}

function fromReportId(reportId: string): string | null {
  try {
    const rel = Buffer.from(String(reportId || ""), "base64url").toString("utf-8");
    if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
      return null;
    }
    const full = path.resolve(outputsRoot(), rel);
    const root = outputsRoot();
    if (!full.startsWith(root)) {
      return null;
    }
    return full;
  } catch {
    return null;
  }
}

export function resolveDashboardReportPath(reportId: string): string | null {
  const full = fromReportId(reportId);
  if (!full) {
    return null;
  }
  const stat = safeStat(full);
  if (!stat || !stat.isFile()) {
    return null;
  }
  const base = path.basename(full);
  if (!/^[A-Z0-9.\-]{1,10}_dashboard\.json$/i.test(base)) {
    return null;
  }
  return full;
}

export function listDashboardReports(): DashboardReportEntry[] {
  const candidates = listDashboardFiles()
    .map((item) => {
      const base = path.basename(item.path);
      const ticker = String(base.split("_")[0] || "").toUpperCase();
      if (!ticker) {
        return null;
      }
      const rel = path.relative(outputsRoot(), item.path).replace(/\\/g, "/");
      const upperRel = rel.toUpperCase();
      const isNestedTickerArtifact = upperRel.includes(`/${ticker}/${ticker}_DASHBOARD.JSON`);
      const isSiteRun = upperRel.startsWith("_SITE_RUNS/");
      const score = (isNestedTickerArtifact ? 10 : 0) + (isSiteRun ? 2 : 0);

      let dedupeKey = `file:${rel}`;
      const parts = rel.split("/").filter(Boolean);
      const siteRunsIdx = parts.findIndex((p) => p.toLowerCase() === "_site_runs");
      if (siteRunsIdx >= 0 && siteRunsIdx + 1 < parts.length) {
        const runId = String(parts[siteRunsIdx + 1] || "").trim();
        if (runId) {
          dedupeKey = `site:${runId}:${ticker}`;
        }
      }

      return {
        report: {
          report_id: toReportId(item.path),
          ticker,
          path: item.path,
          mtimeMs: item.mtimeMs,
        } satisfies DashboardReportEntry,
        dedupeKey,
        score,
      };
    })
    .filter((item): item is { report: DashboardReportEntry; dedupeKey: string; score: number } => Boolean(item));

  const deduped = new Map<string, { report: DashboardReportEntry; score: number }>();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.dedupeKey);
    if (!existing) {
      deduped.set(candidate.dedupeKey, { report: candidate.report, score: candidate.score });
      continue;
    }
    const preferCandidate =
      candidate.score > existing.score ||
      (candidate.score === existing.score && candidate.report.mtimeMs > existing.report.mtimeMs);
    if (preferCandidate) {
      deduped.set(candidate.dedupeKey, { report: candidate.report, score: candidate.score });
    }
  }

  const reports = Array.from(deduped.values()).map((v) => v.report);
  reports.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return reports;
}

export function readUtf8(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
