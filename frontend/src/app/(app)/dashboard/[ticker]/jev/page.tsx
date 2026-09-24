import { ReportChipRow, DashboardError } from "@/components/dashboard-chrome";
import { loadTickerData } from "@/lib/dashboard-server";
import { getJevReportForecast, type JevPrediction } from "@/lib/jev-db";
import { parseWorkspace } from "@/lib/workspace";

const HORIZON_LABELS: Record<JevPrediction["horizon"], string> = {
  "1w": "1 Week",
  "1m": "1 Month",
  "3m": "3 Months",
  "6m": "6 Months",
  "1y": "1 Year",
  "3y": "3 Years",
  "5y": "5 Years",
};

function pct(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "N/A";
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
      {prediction.was_correct ? "✓ Correct" : "✕ Incorrect"}
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

  return (
    <div className="text-[color:var(--text-primary)]">
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-5 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-overlay)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">Probabilistic forecast</p>
            <h1 className="mt-1 font-display text-2xl">Jev Direction Forecasts</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[color:var(--text-muted)]">
              Jev read this Combined report without its publication date and answered seven independent price-direction questions. YES/NO is derived at 50%; confidence is the probability assigned to the displayed answer.
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
    </div>
  );
}
