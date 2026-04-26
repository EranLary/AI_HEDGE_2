"use client";

import { useEffect, useState } from "react";

/*
 * Read CSS custom properties (theme tokens) from <html> and re-evaluate when
 * `data-theme` flips. Keeps non-CSS contexts (Recharts props, canvas draws,
 * inline style strings that need a literal color) in sync with the active theme.
 *
 * Tokens are documented in frontend/BRAND_COLORS.md. Pass full names like
 * "--chart-grid"; the hook returns trimmed hex/rgb/rgba strings.
 */
export function useThemeTokens<K extends string>(names: readonly K[]): Record<K, string> {
  const read = (): Record<K, string> => {
    if (typeof window === "undefined") {
      return Object.fromEntries(names.map((n) => [n, ""])) as Record<K, string>;
    }
    const styles = getComputedStyle(document.documentElement);
    const out = {} as Record<K, string>;
    for (const name of names) {
      out[name] = styles.getPropertyValue(name).trim();
    }
    return out;
  };

  const [values, setValues] = useState<Record<K, string>>(() => read());

  useEffect(() => {
    setValues(read());
    const target = document.documentElement;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          setValues(read());
          return;
        }
      }
    });
    observer.observe(target, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join("|")]);

  return values;
}
