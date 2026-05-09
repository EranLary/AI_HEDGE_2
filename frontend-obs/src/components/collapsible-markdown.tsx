"use client";

import { useState, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CopyButton } from "@/components/copy-button";

type Mode = "rendered" | "raw";

export function CollapsibleMarkdown({
  title,
  body,
  defaultOpen = false,
  meta,
  emphasizeError = false,
}: {
  title: string;
  body: string | null | undefined;
  defaultOpen?: boolean;
  meta?: string;
  emphasizeError?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<Mode>("rendered");
  const hasBody = !!(body && body.trim().length > 0);

  function stop(e: MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div className={`collapsible${open && hasBody ? " collapsible--open" : ""}`}>
      <button
        type="button"
        className="collapsible__header"
        onClick={() => hasBody && setOpen((v) => !v)}
        aria-expanded={open && hasBody}
        disabled={!hasBody}
      >
        <Chevron />
        <span className="collapsible__title">{title}</span>
        {meta && <span className="collapsible__meta">{meta}</span>}
        {!hasBody && <span className="collapsible__meta">empty</span>}
        <span style={{ flex: 1 }} />
        {open && hasBody && (
          <span className="collapsible__actions" onClick={stop}>
            <span className="seg" role="tablist" aria-label={`${title} view mode`}>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "rendered"}
                className={mode === "rendered" ? "is-active" : ""}
                onClick={() => setMode("rendered")}
              >
                Rendered
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "raw"}
                className={mode === "raw" ? "is-active" : ""}
                onClick={() => setMode("raw")}
              >
                Raw
              </button>
            </span>
            <CopyButton text={body ?? ""} />
          </span>
        )}
      </button>
      {open && hasBody && (
        <div className="collapsible__body">
          {mode === "rendered" ? (
            <div className={emphasizeError ? "md md--error" : "md"}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body!}</ReactMarkdown>
            </div>
          ) : (
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                lineHeight: 1.55,
                color: emphasizeError ? "#fca5a5" : "inherit",
              }}
            >
              {body}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      width={10}
      height={10}
      className="collapsible__chevron"
    >
      <path
        d="M4 2 L8 6 L4 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
