import { auth } from "@/auth";
import {
  listCommunityReportsPaged,
  listUserReports,
  type DbReportSummary,
} from "@/lib/reports-db";
import { ReportCard } from "@/components/reports/report-card";
import {
  COMMUNITY_PAGE_SIZE,
  CommunityList,
} from "@/components/reports/community-list";
import { ReportsTabs, type ReportsTabKey } from "@/components/reports/reports-tabs";

export const dynamic = "force-dynamic";

function resolveTab(raw: string | undefined, signedIn: boolean): ReportsTabKey {
  if (raw === "mine" || raw === "community") {
    if (raw === "mine" && !signedIn) return "community";
    return raw;
  }
  return "community";
}

function filterByQuery(rows: DbReportSummary[], query: string): DbReportSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.ticker.toLowerCase().includes(q) ||
      String(r.company_name || "").toLowerCase().includes(q),
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  const userId = session?.user?.id || null;
  const signedIn = Boolean(userId);

  const tab = resolveTab(params.tab, signedIn);
  const query = String(params.q || "");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-zinc-100">Reports</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">
          {tab === "mine" ? "Reports you've generated" : "Public reports from the community"}
        </p>
      </header>

      <ReportsTabs active={tab} signedIn={signedIn} initialQuery={query} />

      {tab === "community" ? (
        <CommunityTabContent query={query} excludeUserId={userId || undefined} />
      ) : (
        <MineTabContent userId={userId} signedIn={signedIn} query={query} />
      )}
    </div>
  );
}

async function CommunityTabContent({
  query,
  excludeUserId,
}: {
  query: string;
  excludeUserId: string | undefined;
}) {
  let rows: DbReportSummary[] = [];
  let hasMore = false;
  try {
    const page = await listCommunityReportsPaged({
      excludeUserId,
      query,
      limit: COMMUNITY_PAGE_SIZE,
      offset: 0,
    });
    rows = page.rows;
    hasMore = page.hasMore;
  } catch (err) {
    console.warn("[reports] DB read failed:", err);
  }

  if (!rows.length) {
    return <EmptyState tab="community" signedIn={Boolean(excludeUserId)} hasQuery={Boolean(query)} />;
  }

  return <CommunityList initialRows={rows} initialHasMore={hasMore} query={query} />;
}

async function MineTabContent({
  userId,
  signedIn,
  query,
}: {
  userId: string | null;
  signedIn: boolean;
  query: string;
}) {
  let rows: DbReportSummary[] = [];
  try {
    rows = userId ? await listUserReports(userId) : [];
  } catch (err) {
    console.warn("[reports] DB read failed:", err);
  }
  const filtered = filterByQuery(rows, query);

  if (!filtered.length) {
    return <EmptyState tab="mine" signedIn={signedIn} hasQuery={Boolean(query)} />;
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {filtered.map((r) => (
        <li key={r.id} className="h-full">
          <ReportCard report={r} />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  tab,
  signedIn,
  hasQuery,
}: {
  tab: ReportsTabKey;
  signedIn: boolean;
  hasQuery: boolean;
}) {
  if (hasQuery) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-10 text-center">
        <p className="text-sm text-zinc-300">No reports match your search.</p>
      </div>
    );
  }
  if (tab === "mine") {
    if (!signedIn) {
      return (
        <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-10 text-center">
          <p className="text-sm text-zinc-300">Sign in to see reports you&apos;ve generated.</p>
          <a
            href="/auth/signin"
            className="mt-3 inline-block rounded-lg border border-emerald-400/60 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100 hover:bg-emerald-500/25"
          >
            Sign in
          </a>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-10 text-center">
        <p className="text-sm text-zinc-300">You haven&apos;t analyzed any tickers yet.</p>
        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
          Use <span className="text-emerald-200">+ New Analysis</span> in the sidebar to start.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-10 text-center">
      <p className="text-sm text-zinc-300">No public reports yet.</p>
      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
        Run an analysis from the sidebar — your reports default to public.
      </p>
    </div>
  );
}
