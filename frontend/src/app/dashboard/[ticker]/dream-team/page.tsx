"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";

import { useDashboardPayload } from "@/lib/use-dashboard-payload";
import { DashboardError, DashboardSkeleton, ReportChipRow } from "@/components/dashboard-chrome";
import { buildCurrencyContext, fmtMarketCap, fmtMoney, fmtMoneyCompact } from "@/components/hedge-dashboard";

export default function DashboardDreamTeamPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = use(params);
  const upper = decodeURIComponent(ticker).toUpperCase();
  const search = useSearchParams();
  const reportId = search?.get("report") || undefined;
  const { data, loading, error, reportsForTicker, resolvedReportId } = useDashboardPayload(upper, reportId);

  if (loading && !data) return <DashboardSkeleton />;
  if (!data) return <DashboardError error={error || "No data"} ticker={upper} />;

  const ctx = buildCurrencyContext(data);
  const team = data.dream_team || [];
  const currentPrice = data.valuation_hub.consensus?.current_price;

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-4">
        <h1 className="font-display text-2xl text-zinc-100 inline-flex items-center gap-2">
          <Users size={18} className="text-emerald-300" /> Dream Team
        </h1>
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{upper} — investor personas</p>
      </header>

      {team.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {team.map((member, idx) => {
            const changePct =
              typeof currentPrice === "number" && typeof member.target_price === "number" && Math.abs(currentPrice) > 1e-9
                ? ((Number(member.target_price) - currentPrice) / currentPrice) * 100
                : null;
            const tone =
              typeof changePct === "number" && Math.abs(changePct) > 1e-9
                ? changePct > 0
                  ? "hib-target-up"
                  : "hib-target-down"
                : "text-zinc-200";
            return (
              <article key={`${member.persona}-${idx}`} className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Persona</p>
                <h2 className="mt-0.5 text-lg font-semibold text-zinc-100">{member.persona || `Persona ${idx + 1}`}</h2>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                    <dt className="text-zinc-500">Target Price</dt>
                    <dd className={`mt-0.5 text-base font-semibold ${tone}`}>{fmtMoney(member.target_price, ctx, "price")}</dd>
                    <dd className={`text-[10px] ${tone}`}>
                      {typeof changePct === "number" ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "N/A"}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                    <dt className="text-zinc-500">Target Market Cap</dt>
                    <dd className="mt-0.5 text-base font-semibold text-zinc-100">{fmtMarketCap(member.target_market_cap, ctx)}</dd>
                  </div>
                  <div className="col-span-2 rounded-lg border border-white/10 bg-black/30 p-2">
                    <dt className="text-zinc-500">Investment Amount</dt>
                    <dd className="mt-0.5 text-base font-semibold text-zinc-100">{fmtMoneyCompact(member.investment_amount, ctx, "financial")}</dd>
                  </div>
                </dl>
                {member.investment_rationale ? (
                  <details className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3 text-xs" open>
                    <summary className="cursor-pointer text-[10px] uppercase tracking-[0.18em] text-zinc-400">Rationale</summary>
                    <p className="mt-2 whitespace-pre-line text-zinc-200">{member.investment_rationale}</p>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No dream-team personas emitted for this report.</p>
      )}
    </div>
  );
}
