/**
 * components/ui/alert.tsx
 *
 * Section/page-level notice, per the Turksat design system. Text runs in a
 * fixed order: the colored prefix ("Warning:" / "Error:") with a short
 * lowercase status, then the facts and what to do, then (optionally) one
 * action link named after the action.
 *
 *   <Alert title="raw mode" action={<a href=…>Read the guide</a>}>…</Alert>
 *
 * A notice that arrives with the page is `role="note"` (not a live region);
 * pass `live` only for one inserted after a user action, so screen readers
 * announce it.
 */

import { CircleX, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

const TONE = {
  warning: {
    box: "border-warning-border bg-warning-muted",
    accent: "text-warning",
    prefix: "Warning:",
    Icon: TriangleAlert,
  },
  destructive: {
    box: "border-destructive bg-destructive-muted",
    accent: "text-destructive",
    prefix: "Error:",
    Icon: CircleX,
  },
} as const;

export function Alert({
  variant = "warning",
  title,
  children,
  action,
  live = false,
  className = "",
}: {
  variant?: keyof typeof TONE;
  /** Lowercase status after the prefix, e.g. "raw mode". Without one, the
   *  prefix leads the body text on a single line. */
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  live?: boolean;
  className?: string;
}) {
  const tone = TONE[variant];
  const prefix = <span className={`text-body-strong ${tone.accent}`}>{tone.prefix}</span>;
  return (
    <div
      role={live ? "alert" : "note"}
      className={`text-foreground flex gap-2 rounded-md border px-4 py-3 ${tone.box} ${className}`.trim()}
    >
      <tone.Icon
        aria-hidden
        size={16}
        strokeWidth={2}
        className={`mt-0.5 shrink-0 ${tone.accent}`}
      />
      <div className="flex min-w-0 flex-col gap-1">
        {title ? (
          <>
            <p className="text-body-strong">
              {prefix} {title}
            </p>
            {children ? <div className="text-body-sm">{children}</div> : null}
          </>
        ) : (
          <p className="text-body-sm">
            {prefix} {children}
          </p>
        )}
        {action ? (
          <div className="text-body-sm [&_a]:text-primary [&_a:hover]:text-primary-hover [&_a]:underline">
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}
