"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type View = "hierarchy" | "flow";

export function RunTabs({ activeView }: { activeView: View }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(view: View) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (view === "hierarchy") params.delete("view");
    else params.set("view", view);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        background: "var(--color-card-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: 999,
        marginBottom: 16,
      }}
    >
      <TabButton active={activeView === "hierarchy"} onClick={() => go("hierarchy")}>
        Hierarchy
      </TabButton>
      <TabButton active={activeView === "flow"} onClick={() => go("flow")}>
        Flow
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        background: active ? "var(--color-accent)" : "transparent",
        color: active ? "#0b1220" : "var(--color-foreground)",
        border: "none",
        borderRadius: 999,
        padding: "5px 14px",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        opacity: active ? 1 : 0.75,
      }}
    >
      {children}
    </button>
  );
}
