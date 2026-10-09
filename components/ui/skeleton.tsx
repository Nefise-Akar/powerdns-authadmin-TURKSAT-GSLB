/**
 * components/ui/skeleton.tsx
 *
 * Primitive placeholder shapes for loading states. Blocks are static `muted`
 * fills with 2px corners - no shimmer gradient (it would invent in-between
 * tones) and never `accent`, which means "selected". Placeholders keep the
 * real layout, so tables use 36px rows.
 *
 * Use in two ways:
 *
 *   1. As `loading.tsx` siblings of slow pages - Next.js automatically
 *      shows them while the server component resolves. See
 *      `app/(app)/zones/loading.tsx` etc.
 *
 *   2. Inline inside a page when a section streams in after the rest of
 *      the page is ready.
 *
 * Shape components mirror the most common patterns in the app: text lines,
 * tables, KPI cards, and chart bodies. New shapes belong here, not
 * sprinkled across feature folders.
 */

import type { CSSProperties } from "react";

interface BaseProps {
  className?: string;
  style?: CSSProperties;
  /** Accessible label; falls back to "Loading…". */
  label?: string;
}

/**
 * Solid placeholder box. Sizes itself from `style.width` / `style.height` or
 * the className you pass (e.g. `h-4 w-24`).
 */
export function Skeleton({ className = "", style, label = "Loading…" }: BaseProps) {
  return (
    <span
      role="status"
      aria-label={label}
      aria-busy
      className={`bg-muted inline-block rounded-sm ${className}`}
      style={style}
    />
  );
}

/** N stacked lines of skeleton text. */
export function SkeletonLines({
  count = 3,
  className = "",
  lineClassName = "h-3 w-full",
}: {
  count?: number;
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: count }).map((_, idx) => (
        <Skeleton
          key={idx}
          className={lineClassName}
          // Last line slightly shorter for a more natural look.
          style={idx === count - 1 ? { width: "70%" } : undefined}
        />
      ))}
    </div>
  );
}

/** Card frame with a label + value placeholder - matches the dashboard KPI card. */
export function SkeletonKpi() {
  return (
    <div className="border-border bg-card rounded-md border p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  );
}

/** A whole table placeholder: header row + N body rows of M cells. */
export function SkeletonTable({
  rows = 5,
  cols = 4,
  className = "",
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={`border-border overflow-hidden border-t ${className}`}>
      <div
        className="border-border bg-background grid h-9 items-center gap-3 border-b px-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols }).map((_, idx) => (
          <Skeleton key={idx} className="h-3 w-16" />
        ))}
      </div>
      <div className="divide-border divide-y">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="grid h-9 items-center gap-3 px-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: cols }).map((_, colIdx) => (
              <Skeleton
                key={colIdx}
                className="h-4"
                style={{ width: colIdx === 0 ? "60%" : "85%" }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Block matching the chart-card frame on the dashboard. */
export function SkeletonChart({ height = 260 }: { height?: number }) {
  return (
    <div className="border-border bg-card rounded-md border p-4">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-1 h-3 w-48" />
      <Skeleton className="mt-3 block w-full" style={{ height }} />
    </div>
  );
}
