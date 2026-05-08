"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <button type="button" onClick={onClick} className="btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }}>
      {copied ? "Copied" : label}
    </button>
  );
}
