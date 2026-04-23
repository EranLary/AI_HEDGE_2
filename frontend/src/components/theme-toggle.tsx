"use client";

import { Sun } from "lucide-react";

type ThemeToggleProps = {
  className?: string;
};

export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const toggleTheme = () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("hib-theme", next);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light mode"
      className={`rounded-lg border border-white/20 bg-white/5 px-3 py-2 ${className}`}
    >
      <Sun size={14} />
    </button>
  );
}

