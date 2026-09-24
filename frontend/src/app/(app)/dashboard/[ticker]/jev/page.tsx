import Link from "next/link";

import { ReportChipRow, DashboardError } from "@/components/dashboard-chrome";
import { loadTickerData } from "@/lib/dashboard-server";
import {
  getJevMetrics,
  getJevReportForecast,
  type JevForecastMode,
  type JevMetric,
  type JevMetrics,
  type JevPrediction,
} from "@/lib/jev-db";
import { parseWorkspace, workspacePath } from "@/lib/workspace";

const HORIZON_LABELS: Record<JevPrediction["horizon"], string> = {
  "1w": "1 Week",
  "1m": "1 Month",
  "3m": "3 Months",
  "6m": "6 Months",
  "1y": "1 Year",
  "3y": "3 Years",
  "5y": "5 Years",
};

function pct(value: number | null, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "N/A";
}

function rate(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/A";
}

function money(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
    : "N/A";
}

function dateOnly(value: string | null): string {
  if (!value) return "Pending";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "Pending";
}

function emptyMetrics(mode: JevForecastMode): JevMetrics {
  return {
    mode,
    reports: 0,
    overall: {
      predictions: 0,
      resolved: 0,
      pending: 0,
      hits: 0,
      misses: 0,
      hit_rate_pct: null,
      mean_brier_score: null,
    },
    expected_calibration_error: null,
    by_horizon: [],
    calibration: [],
  };
}

function OutcomeBadge({ prediction }: { prediction: JevPrediction }) {
  if (prediction.outcome_status === "pending") {
    return (
      <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
        Pending
      </span>
    );
  }
  if (prediction.outcome_status === "unavailable") {
    return (
      <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--warning)]">
        No price
      </span>
    );
  }
  return (
    <span
      className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
        prediction.was_correct
          ? "border-[color:var(--success)] text-[color:var(--success)]"
          : "border-[color:var(--danger)] text-[color:var(--danger)]"
      }`}
    >
      {prediction.was_correct ? "Hit" : "Miss"}
    </span>
  );
}

function ForecastCard({ prediction }: { prediction: JevPrediction }) {
  const probabilityPct = Math.max(0, Math.min(100, prediction.probability_up * 100));
  return (
    <article className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
            {HORIZON_LABELS[prediction.horizon]}
          </p>
          <p
            className={`mt-2 text-3xl font-bold ${
              prediction.predicted_up ? "text-[color:var(--success)]" : "text-[color:var(--danger)]"
            }`}
          >
            {prediction.predicted_up ? "YES" : "NO"}
          </p>
        </div>
        <OutcomeBadge prediction={prediction} />
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[color:var(--surface)]" aria-hidden>
        <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${probabilityPct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-[color:var(--text-muted)]">Probability up</dt>
          <dd className="mt-1 font-mono text-base font-semibold text-[color:var(--text-primary)]">
            {pct(prediction.probability_up)}
          </dd>
        </div>
        <div>
          <dt className="text-[color:var(--text-muted)]">Decision confidence</dt>
          <dd className="mt-1 font-mono text-base font-semibold text-[color:var(--text-primary)]">
            {pct(prediction.confidence)}
          </dd>
        </div>
      </dl>
      <div className="mt-3 border-t border-[color:var(--border-subtle)] pt-3 text-xs text-[color:var(--text-muted)]">
        {prediction.outcome_status === "realized" ? (
          <p>
            Adjusted close {money(prediction.baseline_price)} → {money(prediction.outcome_price)} on {dateOnly(prediction.outcome_at)}
          </p>
        ) : (
          <p>Evaluation date: {dateOnly(prediction.target_at)}</p>
        )}
      </div>
    </article>
  );
}

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[color:var(--text-muted)]">{title}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-[color:var(--text-primary)]">{value}</p>
      <p className="mt-2 text-xs text-[color:var(--text-muted)]">{detail}</p>
    </article>
  );
}

function HorizonRow({ horizon, metric }: { horizon: JevPrediction["horizon"]; metric: JevMetric }) {
  return (
    <tr className="border-b border-[color:var(--border-subtle)] last:border-b-0">
      <td className="px-3 py-2 font-semibold text-[color:var(--text-primary)]">{HORIZON_LABELS[horizon]}</td>
      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{metric.resolved}</td>
      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--success)]">{rate(metric.hit_rate_pct)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-secondary)]">
        {metric.mean_brier_score === null ? "N/A" : metric.mean_brier_score.toFixed(3)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-muted)]">{metric.pending}</td>
    </tr>
  );
}

export default async function DashboardJevPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const search = (await searchParams) ?? {};
  const requestedReportId = typeof search.report === "string" ? search.report : undefined;
  const workspace = parseWorkspace(search.workspace);
  const requestedMetricMode: JevForecastMode | null =
    search.track === "retrospective" ? "retrospective" : search.track === "forward" ? "forward" : null;

  let resolved;
  try {
    resolved = await loadTickerData(ticker, requestedReportId, workspace);
  } catch (error) {
    const upper = decodeURIComponent(String(ticker || "")).toUpperCase();
    return <DashboardError error={(error as Error)?.message || "Failed to load dashboard"} ticker={upper} />;
  }
  const { ticker: upper, data, reportsForTicker, resolvedReportId } = resolved;
  if (!data || !resolvedReportId) return <DashboardError error="No report data" ticker={upper} />;

  const forecast = await getJevReportForecast(resolvedReportId, workspace).catch(() => null);
  const metricMode: JevForecastMode = requestedMetricMode ?? forecast?.forecast_mode ?? "forward";
  const metrics = await getJevMetrics(workspace, metricMode).catch(() => emptyMetrics(metricMode));
  const reportQuery = `report=${encodeURIComponent(resolvedReportId)}`;
  const base = workspacePath(workspace, `/dashboard/${encodeURIComponent(upper)}/jev`);

  return (
    <div className="text-[color:var(--text-primary)]">
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-5 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-overlay)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">Probabilistic forecast</p>
            <h1 className="mt-1 font-display text-2xl">Jev Direction Forecasts</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[color:var(--text-muted)]">
              Jev read the stored Combined report without its publication date and answered seven independent price-direction questions. YES/NO is derived at 50%; confidence is the probability assigned to the displayed answer.
            </p>
          </div>
          {forecast ? (
            <span className="rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--text-secondary)]">
              {forecast.forecast_mode === "forward" ? "Forward forecast" : "Retrospective backfill"}
            </span>
          ) : null}
        </div>
        {forecast?.input_truncated ? (
          <p className="mt-3 text-xs text-[color:var(--warning)]">
            This report exceeded the context budget; the beginning and valuation conclusion were preserved and the middle was deterministically shortened.
          </p>
        ) : null}
      </header>

      {!forecast || forecast.status !== "completed" || !forecast.predictions.length ? (
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-6">
          <h2 className="font-display text-xl">Jev forecast unavailable</h2>
          <p className="mt-2 text-sm text-[color:var(--text-muted)]">
            {forecast?.status === "failed"
              ? "The provider call failed. The report remains intact and the forecast can be retried safely."
              : "This report has not been evaluated yet. Historical reports are populated by the controlled backfill job."}
          </p>
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {forecast.predictions.map((prediction) => (
            <ForecastCard key={prediction.horizon} prediction={prediction} />
          ))}
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-overlay)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">Jev Track Record</h2>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Hit rate measures direction accuracy. Brier score and calibration also measure whether the probabilities deserve their confidence.
            </p>
          </div>
          <nav className="inline-flex rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] p-1" aria-label="Jev track-record mode">
            {(["forward", "retrospective"] as const).map((mode) => (
              <Link
                key={mode}
                href={`${base}?${reportQuery}&track=${mode}`}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${
                  metricMode === mode
                    ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                    : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                {mode === "forward" ? "Forward" : "Backtest"}
              </Link>
            ))}
          </nav>
        </div>

        {metricMode === "retrospective" ? (
          <p className="mt-3 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3 text-xs leading-relaxed text-[color:var(--warning)]">
            Retrospective forecasts were generated after the original reports. Their report date was withheld, but indirect period clues may remain, so these results are shown separately and are not presented as live out-of-sample performance.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Hit rate"
            value={rate(metrics.overall.hit_rate_pct)}
            detail={`${metrics.overall.hits} hits · ${metrics.overall.misses} misses`}
          />
          <MetricCard
            title="Brier score"
            value={metrics.overall.mean_brier_score === null ? "N/A" : metrics.overall.mean_brier_score.toFixed(3)}
            detail="0 is perfect; lower is better"
          />
          <MetricCard
            title="Calibration error"
            value={pct(metrics.expected_calibration_error)}
            detail="Weighted gap between predicted and observed up rates"
          />
          <MetricCard
            title="Coverage"
            value={String(metrics.reports)}
            detail={`${metrics.overall.resolved} resolved · ${metrics.overall.pending} pending`}
          />
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)]">
            <div className="border-b border-[color:var(--border-subtle)] px-4 py-3">
              <h3 className="font-semibold">Accuracy by horizon</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-xs uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Horizon</th>
                    <th className="px-3 py-2 text-right">Resolved</th>
                    <th className="px-3 py-2 text-right">Hit rate</th>
                    <th className="px-3 py-2 text-right">Brier</th>
                    <th className="px-3 py-2 text-right">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.by_horizon.map((row) => (
                    <HorizonRow key={row.horizon} horizon={row.horizon} metric={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
            <h3 className="font-semibold">Calibration</h3>
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">Predicted probability of an increase versus the percentage that actually increased.</p>
            <div className="mt-4 space-y-4">
              {metrics.calibration.map((bucket) => (
                <div key={bucket.key}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-[color:var(--text-secondary)]">{bucket.label}</span>
                    <span className="tabular-nums text-[color:var(--text-muted)]">N {bucket.count}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-[72px_1fr_48px] items-center gap-2 text-[11px]">
                    <span className="text-[color:var(--text-muted)]">Predicted</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface)]">
                      <div className="h-full rounded-full bg-[color:var(--info)]" style={{ width: `${(bucket.mean_probability_up ?? 0) * 100}%` }} />
                    </div>
                    <span className="text-right tabular-nums text-[color:var(--text-secondary)]">{pct(bucket.mean_probability_up, 0)}</span>
                    <span className="text-[color:var(--text-muted)]">Observed</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface)]">
                      <div className="h-full rounded-full bg-[color:var(--success)]" style={{ width: `${(bucket.observed_up_rate ?? 0) * 100}%` }} />
                    </div>
                    <span className="text-right tabular-nums text-[color:var(--text-secondary)]">{pct(bucket.observed_up_rate, 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
