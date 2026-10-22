"use client";

/**
 * components/domain/health-bell.tsx
 *
 * Top-bar notification bell (ADR-0015): backend health and zone monitoring.
 * The server passes a short preview (the most pressing few, already filtered
 * to what this user may see) and the counts, not the whole list, so a fleet
 * with hundreds of findings costs every page render nothing extra. "Show all"
 * opens the Notifications page. Dismissing POSTs to the dismiss route, which
 * re-checks visibility, then refreshes in place.
 *
 * Presentational only - no lib/db / lib/pdns imports (three-layer boundary).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Bell, CheckCircle2 } from "lucide-react";
import type { AppNotification, NotificationSummary } from "@/lib/health/notifications";
import { apiFetch } from "@/lib/client/api-fetch";
import { useDialog } from "@/components/ui/dialog";
import { LocalTime } from "@/components/ui/local-time";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import {
  badgeCount,
  bellLabel,
  severityDotClass,
  severityWord,
  summaryLine,
} from "@/components/domain/notification-format";

export function HealthBell({
  preview,
  summary,
}: {
  preview: AppNotification[];
  summary: NotificationSummary;
}) {
  const router = useRouter();
  const { toast } = useDialog();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The poller publishes `health.updated` only when the visible set moves;
  // refresh the server-rendered props in place. Debounced against a burst.
  const lastRefreshAt = useRef<number>(0);
  useRealtimeEvent(
    (event) => event.type === "health.updated" || event.type === "realtime.reconnected",
    () => {
      const now = Date.now();
      if (now - lastRefreshAt.current < 500) return;
      lastRefreshAt.current = now;
      router.refresh();
    },
  );

  // Click outside closes; Escape closes and hands focus back to the bell so a
  // keyboard user isn't dropped at the top of the document.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      bellRef.current?.focus();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const count = summary.active;
  const total = summary.active + summary.dismissed;
  const summaryText = summaryLine(summary);

  async function dismiss(n: AppNotification) {
    setBusy(n.id);
    try {
      const res = await apiFetch(`/api/admin/backend-advisories/${n.id}/ack`, { method: "POST" });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast({
        kind: "error",
        title: "Could not dismiss the notification",
        description: data?.error ?? `The server answered ${res.status}.`,
      });
    } catch {
      toast({
        kind: "error",
        title: "Could not dismiss the notification",
        description: "Network error - it is still active.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={bellLabel(summary)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={iconButtonClass("lg", "relative")}
      >
        <Bell aria-hidden strokeWidth={1.75} />
        {count > 0 ? (
          // The count is in the button's name; the badge is decoration. The
          // 1.5px card-colored ring separates it from the bell glyph.
          <span
            aria-hidden
            className={`text-mono-meta ring-card absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-sm px-1 font-mono font-medium tabular-nums ring-[1.5px] ${
              summary.error > 0
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {badgeCount(count)}
          </span>
        ) : null}
      </button>

      {open ? (
        // Mobile: pinned to the viewport with small gutters (the bell sits near
        // the right edge). sm+: anchored under the bell, wider again on lg.
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          className="border-border bg-popover text-popover-foreground fixed inset-x-3 top-14 z-20 mt-1 overflow-hidden rounded-md border outline-none sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:w-[26rem] lg:w-[30rem]"
        >
          <div className="border-border flex items-center justify-between gap-3 border-b px-3 py-2">
            <div className="min-w-0">
              <p className="text-h3">Notifications</p>
              <p className="text-meta text-muted-foreground truncate">
                {summaryText || "Nothing needs attention"}
              </p>
            </div>
            {total > 0 ? (
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-meta text-primary hover:text-primary-hover shrink-0 hover:underline"
              >
                View all
              </Link>
            ) : null}
          </div>

          {preview.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
              <CheckCircle2 aria-hidden strokeWidth={1.75} className="text-success size-5" />
              <p className="text-body-medium">You&apos;re all caught up</p>
              {summary.dismissed > 0 ? (
                <p className="text-meta text-muted-foreground">{summary.dismissed} dismissed</p>
              ) : null}
            </div>
          ) : (
            <ul className="divide-border max-h-[60vh] divide-y overflow-y-auto">
              {preview.map((n) => (
                <li key={n.id} className="text-body px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={`mt-[7px] size-1.5 shrink-0 rounded-full ${severityDotClass(n.severity)}`}
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={n.href}
                        onClick={() => setOpen(false)}
                        className="text-body-strong line-clamp-2 break-words hover:underline"
                      >
                        <span className="sr-only">{severityWord(n.severity)}: </span>
                        {n.title}
                      </Link>
                      <p className="text-body-sm text-muted-foreground mt-0.5 line-clamp-2 break-words">
                        {n.detail}
                      </p>
                      <div className="text-meta text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>{n.source === "zone" ? "Zone monitoring" : "Backend health"}</span>
                        <span className="font-mono">{n.backendName}</span>
                        <LocalTime ts={n.lastSeenAt} style="relative" />
                        <button
                          type="button"
                          onClick={() => void dismiss(n)}
                          disabled={busy === n.id}
                          aria-busy={busy === n.id}
                          className={buttonClass({
                            variant: "link",
                            size: "xs",
                            className: "ml-auto",
                          })}
                        >
                          {busy === n.id ? "Dismissing…" : "Dismiss"}
                          <span className="sr-only"> {n.title}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {total > 0 ? (
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="border-border text-body-medium text-primary hover:bg-muted focus-visible:shadow-focus-ring flex items-center justify-center gap-1.5 border-t px-3 py-2 focus-visible:outline-hidden"
            >
              Show all {total} notification{total === 1 ? "" : "s"}
              <ArrowRight aria-hidden strokeWidth={1.75} className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
