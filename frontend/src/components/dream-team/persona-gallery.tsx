"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import type { CurrencyContext } from "@/components/hedge-dashboard";
import type { ReportListItem } from "@/lib/dashboard-types";

import { PersonaCard, type PersonaCardData } from "./persona-card";
import { getPersonaTheme, INVESTORS_ORDERED } from "./persona-themes";

type DreamTeamMember = {
  persona: string;
  target_price: number | null;
  target_market_cap: number | null;
  investment_amount: number | null;
};

type DreamOutput = {
  persona?: string;
  reason_sections?: Array<{ path?: string; label: string; text: string }>;
};

type PersonaChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type PersonaChatState = {
  messages: PersonaChatMessage[];
  draft: string;
  includeAnnual: boolean;
  includeQuarterly: boolean;
  annualReady: boolean;
  quarterlyReady: boolean;
  sending: boolean;
  fetching: boolean;
  error: string;
};

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -60 : 60, opacity: 0 }),
};

function makeEmptyChatState(): PersonaChatState {
  return {
    messages: [],
    draft: "",
    includeAnnual: false,
    includeQuarterly: false,
    annualReady: false,
    quarterlyReady: false,
    sending: false,
    fetching: false,
    error: "",
  };
}

function chatScopeKey(reportId: string, persona: string): string {
  return `${String(reportId || "").trim()}::${String(persona || "").trim()}`;
}

function toChatError(status: number, fallback: string): string {
  if (status === 401 || status === 403) {
    return "Please sign up or sign in with Google to use Dream Team chat.";
  }
  return fallback;
}

export function PersonaGallery({
  personas,
  dreamOutputs,
  ctx,
  currentPrice,
  liveCurrentPrice,
  ticker,
  reports,
  currentReportId,
  canUseChat,
}: {
  personas: DreamTeamMember[];
  dreamOutputs: DreamOutput[];
  ctx: CurrencyContext;
  currentPrice: number | null | undefined;
  liveCurrentPrice: number | null | undefined;
  ticker: string;
  reports: ReportListItem[];
  currentReportId: string;
  canUseChat: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [chatByScope, setChatByScope] = useState<Record<string, PersonaChatState>>({});
  const [chatOpenByScope, setChatOpenByScope] = useState<Record<string, boolean>>({});

  const merged: PersonaCardData[] = useMemo(
    () => {
      const rankFor = (name: string): number => {
        const idx = (INVESTORS_ORDERED as readonly string[]).indexOf(name);
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
      };
      const ordered = personas
        .slice()
        .sort((a, b) => {
          const aRank = rankFor(String(a.persona || "").trim());
          const bRank = rankFor(String(b.persona || "").trim());
          return aRank - bRank;
        });
      return ordered.map((member, idx) => {
        const byName = dreamOutputs.find(
          (o) => String(o.persona || "").trim() === String(member.persona || "").trim(),
        );
        const fallback = dreamOutputs[idx];
        const source = byName || fallback;
        const sections = Array.isArray(source?.reason_sections) ? source!.reason_sections : [];
        return { ...member, reason_sections: sections };
      });
    },
    [personas, dreamOutputs],
  );

  const total = merged.length;

  const goTo = useCallback(
    (target: number) => {
      if (!total) return;
      const wrapped = ((target % total) + total) % total;
      setActiveIndex((prev) => {
        if (wrapped === prev) return prev;
        setDirection(wrapped > prev || (prev === total - 1 && wrapped === 0) ? 1 : -1);
        return wrapped;
      });
    },
    [total],
  );

  const next = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const prev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  useEffect(() => {
    if (!total) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [next, prev, total]);

  if (!total) {
    return <p className="text-sm text-zinc-500">No dream-team personas emitted for this report.</p>;
  }

  const active = merged[activeIndex];
  const activeTheme = getPersonaTheme(active.persona);
  const activeScopeKey = chatScopeKey(currentReportId, active.persona);
  const activeChat = chatByScope[activeScopeKey] || makeEmptyChatState();
  const activeChatOpen = Boolean(chatOpenByScope[activeScopeKey]);

  const setActiveChat = useCallback(
    (updater: (prev: PersonaChatState) => PersonaChatState) => {
      setChatByScope((prev) => {
        const current = prev[activeScopeKey] || makeEmptyChatState();
        return {
          ...prev,
          [activeScopeKey]: updater(current),
        };
      });
    },
    [activeScopeKey],
  );

  const chatApiPath = useMemo(
    () => `/api/dashboard/${encodeURIComponent(ticker)}/dream-team/chat`,
    [ticker],
  );

  const fetchFilings = useCallback(
    async (args: { annual: boolean; quarterly: boolean }) => {
      if (!canUseChat) return;
      if (!args.annual && !args.quarterly) return;
      setActiveChat((prev) => ({ ...prev, fetching: true, error: "" }));
      try {
        const res = await fetch(chatApiPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "fetch_filings",
            report_id: currentReportId,
            persona: active.persona,
            include_annual: args.annual,
            include_quarterly: args.quarterly,
            messages: [],
            user_message: "",
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          filings?: {
            annual?: { available?: boolean };
            quarterly?: { available?: boolean };
          };
        };
        if (!res.ok) {
          throw new Error(toChatError(res.status, data.error || "Failed to fetch filings."));
        }
        const annualReady = Boolean(data.filings?.annual?.available);
        const quarterlyReady = Boolean(data.filings?.quarterly?.available);
        setActiveChat((prev) => ({
          ...prev,
          fetching: false,
          includeAnnual: args.annual ? annualReady || prev.includeAnnual : prev.includeAnnual,
          includeQuarterly: args.quarterly ? quarterlyReady || prev.includeQuarterly : prev.includeQuarterly,
          annualReady: args.annual ? annualReady : prev.annualReady,
          quarterlyReady: args.quarterly ? quarterlyReady : prev.quarterlyReady,
          error:
            (args.annual && !annualReady) || (args.quarterly && !quarterlyReady)
              ? "Selected filing context is not currently available."
              : "",
        }));
      } catch (err) {
        setActiveChat((prev) => ({
          ...prev,
          fetching: false,
          error: String(err || "Failed to fetch filings."),
        }));
      }
    },
    [active.persona, canUseChat, chatApiPath, currentReportId, setActiveChat],
  );

  const sendMessage = useCallback(async () => {
    if (!canUseChat) return;
    const userMessage = String(activeChat.draft || "").trim();
    if (!userMessage || activeChat.sending) return;
    const pendingUser: PersonaChatMessage = {
      id: `${Date.now()}-u`,
      role: "user",
      content: userMessage,
    };
    const messagesForRequest = [...activeChat.messages, pendingUser].slice(-20);

    setActiveChat((prev) => ({
      ...prev,
      draft: "",
      sending: true,
      error: "",
      messages: [...prev.messages, pendingUser],
    }));
      try {
        const res = await fetch(chatApiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          report_id: currentReportId,
          persona: active.persona,
          messages: messagesForRequest.map((row) => ({ role: row.role, content: row.content })),
          user_message: userMessage,
          include_annual: activeChat.includeAnnual,
          include_quarterly: activeChat.includeQuarterly,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        reply?: string;
        filings?: {
          annual?: { available?: boolean };
          quarterly?: { available?: boolean };
        };
      };
      if (!res.ok) {
        throw new Error(toChatError(res.status, data.error || "Failed to send message."));
      }
      const reply = String(data.reply || "").trim();
      if (!reply) {
        throw new Error("Empty persona reply.");
      }
      const assistantMsg: PersonaChatMessage = {
        id: `${Date.now()}-a`,
        role: "assistant",
        content: reply,
      };
      setActiveChat((prev) => ({
        ...prev,
        sending: false,
        messages: [...prev.messages, assistantMsg],
        annualReady: Boolean(data.filings?.annual?.available) || prev.annualReady,
        quarterlyReady: Boolean(data.filings?.quarterly?.available) || prev.quarterlyReady,
      }));
    } catch (err) {
      setActiveChat((prev) => ({
        ...prev,
        sending: false,
        error: String(err || "Failed to send message."),
      }));
    }
  }, [
    active.persona,
    activeChat.draft,
    activeChat.includeAnnual,
    activeChat.includeQuarterly,
    activeChat.messages,
    activeChat.sending,
    canUseChat,
    chatApiPath,
    currentReportId,
    setActiveChat,
  ]);

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-6 -z-0 h-[420px] blur-3xl transition-colors duration-700"
        style={{
          background: `radial-gradient(60% 60% at 50% 30%, ${activeTheme.accentSoft} 0%, transparent 70%)`,
        }}
        aria-hidden
      />

      <div className="mb-3 flex items-center justify-between gap-3">
        <PersonaDropdown
          personas={merged.map((row) => String(row.persona || "").trim()).filter(Boolean)}
          activePersona={active.persona}
          onSelect={(persona) => {
            const idx = merged.findIndex((row) => String(row.persona || "").trim() === persona);
            if (idx >= 0) goTo(idx);
          }}
        />
        <ReportVersionDropdown reports={reports} currentReportId={currentReportId} ticker={ticker} />
      </div>
      <div className="hib-disclaimer-amber mb-3 rounded-xl border px-3 py-2 text-xs">
        Disclaimer: Dream Team views are AI PERSONA simulations for research workflow support, not real investor quotes or advice.
      </div>

      <div className="relative -mx-4 flex items-stretch sm:mx-0 sm:gap-5">
        <NavButton direction="prev" onClick={prev} accent={activeTheme.accent} accentSoft={activeTheme.accentSoft} />

        <div
          className="relative flex-1"
          style={{ height: "min(82vh, 820px)", minHeight: 540 }}
        >
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={active.persona}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.25}
              dragDirectionLock
              onDragEnd={(_e, info) => {
                if (info.offset.x < -80 || info.velocity.x < -500) next();
                else if (info.offset.x > 80 || info.velocity.x > 500) prev();
              }}
              transition={{
                x: { type: "spring", stiffness: 300, damping: 32 },
                opacity: { duration: 0.18 },
              }}
              className="absolute inset-0 mx-auto w-full max-w-[1100px] touch-pan-y"
            >
              <PersonaCard
                member={active}
                ctx={ctx}
                currentPrice={currentPrice}
                liveCurrentPrice={liveCurrentPrice}
                index={activeIndex}
                total={total}
                canUseChat={canUseChat}
                chatOpen={activeChatOpen}
                chatMessages={activeChat.messages}
                chatDraft={activeChat.draft}
                chatSending={activeChat.sending}
                chatFetching={activeChat.fetching}
                includeAnnual={activeChat.includeAnnual}
                includeQuarterly={activeChat.includeQuarterly}
                annualReady={activeChat.annualReady}
                quarterlyReady={activeChat.quarterlyReady}
                chatError={activeChat.error}
                onChatDraftChange={(value) => setActiveChat((prev) => ({ ...prev, draft: value }))}
                onOpenChat={() => {
                  if (!canUseChat) return;
                  setChatOpenByScope((prev) => ({ ...prev, [activeScopeKey]: true }));
                }}
                onCloseChat={() => {
                  setChatOpenByScope((prev) => ({ ...prev, [activeScopeKey]: false }));
                }}
                onChatSend={() => {
                  void sendMessage();
                }}
                onAttachAnnual={() => {
                  void fetchFilings({ annual: true, quarterly: false });
                }}
                onAttachQuarterly={() => {
                  void fetchFilings({ annual: false, quarterly: true });
                }}
                onAttachBoth={() => {
                  void fetchFilings({ annual: true, quarterly: true });
                }}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        <NavButton direction="next" onClick={next} accent={activeTheme.accent} accentSoft={activeTheme.accentSoft} />
      </div>

    </div>
  );
}

function NavButton({
  direction,
  onClick,
  accent,
  accentSoft,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  accent: string;
  accentSoft: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 320, damping: 20 }}
      className="relative my-auto hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-950/70 text-zinc-200 shadow-lg backdrop-blur transition-colors hover:text-white sm:flex sm:h-12 sm:w-12"
      style={{ boxShadow: `0 12px 30px -16px ${accent}` }}
      aria-label={direction === "prev" ? "Previous persona" : "Next persona"}
    >
      <span
        className="pointer-events-none absolute inset-0 rounded-full opacity-0 transition-opacity hover:opacity-100"
        style={{ background: `radial-gradient(closest-side, ${accentSoft}, transparent 70%)` }}
        aria-hidden
      />
      <Icon size={22} strokeWidth={1.6} />
    </motion.button>
  );
}

function fmtReportLabel(report: ReportListItem): string {
  const ts = new Date(report.generated_at || report.updated_at || "");
  if (!Number.isFinite(ts.getTime())) return report.report_id.slice(0, 8);
  return ts.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function PersonaDropdown({
  personas,
  activePersona,
  onSelect,
}: {
  personas: string[];
  activePersona: string;
  onSelect: (persona: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!personas.length) return null;
  const single = personas.length === 1;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !single && setOpen((v) => !v)}
        disabled={single}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-[11px] font-medium text-zinc-300 backdrop-blur transition hover:border-white/30 hover:text-zinc-100 disabled:cursor-default disabled:hover:border-white/10 disabled:hover:text-zinc-300"
        aria-haspopup={single ? undefined : "listbox"}
        aria-expanded={open}
      >
        <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">Valuator</span>
        <span className="max-w-[150px] truncate font-mono text-[11px] text-zinc-100">{activePersona}</span>
        {!single && <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} />}
      </button>

      {open && !single ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur"
        >
          {personas.map((persona) => {
            const isActive = persona === activePersona;
            return (
              <button
                key={persona}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onSelect(persona);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-100"
                    : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                }`}
              >
                <span className="truncate">{persona}</span>
                {isActive ? <Check size={13} className="text-emerald-300" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ReportVersionDropdown({
  ticker,
  reports,
  currentReportId,
}: {
  ticker: string;
  reports: ReportListItem[];
  currentReportId: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (reports.length === 0) return null;

  const current = reports.find((r) => r.report_id === currentReportId) || reports[0];
  const single = reports.length === 1;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !single && setOpen((v) => !v)}
        disabled={single}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-[11px] font-medium text-zinc-300 backdrop-blur transition hover:border-white/30 hover:text-zinc-100 disabled:cursor-default disabled:hover:border-white/10 disabled:hover:text-zinc-300"
        aria-haspopup={single ? undefined : "listbox"}
        aria-expanded={open}
      >
        <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">{ticker} · Report</span>
        <span className="font-mono text-[11px] text-zinc-100">{fmtReportLabel(current)}</span>
        {!single && <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} />}
      </button>

      {open && !single ? (
        <div
          role="listbox"
          className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur"
        >
          {reports.map((report) => {
            const isCurrent = report.report_id === currentReportId;
            return (
              <button
                key={report.report_id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => {
                  const next = new URLSearchParams(params?.toString() || "");
                  next.set("report", report.report_id);
                  router.replace(`?${next.toString()}`, { scroll: false });
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition ${
                  isCurrent
                    ? "bg-emerald-500/10 text-emerald-100"
                    : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                }`}
              >
                <span className="font-mono">{fmtReportLabel(report)}</span>
                {isCurrent ? <Check size={13} className="text-emerald-300" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
