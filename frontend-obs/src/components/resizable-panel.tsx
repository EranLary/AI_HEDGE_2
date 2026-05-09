"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "obs.callPanel.width";
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_WIDTH_VW = 0.8;

function readSavedWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_WIDTH;
  const n = Number(raw);
  if (!isFinite(n) || n < MIN_WIDTH) return DEFAULT_WIDTH;
  return n;
}

export function ResizablePanel({
  closeHref,
  title,
  children,
}: {
  closeHref: string;
  title: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState(false);
  const draggingRef = useRef(false);

  useEffect(() => {
    setHydrated(true);
    setWidth(readSavedWidth());
    const mq = window.matchMedia("(max-width: 720px)");
    const onMq = () => setIsMobile(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isMobile) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [isMobile]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const next = Math.max(
        MIN_WIDTH,
        Math.min(window.innerWidth * MAX_WIDTH_VW, window.innerWidth - e.clientX),
      );
      setWidth(next);
    },
    [],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(width));
    }
  }, [width]);

  const onClose = useCallback(() => {
    router.replace(closeHref, { scroll: false });
  }, [router, closeHref]);

  // Lock body scroll on mobile while open.
  useEffect(() => {
    if (!isMobile || !hydrated) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobile, hydrated]);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const asideStyle: CSSProperties = isMobile
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        top: "auto",
        maxHeight: "85vh",
        height: "85vh",
        width: "100%",
        borderRadius: "14px 14px 0 0",
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-background)",
        display: "flex",
        flexDirection: "column",
        zIndex: 40,
        boxShadow: "0 -12px 40px rgba(0,0,0,0.4)",
      }
    : {
        flex: `0 0 ${width}px`,
        width,
        position: "sticky",
        top: 16,
        alignSelf: "flex-start",
        maxHeight: "calc(100vh - 32px)",
        background: "var(--color-card-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      };

  return (
    <>
      {isMobile && (
        <div
          aria-hidden
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 39,
          }}
        />
      )}
      <aside style={asideStyle} aria-label="Call detail">
        {!isMobile && (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            style={{
              position: "absolute",
              top: 0,
              left: -3,
              bottom: 0,
              width: 6,
              cursor: "col-resize",
              touchAction: "none",
              zIndex: 1,
            }}
          />
        )}
        {isMobile && (
          <div
            aria-hidden
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "8px 0 4px",
            }}
          >
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: "var(--color-border)",
              }}
            />
          </div>
        )}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderBottom: "1px solid var(--color-border)",
            flex: "0 0 auto",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="btn-ghost btn-ghost--icon"
            style={{ fontSize: 14, lineHeight: 1, padding: "4px 8px" }}
          >
            ×
          </button>
        </header>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            padding: 14,
            minWidth: 0,
          }}
        >
          {children}
        </div>
      </aside>
    </>
  );
}
