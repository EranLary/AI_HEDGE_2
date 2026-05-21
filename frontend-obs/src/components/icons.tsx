type IconProps = {
  size?: number;
  className?: string;
};

const COMMON = {
  fill: "none" as const,
  stroke: "currentColor" as const,
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ArrowLeftIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      {...COMMON}
    >
      <path d="M13 8H3" />
      <path d="M7 4 L3 8 L7 12" />
    </svg>
  );
}

export function LayoutVerticalIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      {...COMMON}
    >
      <rect x="5.5" y="1.5" width="5" height="3.5" rx="0.8" />
      <rect x="2.5" y="9" width="4" height="3.5" rx="0.8" />
      <rect x="9.5" y="9" width="4" height="3.5" rx="0.8" />
      <path d="M8 5 V7" />
      <path d="M4.5 9 V7.5 H11.5 V9" />
    </svg>
  );
}

export function LayoutHorizontalIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      {...COMMON}
    >
      <rect x="1.5" y="5.5" width="3.5" height="5" rx="0.8" />
      <rect x="9" y="2.5" width="3.5" height="4" rx="0.8" />
      <rect x="9" y="9.5" width="3.5" height="4" rx="0.8" />
      <path d="M5 8 H7" />
      <path d="M9 4.5 H7.5 V11.5 H9" />
    </svg>
  );
}

export function FitViewIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      {...COMMON}
    >
      <path d="M2 6 V2 H6" />
      <path d="M14 6 V2 H10" />
      <path d="M2 10 V14 H6" />
      <path d="M14 10 V14 H10" />
    </svg>
  );
}
