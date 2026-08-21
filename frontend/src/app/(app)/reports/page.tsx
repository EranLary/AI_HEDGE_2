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
import { parseWorkspace, type Workspace } from "@/lib/workspace";

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
  searchParams: Promise<{ tab?: string; q?: string; workspace?: string }>;
}) {
  const params = await searchParams;
  const workspace = parseWorkspace(params.workspace);
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

      <ReportsTabs active={tab} signedIn={signedIn} initialQuery={query} workspace={workspace} />

      {tab === "community" ? (
        <CommunityTabContent query={query} signedIn={signedIn} workspace={workspace} />
      ) : (
        <MineTabContent userId={userId} signedIn={signedIn} query={query} workspace={workspace} />
      )}
    </div>
  );
}

async function CommunityTabContent({
  query,
  signedIn,
  workspace,
}: {
  query: string;
  signedIn: boolean;
  workspace: Workspace;
}) {
  let rows: DbReportSummary[] = [];
  let hasMore = false;
  try {
    const page = await listCommunityReportsPaged({
      query,
      limit: COMMUNITY_PAGE_SIZE,
      offset: 0,
      workspace,
    });
    rows = page.rows;
    hasMore = page.hasMore;
  } catch (err) {
    console.warn("[reports] DB read failed:", err);
  }

  if (!rows.length) {
    return <EmptyState tab="community" signedIn={signedIn} hasQuery={Boolean(query)} workspace={workspace} />;
  }

  return (
    <CommunityList
      key={query.trim().toLowerCase() || "all-reports"}
      initialRows={rows}
      initialHasMore={hasMore}
      query={query}
      workspace={workspace}
    />
  );
}

async function MineTabContent({
  userId,
  signedIn,
  query,
  workspace,
}: {
  userId: string | null;
  signedIn: boolean;
  query: string;
  workspace: Workspace;
}) {
  let rows: DbReportSummary[] = [];
  try {
    rows = userId ? await listUserReports(userId, workspace) : [];
  } catch (err) {
    console.warn("[reports] DB read failed:", err);
  }
  const filtered = filterByQuery(rows, query);

  if (!filtered.length) {
    return <EmptyState tab="mine" signedIn={signedIn} hasQuery={Boolean(query)} workspace={workspace} />;
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {filtered.map((r) => (
        <li key={r.id} className="h-full">
          <ReportCard report={r} showVisibilityToggle showDeleteAction />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  tab,
  signedIn,
  hasQuery,
  workspace = "analysis",
}: {
  tab: ReportsTabKey;
  signedIn: boolean;
  hasQuery: boolean;
  workspace?: Workspace;
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
        <p className="text-sm text-zinc-300">
          {workspace === "nasdaq100"
            ? "No Nasdaq 100 reports are assigned to your account."
            : "You haven't analyzed any tickers yet."}
        </p>
        {workspace === "analysis" ? (
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
            Use <span className="text-emerald-200">+ New Analysis</span> in the sidebar to start.
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-10 text-center">
      <p className="text-sm text-zinc-300">
        {workspace === "nasdaq100"
          ? "No Nasdaq 100 reports have completed yet."
          : "No public reports yet."}
      </p>
      {workspace === "nasdaq100" ? (
        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
          Completed reports will appear here while the universe run continues.
        </p>
      ) : null}
      <p className={`${workspace === "nasdaq100" ? "hidden " : ""}mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500`}>
        Run an analysis from the sidebar — your reports default to public.
      </p>
    </div>
  );
}
