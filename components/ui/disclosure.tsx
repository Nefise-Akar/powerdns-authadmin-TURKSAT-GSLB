"use client";

/**
 * Disclosure - the one collapsible "summary" affordance used across the app
 * (audit-log before/after diffs, the PowerDNS HTTP-request logs, …) so every
 * expand/collapse reads the same: a right/down chevron, a link-colored label,
 * and an optional trailing accessory (e.g. a "N failed" badge).
 *
 * Built on native `<details>` so it works without JS, but we mirror `open` into
 * React state to flip the marker. Callers control padding + font-size via the
 * `summaryClassName` / `bodyClassName` slots; the shared look lives here.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

interface DisclosureProps {
  /** The clickable summary label. */
  label: ReactNode;
  /** Optional content shown after the label on the summary line (badges, counts). */
  accessory?: ReactNode;
  /** Revealed when open. */
  children: ReactNode;
  /** Extra classes on the `<details>` wrapper. */
  className?: string;
  /** Extra classes on the clickable `<summary>` line. */
  summaryClassName?: string;
  /** Extra classes on the revealed body wrapper. */
  bodyClassName?: string;
  defaultOpen?: boolean;
}

export function Disclosure({
  label,
  accessory,
  children,
  className,
  summaryClassName,
  bodyClassName,
  defaultOpen = false,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className={className}>
      <summary
        className={[
          "text-primary hover:text-primary-hover flex cursor-pointer list-none items-center gap-1.5 hover:underline",
          summaryClassName ?? "",
        ].join(" ")}
      >
        {open ? (
          <ChevronDown aria-hidden size={14} strokeWidth={2} className="shrink-0" />
        ) : (
          <ChevronRight aria-hidden size={14} strokeWidth={2} className="shrink-0" />
        )}
        <span>{label}</span>
        {accessory}
      </summary>
      <div className={bodyClassName}>{children}</div>
    </details>
  );
}
