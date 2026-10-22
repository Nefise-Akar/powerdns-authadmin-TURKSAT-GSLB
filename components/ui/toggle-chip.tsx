"use client";

/**
 * components/ui/toggle-chip.tsx
 *
 * A filter toggle for a status strip: a chip with a coloured dot, a label and
 * a count. `aria-pressed` carries the state, so a chip is a toggle button to
 * assistive tech, not a tab or a link. Used by the Reverse DNS and Zone
 * Monitoring pages to filter their tables by verdict and horizon.
 *
 * The contract both pages agreed on: active = filled with the status colour
 * behind a strong border, inactive = outlined and dimmed, both with a hover
 * state and a focus ring; the dot keeps its colour in both states so an
 * unselected OK still reads as green, and the count stays in the running text
 * colour so it never drops below readable contrast.
 */

import type { ReactNode } from "react";
import { Skeleton } from "./skeleton";

export type ToggleChipTone = "error" | "warn" | "success" | "muted" | "accent";

// Turksat tokens only: the status fills are the design system's muted
// surfaces (no derived tints), the selected neutral/accent chips use the
// selection token. Corners are the 4px `rounded-md`, never pill-shaped.
const TOGGLE_CHIP_BASE =
  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-label focus-visible:shadow-focus-ring focus-visible:outline-hidden";

const TOGGLE_CHIP_ACTIVE: Record<ToggleChipTone, string> = {
  error: "border-destructive bg-destructive-muted text-foreground",
  warn: "border-warning-border bg-warning-muted text-foreground",
  success: "border-success bg-accent text-foreground",
  muted: "border-input bg-muted text-foreground",
  accent: "border-primary bg-accent text-accent-foreground",
};

const TOGGLE_CHIP_INACTIVE =
  "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground";

const CHIP_DOT_CLASS: Record<ToggleChipTone, string> = {
  error: "bg-destructive",
  warn: "bg-warning",
  success: "bg-success",
  muted: "bg-muted-foreground",
  accent: "bg-primary",
};

interface ToggleChipProps {
  active: boolean;
  tone: ToggleChipTone;
  /** Tooltip explaining what the chip filters on. */
  title: string;
  onClick: () => void;
  /** Null while the count is still loading: a skeleton holds the space. */
  count: number | null;
  children: ReactNode;
}

export function ToggleChip({ active, tone, title, onClick, count, children }: ToggleChipProps) {
  // An empty bucket has nothing to call attention to: it renders neutral
  // whatever its tone or state, so only the chips with something in them light up.
  // A count still loading is treated the same, so a chip never flashes its
  // colour and then goes grey once its count turns out to be 0.
  const empty = count === 0 || count === null;
  const lit = active && !empty;
  const dotTone: ToggleChipTone = empty ? "muted" : tone;
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`${TOGGLE_CHIP_BASE} ${lit ? TOGGLE_CHIP_ACTIVE[tone] : TOGGLE_CHIP_INACTIVE}`}
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${CHIP_DOT_CLASS[dotTone]} ${lit ? "" : "opacity-60"}`}
      />
      {children}
      {count === null ? (
        <Skeleton className="h-3 w-4" label="Counting…" />
      ) : (
        <span className="font-mono tabular-nums">{count}</span>
      )}
    </button>
  );
}
