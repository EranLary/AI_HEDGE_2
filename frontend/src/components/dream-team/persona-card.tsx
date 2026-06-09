"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  MarkdownBlock,
  SmallCopyButton,
  fmtMarketCap,
  fmtMoney,
  normalizeReasonText,
  prettyReasonLabel,
  type CurrencyContext,
} from "@/components/hedge-dashboard";
import { EyeOff, MessageSquare, Pencil, RotateCcw, SquarePen } from "lucide-react";

import { getPersonaTheme } from "./persona-themes";

export type PersonaCardData = {
  persona: string;
  target_price: number | null;
  target_market_cap: number | null;
  investment_amount: number | null;
  reason_sections: Array<{ path?: string; label: string; text: string }>;
};

type PersonaPickerOption = {
  name: string;
  targetPrice: number | null;
};

type PersonaChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  persona?: string;
};

type ChatStatusKind = "neutral" | "success" | "error";

const THINKING_WORDS = [
  "Thesis Mapping",
  "Risk Scanning",
  "Value Framing",
  "Signal Weighing",
  "Context Parsing",
  "Evidence Linking",
  "Driver Ranking",
  "Moat Testing",
  "Scenario Stressing",
  "Assumption Auditing",
  "Cashflow Tracing",
  "Margin Calibrating",
  "Catalyst Prioritizing",
  "Sensitivity Testing",
  "Allocation Framing",
  "Benchmark Comparing",
  "Probability Weighing",
  "Filing Synthesizing",
  "Conclusion Drafting",
  "Score Refining",
  "Conviction Testing",
  "Volatility Assessing",
  "Exposure Balancing",
  "Liquidity Reviewing",
  "Return Optimizing",
  "Discipline Applying",
  "Inference Validating",
  "Evidence Auditing",
  "Outlier Inspecting",
  "Trigger Monitoring",
  "Timing Evaluating",
  "Framework Aligning",
  "Signal Filtering",
  "Quality Verifying",
  "Narrative Stressing",
  "Forecast Refining",
] as const;

const HEBREW_RE = /[\u0590-\u05FF]/;

export function PersonaCard({
  member,
  ticker,
  personas,
  activePersona,
  ctx,
  currentPrice,
  liveCurrentPrice,
  index,
  total,
  canUseChat,
  chatOpen,
  chatMessages,
  chatDraft,
  chatEditing,
  chatSending,
  chatFetching,
  includeAnnual,
  includeQuarterly,
  annualPending,
  quarterlyPending,
  annualReady,
  quarterlyReady,
  chatError,
  chatStatusMessage,
  chatStatusKind,
  onChatDraftChange,
  onOpenChat,
  onCloseChat,
  onPersonaSwitch,
  onNewChat,
  onChatSend,
  onStopThinking,
  onEditUserMessage,
  onCancelEdit,
  onAttachAnnual,
  onAttachQuarterly,
  onAttachBoth,
}: {
  member: PersonaCardData;
  ticker: string;
  personas: PersonaPickerOption[];
  activePersona: string;
  ctx: CurrencyContext;
  currentPrice: number | null | undefined;
  liveCurrentPrice: number | null | undefined;
  index: number;
  total: number;
  canUseChat: boolean;
  chatOpen: boolean;
  chatMessages: PersonaChatMessage[];
  chatDraft: string;
  chatEditing: boolean;
  chatSending: boolean;
  chatFetching: boolean;
  includeAnnual: boolean;
  includeQuarterly: boolean;
  annualPending: boolean;
  quarterlyPending: boolean;
  annualReady: boolean;
  quarterlyReady: boolean;
  chatError: string;
  chatStatusMessage: string;
  chatStatusKind: ChatStatusKind;
  onChatDraftChange: (value: string) => void;
  onOpenChat: () => void;
  onCloseChat: () => void;
  onPersonaSwitch: (persona: string) => void;
  onNewChat: () => void;
  onChatSend: () => void;
  onStopThinking: (sendAfterStop: boolean) => void;
  onEditUserMessage: (messageId: string) => void;
  onCancelEdit: () => void;
  onAttachAnnual: () => void;
  onAttachQuarterly: () => void;
  onAttachBoth: () => void;
}) {
  const theme = getPersonaTheme(member.persona);
  const [thinkingWord, setThinkingWord] = useState("Thinking");
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const isNearBottom = (el: HTMLDivElement): boolean => {
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    return remaining < 36;
  };

  const scrollTranscriptToBottom = (behavior: ScrollBehavior) => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const handleSend = () => {
    shouldStickToBottomRef.current = true;
    scrollTranscriptToBottom("smooth");
    onChatSend();
  };

  useEffect(() => {
    if (!chatSending) {
      setThinkingWord("Thinking");
      return;
    }
    setThinkingWord("Thinking");
    let cancelled = false;
    let stage = 0;
    let timerId: number | null = null;
    let prevRandom = "";

    const randomDelayMs = () => 2200 + Math.floor(Math.random() * 1401);
    const pickRandomPhrase = () => {
      if (THINKING_WORDS.length <= 1) return THINKING_WORDS[0] || "Analyzing company";
      let next = THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)] || "Analyzing company";
      while (next === prevRandom) {
        next = THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)] || "Analyzing company";
      }
      prevRandom = next;
      return next;
    };

    const schedule = () => {
      timerId = window.setTimeout(() => {
        if (cancelled) return;
        if (stage === 0) {
          setThinkingWord("Analyzing company");
          stage = 1;
        } else {
          setThinkingWord(pickRandomPhrase());
        }
        schedule();
      }, randomDelayMs());
    };

    schedule();
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [chatSending]);

  useEffect(() => {
    if (!chatOpen) {
      shouldStickToBottomRef.current = true;
      return;
    }
    shouldStickToBottomRef.current = true;
    const id = window.requestAnimationFrame(() => {
      scrollTranscriptToBottom("auto");
    });
    return () => window.cancelAnimationFrame(id);
  }, [chatOpen]);

  useLayoutEffect(() => {
    if (!chatOpen) return;
    if (shouldStickToBottomRef.current) {
      scrollTranscriptToBottom(chatSending ? "auto" : "smooth");
    }
  }, [chatMessages, chatSending, chatOpen]);

  useEffect(() => {
    if (!chatOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [chatOpen]);

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
  const dreamBlogCopyText = sections
    .map((section) => {
      const text = normalizeReasonText(String(section.text || ""));
      if (!text) return "";
      return `${prettyReasonLabel(section.label)}\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
  const personaPickerRows = personas.map((row) => {
    const target = typeof row.targetPrice === "number" && Number.isFinite(row.targetPrice) ? row.targetPrice : null;
    const isNeutral = typeof currentPrice !== "number" || !Number.isFinite(currentPrice) || target === null || Math.abs(target - currentPrice) < 1e-9;
    return {
      ...row,
      isActive: row.name === activePersona,
      tone: isNeutral ? "neutral" : target > currentPrice ? "up" : "down",
    };
  });
  const latestMessage = chatMessages.length ? chatMessages[chatMessages.length - 1] : null;
  const hasStartedAssistantReveal =
    Boolean(latestMessage) &&
    latestMessage?.role === "assistant" &&
    String(latestMessage?.content || "").trim().length > 0;
  const annualButtonDisabled = chatSending || annualPending || includeAnnual;
  const quarterlyButtonDisabled = chatSending || quarterlyPending || includeQuarterly;
  const bothButtonDisabled = chatSending || annualPending || quarterlyPending || (includeAnnual && includeQuarterly);
  const draftTrimmed = String(chatDraft || "").trim();
  const stopWillSend = chatSending && draftTrimmed.length > 0;
  const statusLine = chatFetching
    ? "Fetching filing context..."
    : chatSending
      ? ""
      : chatError || chatStatusMessage || " ";
  const statusToneClass = chatFetching || chatSending
    ? "text-zinc-500"
    : chatError
      ? "text-rose-300"
      : chatStatusKind === "success"
        ? "text-emerald-300"
        : chatStatusKind === "error"
          ? "text-amber-300"
          : "text-zinc-500";

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
              disabled={chatOpen}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
            >
              <MessageSquare size={14} />
              {chatOpen
                ? `Chat open with ${member.persona} AI persona about ${ticker}`
                : `Chat with ${member.persona} AI persona about ${ticker}`}
            </button>
          </div>
        ) : null}
      </header>

      {canUseChat && chatOpen ? (
        <section className="hib-dream-chat-panel hib-dream-chat-panel-expanded fixed inset-0 z-[70] flex h-[100dvh] w-screen flex-col rounded-none px-4 py-3 shadow-2xl backdrop-blur sm:px-8">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-display text-sm text-zinc-200">
              Chat with {activePersona} AI persona about {ticker}
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onNewChat}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 text-zinc-300 transition hover:border-white/35 hover:text-zinc-100"
                title="Start new chat"
                aria-label="Start new chat"
              >
                <SquarePen size={12} />
              </button>
              <button
                type="button"
                onClick={onCloseChat}
                className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-zinc-300 transition hover:border-white/35 hover:text-zinc-100"
                title="Hide chat"
                aria-label="Hide chat"
              >
                <EyeOff size={12} />
                Hide chat
              </button>
            </div>
          </div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px]">
            <span className="uppercase tracking-[0.14em] text-zinc-500">Talking now</span>
            <span className="font-semibold text-zinc-100">{activePersona}</span>
            <span className={`font-mono font-semibold ${priceTone}`}>
              Target: {typeof changePct === "number" ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "N/A"}
            </span>
            <span className={`font-mono font-semibold ${allocationTone}`}>
              Allocation: {typeof allocationPct === "number" ? `${allocationPct > 0 ? "+" : ""}${allocationPct.toFixed(2)}%` : "N/A"}
            </span>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Valuator</span>
            <div className="flex flex-wrap gap-2">
              {personaPickerRows.map((row) => {
                const toneClass = row.isActive
                  ? (
                    row.tone === "up"
                      ? "border-emerald-500/60 bg-emerald-500/24 text-emerald-100"
                      : row.tone === "down"
                        ? "border-red-500/60 bg-red-500/24 text-red-100"
                        : "border-white/25 bg-white/10 text-zinc-100"
                  )
                  : (
                    row.tone === "up"
                      ? "border-emerald-500/35 bg-emerald-500/8 text-zinc-300"
                      : row.tone === "down"
                        ? "border-red-500/35 bg-red-500/8 text-zinc-300"
                        : "border-white/20 bg-white/5 text-zinc-300"
                  );
                const activeClass = row.isActive
                  ? "ring-2 ring-sky-300/90 ring-offset-1 ring-offset-zinc-950 shadow-sm"
                  : "hover:border-white/40";
                return (
                  <button
                    key={row.name}
                    type="button"
                    onClick={() => onPersonaSwitch(row.name)}
                    className={`rounded-full border px-3 py-1 text-[11px] transition ${toneClass} ${activeClass}`}
                    aria-pressed={row.isActive}
                  >
                    <span className="inline-flex items-center gap-1">
                      {row.isActive ? <span className="text-[10px] leading-none text-sky-200">●</span> : null}
                      <span>{row.name}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onAttachAnnual}
                disabled={annualButtonDisabled}
                className={`rounded-full border px-3 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-85 ${
                  includeAnnual
                    ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-100"
                    : annualPending
                      ? "border-slate-400/40 bg-slate-500/20 text-zinc-300"
                      : "border-white/20 text-zinc-200 hover:border-white/40 hover:text-zinc-100"
                }`}
              >
                {includeAnnual ? "Annual On" : annualPending ? "Annual Loading..." : "Add Annual"}
              </button>
              <button
                type="button"
                onClick={onAttachQuarterly}
                disabled={quarterlyButtonDisabled}
                className={`rounded-full border px-3 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-85 ${
                  includeQuarterly
                    ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-100"
                    : quarterlyPending
                      ? "border-slate-400/40 bg-slate-500/20 text-zinc-300"
                      : "border-white/20 text-zinc-200 hover:border-white/40 hover:text-zinc-100"
                }`}
              >
                {includeQuarterly ? "Quarterly On" : quarterlyPending ? "Quarterly Loading..." : "Add Quarterly"}
              </button>
              <button
                type="button"
                onClick={onAttachBoth}
                disabled={bothButtonDisabled}
                className={`rounded-full border px-3 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-85 ${
                  includeAnnual && includeQuarterly
                    ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-100"
                    : annualPending || quarterlyPending
                      ? "border-slate-400/40 bg-slate-500/20 text-zinc-300"
                      : "border-white/20 text-zinc-200 hover:border-white/40 hover:text-zinc-100"
                }`}
              >
                {includeAnnual && includeQuarterly
                  ? "Annual + Quarterly On"
                  : annualPending || quarterlyPending
                    ? "Loading Both..."
                    : "Add Both"}
              </button>
          </div>

          {chatMessages.length > 0 ? (
            <div
              ref={transcriptRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                shouldStickToBottomRef.current = isNearBottom(el);
              }}
              className="hib-dream-chat-transcript mt-3 flex-1 space-y-3 overflow-y-auto rounded-xl border p-3"
            >
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    msg.role === "assistant"
                      ? "hib-dream-chat-msg-assistant"
                      : "hib-dream-chat-msg-user"
                  }`}
                  dir={HEBREW_RE.test(msg.content) ? "rtl" : "ltr"}
                  style={{ unicodeBidi: "plaintext" }}
                >
                  <p className="mb-1 text-[10px] uppercase tracking-[0.15em] text-zinc-400">
                    {msg.role === "assistant" ? (msg.persona || activePersona) : "You"}
                  </p>
                  {msg.role === "user" && !chatSending ? (
                    <button
                      type="button"
                      onClick={() => onEditUserMessage(msg.id)}
                      className="mb-1 inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-300 transition hover:border-white/35 hover:text-zinc-100"
                      title="Edit this message"
                      aria-label="Edit this message"
                    >
                      <Pencil size={10} />
                      Edit
                    </button>
                  ) : null}
                  <div className={HEBREW_RE.test(msg.content) ? "text-right leading-8" : "text-left leading-7"}>
                    <MarkdownBlock text={msg.content} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className={`${chatMessages.length > 0 ? "mt-4" : "mt-8"} flex flex-col gap-2`}>
            <textarea
              value={chatDraft}
              onChange={(e) => onChatDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (chatSending) {
                    onStopThinking(stopWillSend);
                  } else {
                    handleSend();
                  }
                }
              }}
              disabled={chatFetching}
              rows={4}
              placeholder={`Ask ${member.persona} about valuation, assumptions, or risk...`}
              dir="auto"
              className="hib-dream-chat-input w-full resize-y rounded-xl border px-3 py-2 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {chatEditing && !chatSending ? (
                  <button
                    type="button"
                    onClick={onCancelEdit}
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-zinc-300 transition hover:border-white/40 hover:text-zinc-100"
                    title="Cancel edit"
                    aria-label="Cancel edit"
                  >
                    <RotateCcw size={10} />
                    Cancel edit
                  </button>
                ) : null}
                <p className={`text-xs ${statusToneClass}`}>
                  {chatSending && !hasStartedAssistantReveal ? (
                    <span className="inline-flex items-center gap-1.5">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={thinkingWord}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.22 }}
                          className="text-zinc-300"
                        >
                          {thinkingWord}...
                        </motion.span>
                      </AnimatePresence>
                    </span>
                  ) : (
                    chatSending ? " " : statusLine
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (chatSending) {
                    onStopThinking(stopWillSend);
                  } else {
                    handleSend();
                  }
                }}
                disabled={chatFetching || (!chatSending && !draftTrimmed)}
                className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {chatSending ? (stopWillSend ? "Stop & Send" : "Stop") : "Send"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="dream-team-scroll flex-1 overflow-y-auto px-4 pb-7 pt-5 sm:px-9">
        {sections.length ? (
          <div className="space-y-7">
            <div className="flex justify-end">
              <SmallCopyButton text={dreamBlogCopyText} label={`Copy ${member.persona} blog`} iconOnly />
            </div>
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
