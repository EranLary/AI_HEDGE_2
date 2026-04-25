import Image from "next/image";

import { getPersonaTheme, personaInitials } from "./persona-themes";

const SKETCH_BY_PERSONA: Record<string, { src: string; alt: string }> = {
  "Warren Buffett": {
    src: "/personas/warren-buffett.png",
    alt: "Pencil sketch of Warren Buffett",
  },
};

export function PersonaAvatar({ name, size = 132 }: { name: string; size?: number }) {
  const theme = getPersonaTheme(name);
  const sketch = SKETCH_BY_PERSONA[name.trim()];

  if (sketch) {
    return (
      <div
        className="relative shrink-0 overflow-hidden rounded-full ring-1 ring-white/20"
        style={{
          width: size,
          height: size,
          background: "radial-gradient(circle at 35% 30%, #f5f1e8 0%, #e7dfcc 100%)",
          boxShadow: `0 14px 32px -16px ${theme.accentSoft}, inset 0 0 0 1px rgba(0,0,0,0.05)`,
        }}
      >
        <Image
          src={sketch.src}
          alt={sketch.alt}
          fill
          priority
          sizes={`${size}px`}
          className="relative object-cover"
          style={{ objectPosition: "center 38%" }}
        />
      </div>
    );
  }

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full ring-1 ring-white/10"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 30% 25%, #18181b 0%, #09090b 80%)",
        boxShadow: `0 18px 40px -18px ${theme.accentSoft}, inset 0 0 0 1px rgba(255,255,255,0.04)`,
      }}
    >
      <span
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(circle at 70% 80%, ${theme.accentSoft} 0%, transparent 60%)` }}
        aria-hidden
      />
      <span
        className="absolute inset-0 flex items-center justify-center font-display tracking-tight"
        style={{
          color: theme.accent,
          fontSize: size * 0.42,
          textShadow: `0 2px 12px ${theme.accentSoft}`,
        }}
      >
        {personaInitials(name)}
      </span>
    </div>
  );
}
