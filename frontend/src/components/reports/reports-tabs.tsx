"use client";

import { Crown, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { workspacePath, type Workspace } from "@/lib/workspace";
import type { ReportGoldFilter, ReportScoreFilter } from "@/lib/report-list-filters";

export type ReportsTabKey = "mine" | "community";

const TAB_ORDER: { key: ReportsTabKey; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "community", label: "Community" },
];

export function ReportsTabs({
  active,
  signedIn,
  initialQuery,
  workspace,
  gold,
  score,
}: {
  active: ReportsTabKey;
  signedIn: boolean;
  initialQuery: string;
  workspace: Workspace;
  gold: ReportGoldFilter;
  score: ReportScoreFilter;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();
  const currentQuery = String(search?.get("q") || "").trim();
  const searchString = search?.toString() || "";

  const navigateToQuery = useCallback((value: string) => {
    const normalized = value.trim();
    if (normalized === currentQuery) return;

    const params = new URLSearchParams(searchString);
    params.delete("workspace");
    if (normalized) params.set("q", normalized);
    else params.delete("q");
    const qs = params.toString();
    startTransition(() => {
      const base = workspacePath(workspace, "/reports");
      router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
    });
  }, [currentQuery, router, searchString, workspace]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      navigateToQuery(query);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [navigateToQuery, query]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateToQuery(query);
  }

  function clearSearch() {
    setQuery("");
    navigateToQuery("");
  }

  const filterHref = (key: "gold" | "score", value: string) => {
    const params = new URLSearchParams(searchString);
    params.delete("workspace");
    if (value === "all") params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    const base = workspacePath(workspace, "/reports");
    return qs ? `${base}?${qs}` : base;
  };

  return (
    <div className="mb-6 space-y-3">
      <div className={`grid gap-3 sm:items-center ${workspace === "nasdaq100" ? "sm:grid-cols-1" : "sm:grid-cols-[auto_minmax(0,1fr)]"}`}>
        {workspace === "analysis" ? (
        <nav className="flex w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-1 sm:w-auto">
          {TAB_ORDER.map((t) => {
            const params = new URLSearchParams(searchString);
            params.delete("workspace");
            params.set("tab", t.key);
            const isActive = t.key === active;
            const disabled = t.key === "mine" && !signedIn;
            if (disabled) {
              return (
                <span
                  key={t.key}
                  className="flex-1 cursor-not-allowed rounded-lg px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-disabled)] sm:flex-none"
                  title="Sign in to see your reports"
                >
                  {t.label}
                </span>
              );
            }
            return (
              <Link
                key={t.key}
                href={`${workspacePath(workspace, "/reports")}?${params.toString()}`}
                scroll={false}
                className={`flex-1 rounded-lg px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-[0.14em] transition sm:flex-none ${
                  isActive
                    ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                    : "text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        ) : null}

        <form
        role="search"
        aria-label="Search reports"
        aria-busy={isPending}
        onSubmit={submitSearch}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2"
      >
        <div className="relative min-w-0">
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
          />
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Search ticker or company"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ticker or company"
            className="w-full min-w-0 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] py-2 pl-10 pr-10 text-base text-[color:var(--text-primary)] outline-none transition placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--accent)] sm:text-sm"
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center">
            {isPending ? (
              <Loader2 aria-label="Searching reports" size={16} className="animate-spin text-[color:var(--accent)]" />
            ) : query ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear report search"
                className="rounded text-[color:var(--text-muted)] transition hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>
        <button
          type="submit"
          disabled={isPending || query.trim() === currentQuery}
          className="rounded-lg bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-on-accent)] transition hover:bg-[color:var(--accent-hover)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
        >
          Search
        </button>
        </form>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-2.5 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
          <SlidersHorizontal size={14} aria-hidden />
          Filters
        </div>
        <FilterGroup
          label="Target outlook"
          active={gold}
          options={[
            { value: "all", label: "All" },
            { value: "golden", label: "Golden", icon: <Crown size={12} aria-hidden /> },
            { value: "standard", label: "Not golden" },
          ]}
          hrefFor={(value) => filterHref("gold", value)}
        />
        <FilterGroup
          label="Score"
          active={score}
          options={[
            { value: "all", label: "Any" },
            { value: "positive", label: "Positive" },
            { value: "negative", label: "Negative" },
          ]}
          hrefFor={(value) => filterHref("score", value)}
        />
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  active,
  options,
  hrefFor,
}: {
  label: string;
  active: string;
  options: Array<{ value: string; label: string; icon?: ReactNode }>;
  hrefFor: (value: string) => string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center">
      <span className="shrink-0 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1" role="group" aria-label={`${label} filter`}>
        {options.map((option) => {
          const selected = active === option.value;
          return (
            <Link
              key={option.value}
              href={hrefFor(option.value)}
              scroll={false}
              aria-current={selected ? "page" : undefined}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
                selected
                  ? option.value === "golden"
                    ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
                    : "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                  : "border-transparent text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)]"
              }`}
            >
              {option.icon}
              {option.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
