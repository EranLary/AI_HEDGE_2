import { LoaderCircle } from "lucide-react";

export default function AppPageLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-8"
    >
      <div className="mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
        <LoaderCircle size={15} className="animate-spin" aria-hidden />
        <span>Loading page...</span>
      </div>
      <div className="grid gap-4 md:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)]"
          />
        ))}
      </div>
    </div>
  );
}
