"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type BrandLogoProps = {
  size?: number;
  className?: string;
  alt?: string;
  priority?: boolean;
};

export function BrandLogo({
  size = 36,
  className = "",
  alt = "Hedge in a Box",
  priority = false,
}: BrandLogoProps) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const read = () =>
      document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    setTheme(read());
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const src = theme === "light" ? "/hedge-logo-light.png" : "/hedge-logo-dark.png";

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      className={`object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
