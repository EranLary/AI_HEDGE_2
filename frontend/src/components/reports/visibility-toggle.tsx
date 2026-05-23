"use client";

import { useEffect, useState } from "react";
import { Lock, LockOpen } from "lucide-react";

type Visibility = "public" | "private" | "unlisted";

export function VisibilityToggle({
  reportId,
  variant = "badge",
}: {
  reportId: string;
  variant?: "badge" | "icon";
}) {
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [ownsThis, setOwnsThis] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!reportId) return;
    let cancelled = false;
    fetch(`/api/reports/${encodeURIComponent(reportId)}/visibility`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setVisibility(j.visibility as Visibility);
        setOwnsThis(Boolean(j.ownsThis));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  if (!ownsThis || !visibility) return null;

  const next: Visibility = visibility === "public" ? "private" : "public";
  const isPublic = visibility === "public";

  async function flip(event?: React.MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/visibility`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (res.ok) setVisibility(next);
    } finally {
      setBusy(false);
    }
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={(event) => void flip(event)}
        disabled={busy}
        title={isPublic ? "Public - anyone can see this report" : "Private - only you can see this"}
        aria-label={isPublic ? "Set report to private" : "Set report to public"}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition disabled:opacity-50 ${
          isPublic
            ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
            : "border-white/20 bg-white/10 text-zinc-300 hover:bg-white/15"
        }`}
      >
        {isPublic ? <LockOpen size={13} /> : <Lock size={13} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => void flip(event)}
      disabled={busy}
      title={isPublic ? "Public - anyone can see this report" : "Private - only you can see this"}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition disabled:opacity-50 ${
        isPublic
          ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
          : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
      }`}
    >
      {isPublic ? <LockOpen size={12} /> : <Lock size={12} />}
      {isPublic ? "Public" : "Private"}
    </button>
  );
}

