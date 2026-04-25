"use client";

import Image from "next/image";
import { Download, FileCode2, FileText, Image as ImageIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { ReportChipRow } from "@/components/dashboard-chrome";

type ArtifactKind = "pdf" | "txt" | "json" | "png";

type ArtifactItem = {
  key: string;
  label: string;
  href: string;
  kind: ArtifactKind;
};

function kindOf(path: string): ArtifactKind {
  const p = path.toLowerCase();
  if (p.endsWith(".pdf")) return "pdf";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".svg")) return "png";
  return "txt";
}

const KIND_ICON: Record<ArtifactKind, ComponentType<{ size?: number }>> = {
  pdf: FileText,
  txt: FileText,
  json: FileCode2,
  png: ImageIcon,
};

export type ArtifactsClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

export function ArtifactsClient({
  ticker,
  data,
  reportsForTicker,
  resolvedReportId,
}: ArtifactsClientProps) {
  const upper = ticker;
  const artifacts = data.artifacts || ({} as NonNullable<typeof data.artifacts>);
  const downloads = data.downloads || ({} as NonNullable<typeof data.downloads>);

  const items: ArtifactItem[] = [];
  const push = (key: string, label: string, href: string | undefined) => {
    if (!href || typeof href !== "string") return;
    if (items.some((it) => it.href === href)) return;
    items.push({ key, label, href, kind: kindOf(href) });
  };

  push("analysis_pdf", "Analysis PDF", downloads.analysis_pdf || artifacts.analysis_pdf);
  push("analysis_txt", "Analysis TXT", downloads.analysis_txt || artifacts.analysis_txt);
  push("prices_plot", "Prices Chart", artifacts.prices_plot);
  push("revenue_plot", "Revenue Chart", artifacts.revenue_plot);
  push("net_income_plot", "Net Income Chart", artifacts.net_income_plot);
  push("prices_explain_pdf", "Prices Explainer PDF", downloads.prices_explain_pdf || artifacts.prices_explain_pdf);
  push("prices_explain_txt", "Prices Explainer TXT", downloads.prices_explain_txt || artifacts.prices_explain_txt);
  push("dashboard_json", "Dashboard JSON", downloads.dashboard_json || artifacts.dashboard_json);

  const images = items.filter((it) => it.kind === "png");
  const docs = items.filter((it) => it.kind !== "png");

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-4">
        <h1 className="font-display text-2xl text-zinc-100">Artifacts</h1>
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{upper} — downloads & raw outputs</p>
      </header>

      {images.length ? (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Plots</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {images.map((it) => (
              <a
                key={it.key}
                href={it.href}
                target="_blank"
                rel="noreferrer"
                className="group rounded-xl border border-white/10 bg-zinc-950/70 p-3 transition hover:border-emerald-400/50"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200">{it.label}</span>
                  <Download size={12} className="text-zinc-400 group-hover:text-emerald-300" />
                </div>
                <div className="relative h-40 w-full overflow-hidden rounded-lg border border-white/5 bg-black/30">
                  <Image
                    src={it.href}
                    alt={it.label}
                    fill
                    sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                    className="object-contain"
                    unoptimized
                  />
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Downloads</h2>
        {docs.length ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {docs.map((it) => {
              const Icon = KIND_ICON[it.kind];
              return (
                <li key={it.key}>
                  <a
                    href={it.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm transition hover:border-emerald-400/50 hover:bg-emerald-500/5"
                  >
                    <span className="flex items-center gap-2">
                      <Icon size={14} />
                      <span>{it.label}</span>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">{it.kind}</span>
                    </span>
                    <Download size={12} className="text-zinc-400" />
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No downloadable artifacts for this report.</p>
        )}
      </section>
    </div>
  );
}
