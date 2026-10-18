import type { ReactNode } from "react";
import { cn } from "./lib/utils.js";

/** bb has no flame glyph; app.tsx registers this one under this name for the menu, the sidebar flag and the tab. */
export const FLAME_ICON = "burn-flame";

/** The flame from assets/icon.svg, drawn in currentColor. */
export function FlameIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-burn-flame=""
      className={cn("size-3 shrink-0", className)}
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
