import { redirect } from "next/navigation";

export default async function DashboardTickerRootPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const search = await searchParams;
  const report = typeof search?.report === "string" ? search.report : undefined;
  const suffix = report ? `?report=${encodeURIComponent(report)}` : "";
  redirect(`/dashboard/${encodeURIComponent(ticker)}/summary${suffix}`);
}
