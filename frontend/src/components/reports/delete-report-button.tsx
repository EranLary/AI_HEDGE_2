"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useWorkspace } from "@/components/shell/workspace-context";

export function DeleteReportButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const { api } = useWorkspace();
  const [busy, setBusy] = useState(false);

  async function deleteReport(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const confirmed = window.confirm("Delete this report?");
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await fetch(api(`/api/reports/${encodeURIComponent(reportId)}`), {
        method: "DELETE",
        cache: "no-store",
      });
      if (res.ok) {
        router.refresh();
      } else {
        window.alert("Could not delete this report.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(event) => void deleteReport(event)}
      disabled={busy}
      title="Delete report"
      aria-label="Delete report"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-300/40 bg-red-400/10 text-red-100 transition hover:bg-red-400/20 disabled:opacity-50"
    >
      <Trash2 size={13} />
    </button>
  );
}
