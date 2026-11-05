export type HistoricalPricePoint = {
  date: string;
  close: number;
  split_factor: number;
};

export type NormalizedHistoricalPricePoint = HistoricalPricePoint & { timestamp: number };

export function utcDateTimestamp(value: string | undefined): number | null {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function pointTimestamp(point: HistoricalPricePoint): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(point.date || ""));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function normalizeHistoricalSeries(
  points: HistoricalPricePoint[] | undefined,
): NormalizedHistoricalPricePoint[] {
  return (Array.isArray(points) ? points : [])
    .map((point) => ({ ...point, timestamp: pointTimestamp(point) }))
    .filter(
      (point): point is NormalizedHistoricalPricePoint =>
        typeof point.timestamp === "number"
        && Number.isFinite(point.close)
        && point.close > 0
        && Number.isFinite(point.split_factor)
        && point.split_factor > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function splitAdjustedBaseline(
  reportPrice: number,
  reportTimestamp: number | null,
  points: NormalizedHistoricalPricePoint[],
): number {
  if (reportTimestamp === null) return reportPrice;
  let reference: NormalizedHistoricalPricePoint | null = null;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].timestamp <= reportTimestamp) {
      reference = points[index];
      break;
    }
  }
  if (!reference || reference.close <= 0) return reportPrice;
  const splitFactor = reference.split_factor;
  return Number.isFinite(splitFactor) && splitFactor > 0
    ? reportPrice * splitFactor
    : reportPrice;
}
