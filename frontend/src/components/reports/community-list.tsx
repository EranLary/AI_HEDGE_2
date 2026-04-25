"use client";

import { useState, useTransition } from "react";

import type { DbReportSummary } from "@/lib/reports-db";
import { loadMoreCommunity } from "@/app/(app)/reports/actions";

import { ReportCard } from "./report-card";

export const COMMUNITY_PAGE_SIZE = 16;

export function CommunityList({
  initialRows,
  initialHasMore,
  query,
  pageSize = COMMUNITY_PAGE_SIZE,
}: {
  initialRows: DbReportSummary[];
  initialHasMore: boolean;
  query: string;
  pageSize?: number;
}) {
  const [rows, setRows] = useState<DbReportSummary[]>(initialRows);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleShowMore = () => {
    setError("");
    startTransition(async () => {
      try {
        const next = await loadMoreCommunity({
          offset: rows.length,
          limit: pageSize,
          query,
        });
        setRows((prev) => [...prev, ...next.rows]);
        setHasMore(next.hasMore);
      } catch {
        setError("Failed to load more reports.");
      }
    });
  };

  return (
    <div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {rows.map((r) => (
          <li key={r.id} className="h-full">
            <ReportCard report={r} />
          </li>
        ))}
      </ul>

      {error ? (
        <p className="mt-4 text-center text-xs text-red-300">{error}</p>
      ) : null}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={handleShowMore}
            disabled={isPending}
            className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100 transition hover:border-emerald-400/70 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
