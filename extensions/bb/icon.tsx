import type { ReactNode } from "react";
import { cn } from "./lib/utils.js";

/** bb has no flame glyph; app.tsx registers this one under this name for the menu, the sidebar flag and the tab. */
export const FLAME_ICON = "burn-flame";

function Glyph({ className, children, ...rest }: { className?: string; children: ReactNode; strokeWidth?: number; "data-burn-flame"?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={rest.strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-burn-flame={rest["data-burn-flame"]}
      className={cn("size-3 shrink-0", className)}
    >
      {children}
    </svg>
  );
}

/** The flame from assets/icon.svg, drawn in currentColor. */
export function FlameIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className} strokeWidth={2.2} data-burn-flame="">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </Glyph>
  );
}

// Lucide's panel-right, gauge, copy and check (ISC licence), so the bundle needs no icon set.
export function PanelIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </Glyph>
  );
}

export function GaugeIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </Glyph>
  );
}

export function CopyIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Glyph>
  );
}

export function CheckIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  );
}

// After Lucide's sliders-horizontal and eye-off, as the approved Burn page mock draws them.
export function SlidersIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </Glyph>
  );
}

export function EyeOffIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20" />
    </Glyph>
  );
}

// After Lucide's calendar, chevron-left, chevron-right and chevron-down, for the Burn page's days.
export function CalendarIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Glyph>
  );
}

export function ChevronLeftIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <path d="m15 18-6-6 6-6" />
    </Glyph>
  );
}

export function ChevronRightIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <path d="m9 18 6-6-6-6" />
    </Glyph>
  );
}

export function ChevronDownIcon({ className }: { className?: string }): ReactNode {
  return (
    <Glyph className={className}>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  );
}
