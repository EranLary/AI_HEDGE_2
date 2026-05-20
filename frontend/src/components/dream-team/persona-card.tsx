"use client";

import {
  MarkdownBlock,
  fmtMarketCap,
  fmtMoney,
  normalizeReasonText,
  prettyReasonLabel,
  type CurrencyContext,
} from "@/components/hedge-dashboard";
import { MessageSquare, X } from "lucide-react";

import { getPersonaTheme } from "./persona-themes";

export type PersonaCardData = {
  persona: string;
  target_price: number | null;
  target_market_cap: number | null;
  investment_amount: number | null;
  reason_sections: Array<{ path?: string; label: string; text: string }>;
};

type PersonaChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function PersonaCard({
  member,
  ctx,
  currentPrice,
  liveCurrentPrice,
  index,
  total,
  canUseChat,
  chatOpen,
  chatMessages,
  chatDraft,
  chatSending,
  chatFetching,
  includeAnnual,
  includeQuarterly,
  annualReady,
  quarterlyReady,
  chatError,
  onChatDraftChange,
  onOpenChat,
  onCloseChat,
  onChatSend,
  onAttachAnnual,
  onAttachQuarterly,
  onAttachBoth,
}: {
  member: PersonaCardData;
  ctx: CurrencyContext;
  currentPrice: number | null | undefined;
  liveCurrentPrice: number | null | undefined;
  index: number;
  total: number;
  canUseChat: boolean;
  chatOpen: boolean;
  chatMessages: PersonaChatMessage[];
  chatDraft: string;
  chatSending: boolean;
  chatFetching: boolean;
  includeAnnual: boolean;
  includeQuarterly: boolean;
  annualReady: boolean;
  quarterlyReady: boolean;
  chatError: string;
  onChatDraftChange: (value: string) => void;
  onOpenChat: () => void;
  onCloseChat: () => void;
  onChatSend: () => void;
  onAttachAnnual: () => void;
  onAttachQuarterly: () => void;
  onAttachBoth: () => void;
}) {
  const theme = getPersonaTheme(member.persona);

  const directionOf = (value?: number | null): -1 | 0 | 1 | null => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (Math.abs(value) < 1e-9) return 0;
    return value > 0 ? 1 : -1;
  };

  const targetDirectionWithFloor = (target?: number | null, reportPrice?: number | null): -1 | 0 | 1 | null => {
    if (typeof reportPrice !== "number" || !Number.isFinite(reportPrice)) return null;
    const effectiveTarget =
      typeof target === "number" && Number.isFinite(target)
        ? (target < 0 ? 0 : target)
        : 0;
    return directionOf(effectiveTarget - reportPrice);
  };

  const verdictMark = (predicted: -1 | 0 | 1 | null, actual: -1 | 0 | 1 | null): "OK" | "NO" | "-" => {
    if (predicted === null || actual === null) return "-";
    if (predicted === 0 || actual === 0) return "-";
    return predicted === actual ? "OK" : "NO";
  };

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
  const actualDirection = directionOf(
    typeof liveCurrentPrice === "number" && typeof currentPrice === "number"
      ? liveCurrentPrice - currentPrice
      : null,
  );
  const targetVerdict = verdictMark(targetDirectionWithFloor(member.target_price, currentPrice), actualDirection);
  const allocationVerdict = verdictMark(directionOf(allocationPct), actualDirection);

  const sections = member.reason_sections.filter((s) => normalizeReasonText(String(s.text || "")));

  return (
    <article
      className="relative flex h-full w-full flex-col overflow-hidden border-y border-white/10 bg-zinc-950/80 shadow-2xl sm:rounded-3xl sm:border"
      style={{
        backgroundImage: `radial-gradient(circle at 0% 0%, ${theme.accentSoft} 0%, transparent 55%), radial-gradient(circle at 100% 100%, ${theme.accentSoft} 0%, transparent 60%)`,
      }}
    >
      <header className="relative border-b border-white/5 px-4 pb-4 pt-5 sm:px-8">
        <div className="min-w-0">
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
            <h2 className="font-display break-words text-2xl leading-tight text-zinc-100 sm:text-[26px]">
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
          <p className="mt-1 break-words text-xs italic text-zinc-400">{theme.tagline}</p>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-3 sm:gap-6">
          <div className="min-w-0 leading-tight">
            <dt className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">
              Target <span className="text-zinc-300">({targetVerdict})</span>
            </dt>
            <dd className={`mt-0.5 truncate font-mono text-sm font-semibold ${priceTone}`}>
              {fmtMoney(member.target_price, ctx, "price")}
            </dd>
            <dd className={`text-[10px] font-mono ${priceTone}`}>
              {typeof changePct === "number" ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "-"}
            </dd>
          </div>
          <div className="min-w-0 leading-tight">
            <dt className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">Mkt Cap</dt>
            <dd className="mt-0.5 truncate font-mono text-sm font-semibold text-zinc-100">
              {fmtMarketCap(member.target_market_cap, ctx)}
            </dd>
          </div>
          <div className="min-w-0 leading-tight">
            <dt className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">
              Allocation <span className="text-zinc-300">({allocationVerdict})</span>
            </dt>
            <dd className={`mt-0.5 truncate font-mono text-sm font-semibold ${allocationTone}`}>
              {typeof allocationPct === "number"
                ? `${allocationPct > 0 ? "+" : ""}${allocationPct.toFixed(2)}%`
                : "-"}
            </dd>
          </div>
        </dl>

        {canUseChat ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={onOpenChat}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-100 transition hover:bg-emerald-500/20"
            >
              <MessageSquare size={14} />
              Chat with {member.persona} AI persona
            </button>
          </div>
        ) : null}
      </header>

      {canUseChat && chatOpen ? (
        <section className="border-b border-white/10 bg-black/25 px-4 py-3 sm:px-8">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-display text-sm uppercase tracking-[0.2em] text-zinc-200">
              Chat with {member.persona} AI persona
            </h3>
            <button
              type="button"
              onClick={onCloseChat}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-zinc-300 transition hover:border-white/35 hover:text-zinc-100"
            >
              <X size={12} />
              Close
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-zinc-400">
              <span className={`rounded-full border px-2 py-0.5 ${includeAnnual ? "border-emerald-400/40 text-emerald-200" : "border-white/15 text-zinc-400"}`}>
                Annual {includeAnnual ? (annualReady ? "On" : "Pending") : "Off"}
              </span>
              <span className={`rounded-full border px-2 py-0.5 ${includeQuarterly ? "border-emerald-400/40 text-emerald-200" : "border-white/15 text-zinc-400"}`}>
                Quarterly {includeQuarterly ? (quarterlyReady ? "On" : "Pending") : "Off"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onAttachAnnual}
                disabled={chatFetching || chatSending}
                className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-zinc-200 transition hover:border-white/40 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add Annual
              </button>
              <button
                type="button"
                onClick={onAttachQuarterly}
                disabled={chatFetching || chatSending}
                className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-zinc-200 transition hover:border-white/40 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add Quarterly
              </button>
              <button
                type="button"
                onClick={onAttachBoth}
                disabled={chatFetching || chatSending}
                className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-zinc-200 transition hover:border-white/40 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add Both
              </button>
            </div>
          </div>

          <div className="mt-3 max-h-64 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3">
            {chatMessages.length ? (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    msg.role === "assistant"
                      ? "border-white/10 bg-zinc-900/70 text-zinc-100"
                      : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                  }`}
                >
                  <p className="mb-1 text-[10px] uppercase tracking-[0.15em] text-zinc-400">
                    {msg.role === "assistant" ? member.persona : "You"}
                  </p>
                  <MarkdownBlock text={msg.content} />
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-500">Start chatting with this AI persona.</p>
            )}
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <textarea
              value={chatDraft}
              onChange={(e) => onChatDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onChatSend();
                }
              }}
              disabled={chatSending || chatFetching}
              rows={3}
              placeholder={`Ask ${member.persona} about valuation, assumptions, or risk...`}
              className="w-full resize-y rounded-xl border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {chatError || (chatFetching ? "Fetching filing context..." : chatSending ? "Thinking..." : " ")}
              </p>
              <button
                type="button"
                onClick={onChatSend}
                disabled={chatSending || chatFetching || !String(chatDraft || "").trim()}
                className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {chatSending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

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
