"use client";

import { useEffect } from "react";

export function ThemeInit() {
  useEffect(() => {
    const saved = localStorage.getItem("hib-theme");
    const next = saved === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
  }, []);

  return null;
}

