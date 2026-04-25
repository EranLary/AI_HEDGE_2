"use client";

const RTF = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl
  ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  : null;

const ABSOLUTE_FMT = typeof Intl !== "undefined"
  ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
  : null;

const ABSOLUTE_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;

function relative(deltaMs: number): string {
  if (!RTF) return "";
  const sign = deltaMs >= 0 ? -1 : 1;
  const abs = Math.abs(deltaMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (abs < hour) return RTF.format(sign * Math.max(1, Math.round(abs / minute)), "minute");
  if (abs < day) return RTF.format(sign * Math.round(abs / hour), "hour");
  if (abs < week) return RTF.format(sign * Math.round(abs / day), "day");
  return RTF.format(sign * Math.round(abs / week), "week");
}

export function FriendlyDate({ iso, className }: { iso: string; className?: string }) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return <span className={className}>—</span>;
  const delta = Date.now() - t;
  const label = delta < ABSOLUTE_CUTOFF_MS
    ? relative(delta) || (ABSOLUTE_FMT ? ABSOLUTE_FMT.format(t) : new Date(t).toDateString())
    : (ABSOLUTE_FMT ? ABSOLUTE_FMT.format(t) : new Date(t).toDateString());
  return (
    <time dateTime={iso} title={new Date(t).toISOString()} className={className}>
      {label}
    </time>
  );
}
