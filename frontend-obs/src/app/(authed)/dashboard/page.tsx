import Link from "next/link";

import { SpendTreemap } from "@/components/spend-treemap";
import {
  type DailySeriesRow,
  type DashboardSummary,
  type ModelBreakdownRow,
  type StageBreakdownRow,
  getDailySeries,
  getDashboardSummary,
  getModelBreakdown,
  getSpendBreakdown,
  getStageBreakdown,
  isObsDbEnabled,
} from "@/lib/obs-db";
import {
  formatCost,
  formatDuration,
  formatLatency,
  formatTokens,
} from "@/lib/obs-format";
import { stageColor } from "@/lib/obs-styles";

export const dynamic = "force-dynamic";

const ALLOWED_DAYS = [7, 30, 90] as const;
type AllowedDays = (typeof ALLOWED_DAYS)[number];

function parseDays(raw: string | undefined): AllowedDays {
  const n = Number(raw);
  return (ALLOWED_DAYS as readonly number[]).includes(n) ? (n as AllowedDays) : 7;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ days?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const days = parseDays(sp.days);

  if (!isObsDbEnabled()) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <h1 style={{ marginBottom: 8 }}>Dashboard</h1>
        <p style={{ opacity: 0.7 }}>
          OBS_DATABASE_URL is not configured. Set it to view metrics.
        </p>
      </div>
    );
  }

  const [summary, stages, models, daily, spend] = await Promise.all([
    getDashboardSummary(days),
    getStageBreakdown(days),
    getModelBreakdown(days),
    getDailySeries(days),
    getSpendBreakdown(days),
  ]);

  const successRate =
    summary.run_count > 0 ? (summary.success_count / summary.run_count) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 2 }}>Dashboard</h1>
          <div style={{ opacity: 0.6, fontSize: 13 }}>
            Pipeline activity over the last {days} days
          </div>
        </div>
        <div className="range-tabs">
          {ALLOWED_DAYS.map((d) => (
            <Link
              key={d}
              href={`/dashboard?days=${d}`}
              className={d === days ? "is-active" : ""}
              prefetch={false}
            >
              {d}d
            </Link>
          ))}
        </div>
      </div>

      <SummaryTiles summary={summary} successRate={successRate} />

      <DailyActivityCard rows={daily} days={days} />

      <SpendTreemap rows={spend} />

      <StageTable rows={stages} />

      <ModelTable rows={models} />
    </div>
  );
}

function SummaryTiles({
  summary,
  successRate,
}: {
  summary: DashboardSummary;
  successRate: number;
}) {
  return (
    <div className="tiles">
      <Tile
        label="Total runs"
        value={summary.run_count.toLocaleString()}
        hint={`${summary.success_count} success · ${summary.error_count} error`}
      />
      <Tile
        label="Success rate"
        value={`${successRate.toFixed(summary.run_count > 0 ? 1 : 0)}%`}
        hint={
          summary.error_count > 0
            ? `${summary.error_count} failure${summary.error_count === 1 ? "" : "s"}`
            : "no failures"
        }
      />
      <Tile
        label="Total cost"
        value={formatCost(summary.total_cost_usd, 2)}
        hint={`${formatTokens(summary.total_tokens)} tokens`}
      />
      <Tile
        label="Avg run duration"
        value={formatDuration(summary.avg_duration_ms)}
        hint={`p50 ${formatDuration(summary.p50_duration_ms)} · p95 ${formatDuration(summary.p95_duration_ms)}`}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="tile">
      <div className="tile__label">{label}</div>
      <div className="tile__value">{value}</div>
      {hint && <div className="tile__hint">{hint}</div>}
    </div>
  );
}

function DailyActivityCard({ rows, days }: { rows: DailySeriesRow[]; days: number }) {
  const filled = fillDays(rows, days);
  const maxCost = filled.reduce(
    (m, r) => Math.max(m, Number(r.cost_usd) || 0),
    0,
  );
  const totalRuns = filled.reduce((s, r) => s + (r.run_count || 0), 0);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <h2 className="section-title" style={{ margin: 0 }}>
          Daily activity
        </h2>
        <div style={{ fontSize: 11, opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>
          {totalRuns} runs · max {formatCost(maxCost, 2)}/day
        </div>
      </div>
      <div className="sparkline" role="img" aria-label="Daily cost sparkline">
        {filled.map((r) => {
          const cost = Number(r.cost_usd) || 0;
          const heightPct = maxCost > 0 ? (cost / maxCost) * 100 : 0;
          const empty = (r.run_count || 0) === 0;
          return (
            <div
              key={r.day}
              className={`sparkline__bar${empty ? " sparkline__bar--empty" : ""}`}
              style={{ height: `${Math.max(heightPct, empty ? 8 : 4)}%` }}
              title={`${r.day} · ${r.run_count} run${r.run_count === 1 ? "" : "s"} · ${formatCost(cost, 2)}`}
            />
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          fontSize: 10,
          opacity: 0.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{filled[0]?.day}</span>
        <span>{filled[filled.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function fillDays(rows: DailySeriesRow[], days: number): DailySeriesRow[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: DailySeriesRow[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { day: key, run_count: 0, cost_usd: "0" });
  }
  return out;
}

function StageTable({ rows }: { rows: StageBreakdownRow[] }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 className="section-title" style={{ margin: "0 0 12px" }}>
        By stage
      </h2>
      {rows.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: 13 }}>No calls in this window.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th className="num">Calls</th>
                <th className="num">Avg latency</th>
                <th className="num">p95 latency</th>
                <th className="num">Total cost</th>
                <th className="num">Avg cost</th>
                <th className="num">Errors</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.stage}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span
                        aria-hidden
                        className="stage-dot"
                        style={{ background: stageColor(r.stage) }}
                      />
                      {r.stage}
                    </span>
                  </td>
                  <td className="num">{r.call_count.toLocaleString()}</td>
                  <td className="num">{formatLatency(r.avg_latency_ms)}</td>
                  <td className="num">{formatLatency(r.p95_latency_ms)}</td>
                  <td className="num">{formatCost(r.total_cost_usd, 4)}</td>
                  <td className="num">{formatCost(r.avg_cost_usd, 5)}</td>
                  <td
                    className="num"
                    style={{
                      color: r.error_count > 0 ? "var(--color-danger)" : "inherit",
                      opacity: r.error_count > 0 ? 1 : 0.4,
                    }}
                  >
                    {r.error_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ModelTable({ rows }: { rows: ModelBreakdownRow[] }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 className="section-title" style={{ margin: "0 0 12px" }}>
        By model
      </h2>
      {rows.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: 13 }}>No calls in this window.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Calls</th>
                <th className="num">Avg latency</th>
                <th className="num">Total cost</th>
                <th className="num">Avg cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.model}>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{r.model}</td>
                  <td className="num">{r.call_count.toLocaleString()}</td>
                  <td className="num">{formatLatency(r.avg_latency_ms)}</td>
                  <td className="num">{formatCost(r.total_cost_usd, 4)}</td>
                  <td className="num">{formatCost(r.avg_cost_usd, 5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
