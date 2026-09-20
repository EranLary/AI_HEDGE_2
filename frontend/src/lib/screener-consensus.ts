import { normalizeValuationConsensus } from "@/lib/dashboard-normalize";
import {
  computeTickerSummaryAggregation,
  type SummarySourceReport,
  type TickerSummaryAggregation,
} from "@/lib/ticker-summary-aggregate";

/**
 * Screeners share the exact historical Mean/Median compatibility contract used
 * by Discovery and ticker summaries. A report with no usable Median remains a
 * valid Mean-only report.
 */
export function computeScreenerTickerSummary(
  reports: SummarySourceReport[],
): TickerSummaryAggregation {
  return computeTickerSummaryAggregation(
    reports.map((report) => ({
      ...report,
      payload: normalizeValuationConsensus(report.payload),
    })),
    "all",
  );
}
