/**
 * components/ui/badge.tsx
 *
 * Small inline markers, per the Liman design system. All are 20px tall with
 * 2px corners - never pill-shaped.
 *
 *   Tag         - a category or role value (`primary`, `internal`, `lua`).
 *                 Categories are never colored: every tag uses the tag
 *                 tokens, mono, written as the value itself (not uppercased).
 *                 Inside a selected row pass `surface="card"` so it still
 *                 stands off the accent background.
 *   CountBadge  - the number next to a tab label; `active` on the current tab.
 *   Kbd         - a key name. Takes the inverse of the surface it sits on.
 */

import type { HTMLAttributes, ReactNode } from "react";

export function Tag({
  children,
  surface = "muted",
  className = "",
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { surface?: "muted" | "card"; children: ReactNode }) {
  const bg = surface === "card" ? "bg-card" : "bg-tag";
  return (
    <span
      className={`text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 align-middle font-mono whitespace-nowrap ${bg} ${className}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}

export function CountBadge({
  count,
  active = false,
  className = "",
}: {
  count: number;
  active?: boolean;
  className?: string;
}) {
  const tone = active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground";
  return (
    <span
      className={`text-mono-xs inline-flex h-5 items-center rounded-sm px-1.5 font-mono font-medium tabular-nums ${tone} ${className}`.trim()}
    >
      {count}
    </span>
  );
}

export function Kbd({
  children,
  surface = "card",
  className = "",
}: {
  children: ReactNode;
  /** The surface the key sits ON: card → muted key, muted/background → card key. */
  surface?: "card" | "muted" | "background";
  className?: string;
}) {
  const bg = surface === "card" ? "bg-muted" : "bg-card";
  return (
    <kbd
      className={`text-mono-xs text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 font-mono ${bg} ${className}`.trim()}
    >
      {children}
    </kbd>
  );
}
