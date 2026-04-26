"use client";

import {
  MarkdownBlock,
  fmtMarketCap,
  fmtMoney,
  normalizeReasonText,
  prettyReasonLabel,
  type CurrencyContext,
} from "@/components/hedge-dashboard";

import { PersonaAvatar } from "./persona-avatar";
import { getPersonaTheme } from "./persona-themes";

export type PersonaCardData = {
  persona: string;
  target_price: number | null;
  target_market_cap: number | null;
  investment_amount: number | null;
  reason_sections: Array<{ path?: string; label: string; text: string }>;
};

export function PersonaCard({
  member,
  ctx,
  currentPrice,
  index,
  total,
}: {
  member: PersonaCardData;
  ctx: CurrencyContext;
  currentPrice: number | null | undefined;
  index: number;
  total: number;
}) {
  const theme = getPersonaTheme(member.persona);

  const changePct =
    typeof currentPrice === "number" && typeof member.target_price === "number" && Math.abs(currentPrice) > 1e-9
      ? ((Number(member.target_price) - currentPrice) / currentPrice) * 100
      : null;
  const allocationPct =
    typeof member.investment_amount === "number" && Number.isFinite(member.investment_amount)
      ? (member.investment_amount / 100000) * 100
      : null;

  const priceTone =
    typeof changePct === "number" && Math.abs(changePct) > 1e-9
      ? changePct > 0
        ? "hib-target-up"
        : "hib-target-down"
      : "text-zinc-200";
  const allocationTone =
    typeof allocationPct === "number" && Math.abs(allocationPct) > 1e-9
      ? allocationPct > 0
        ? "hib-target-up"
        : "hib-target-down"
      : "text-zinc-200";

  const sections = member.reason_sections.filter((s) => normalizeReasonText(String(s.text || "")));

  return (
    <article
      className="relative flex h-full w-full flex-col overflow-hidden border-y border-white/10 bg-zinc-950/80 shadow-2xl sm:rounded-3xl sm:border"
      style={{
        backgroundImage: `radial-gradient(circle at 0% 0%, ${theme.accentSoft} 0%, transparent 55%), radial-gradient(circle at 100% 100%, ${theme.accentSoft} 0%, transparent 60%)`,
      }}
    >
      <header className="relative border-b border-white/5 px-4 pb-4 pt-5 sm:px-8">
        <div className="flex items-center gap-4">
          <PersonaAvatar name={member.persona} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-2xl leading-tight text-zinc-100 sm:text-[26px]">
                {member.persona}
              </h2>
              <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
                AI Persona
              </span>
            </div>
            <p
              className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em]"
              style={{ color: theme.accent }}
            >
              {theme.role}
            </p>
            <p className="mt-1 truncate text-xs italic text-zinc-400">{theme.tagline}</p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-3 sm:gap-6">
          <div className="min-w-0 leading-tight">
            <dt className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">Target</dt>
            <dd className={`mt-0.5 truncate font-mono text-sm font-semibold ${priceTone}`}>
              {fmtMoney(member.target_price, ctx, "price")}
            </dd>
            <dd className={`text-[10px] font-mono ${priceTone}`}>
              {typeof changePct === "number" ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "—"}
            </dd>
          </div>
          <div className="min-w-0 leading-tight">
            <dt className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">Mkt Cap</dt>
            <dd className="mt-0.5 truncate font-mono text-sm font-semibold text-zinc-100">
              {fmtMarketCap(member.target_market_cap, ctx)}
            </dd>
          </div>
          <div className="min-w-0 leading-tight">
            <dt className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">Allocation</dt>
            <dd className={`mt-0.5 truncate font-mono text-sm font-semibold ${allocationTone}`}>
              {typeof allocationPct === "number"
                ? `${allocationPct > 0 ? "+" : ""}${allocationPct.toFixed(2)}%`
                : "—"}
            </dd>
          </div>
        </dl>
      </header>

      <div className="dream-team-scroll flex-1 overflow-y-auto px-4 pb-7 pt-5 sm:px-9">
        {sections.length ? (
          <div className="space-y-7">
            {sections.map((section, i) => {
              const text = normalizeReasonText(String(section.text || ""));
              return (
                <section key={section.path || `${section.label}-${i}`}>
                  <h3
                    className="mb-2 font-display text-[11px] uppercase tracking-[0.22em]"
                    style={{ color: theme.accent }}
                  >
                    {prettyReasonLabel(section.label)}
                  </h3>
                  <MarkdownBlock text={text} />
                </section>
              );
            })}
          </div>
        ) : (
          <p className="text-sm italic text-zinc-500">
            No step-by-step rationale available for this persona.
          </p>
        )}

        <p className="mt-10 text-[10px] uppercase tracking-[0.22em] text-zinc-600">
          {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")} · Dream Team Edition
        </p>
      </div>
    </article>
  );
}
