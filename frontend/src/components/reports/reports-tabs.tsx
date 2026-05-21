"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export type ReportsTabKey = "mine" | "community";

const TAB_ORDER: { key: ReportsTabKey; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "community", label: "Community" },
];

export function ReportsTabs({
  active,
  signedIn,
  initialQuery,
}: {
  active: ReportsTabKey;
  signedIn: boolean;
  initialQuery: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams(search?.toString() || "");
      if (query) params.set("q", query);
      else params.delete("q");
      const qs = params.toString();
      router.replace(qs ? `/reports?${qs}` : `/reports`);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query, router, search]);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <nav className="inline-flex rounded-xl border border-white/10 bg-zinc-950/70 p-1">
        {TAB_ORDER.map((t) => {
          const params = new URLSearchParams(search?.toString() || "");
          params.set("tab", t.key);
          const isActive = t.key === active;
          const disabled = t.key === "mine" && !signedIn;
          if (disabled) {
            return (
              <span
                key={t.key}
                className="cursor-not-allowed rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600"
                title="Sign in to see your reports"
              >
                {t.label}
              </span>
            );
          }
          return (
            <Link
              key={t.key}
              href={`/reports?${params.toString()}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                isActive
                  ? "bg-emerald-500/20 text-emerald-100"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search ticker or company"
        className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-400/60 focus:outline-none sm:text-sm"
      />
    </div>
  );
}
