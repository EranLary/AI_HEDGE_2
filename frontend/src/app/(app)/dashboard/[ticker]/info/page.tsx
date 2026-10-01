import { redirect } from "next/navigation";

import { parseWorkspace, workspacePath } from "@/lib/workspace";

export default async function DashboardInfoPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const search = (await searchParams) ?? {};
  const reportId = typeof search.report === "string" ? search.report : undefined;
  const workspace = parseWorkspace(search.workspace);
  const suffix = reportId ? `?report=${encodeURIComponent(reportId)}` : "";
  redirect(`${workspacePath(workspace, `/dashboard/${encodeURIComponent(ticker)}/summary`)}${suffix}`);
}

