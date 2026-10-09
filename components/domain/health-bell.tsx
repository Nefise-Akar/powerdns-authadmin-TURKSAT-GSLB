"use client";

/**
 * components/domain/health-bell.tsx
 *
 * Top-bar notification bell for backend health advisories (ADR-0015). The
 * server passes the confirmed advisory set (already debounced + permission-
 * scoped); this renders the count badge + a dropdown. Acknowledging POSTs to
 * the ack route then refreshes so the list reflects the new state.
 *
 * Presentational only - no lib/db / lib/pdns imports (three-layer boundary).
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";
import { apiFetch } from "@/lib/client/api-fetch";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { buttonClass, iconButtonClass } from "@/components/ui/button";

export interface BellAdvisory {
  id: string;
  backendId: string;
  backendName: string;
  /** "error" | "warn" | "info". */
  severity: string;
  title: string;
  detail: string;
  acknowledged: boolean;
}

// Severity is a status, so it gets a status color - but always next to the
// advisory's title, never as the only signal.
function dotClass(severity: string): string {
  if (severity === "error") return "bg-destructive";
  if (severity === "warn") return "bg-warning";
  return "bg-info";
}

export function HealthBell({ advisories }: { advisories: BellAdvisory[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Live-update over the SSE bus (ADR-0015): the poller publishes `health.updated`
  // only when the visible advisory set moves, so we refresh the server-rendered
  // props in place rather than only on navigation. Debounced against a burst.
  const lastRefreshAt = useRef<number>(0);
  useRealtimeEvent(
    (event) => event.type === "health.updated",
    () => {
      const now = Date.now();
      if (now - lastRefreshAt.current < 500) return;
      lastRefreshAt.current = now;
      router.refresh();
    },
  );

  const unacked = advisories.filter((a) => !a.acknowledged);
  const count = unacked.length;

  async function acknowledge(id: string) {
    setBusy(id);
    try {
      const res = await apiFetch(`/api/admin/backend-advisories/${id}/ack`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Backend health, ${count} active ${count === 1 ? "issue" : "issues"}`}
        aria-expanded={open}
        className={iconButtonClass("lg", "relative")}
      >
        <Bell aria-hidden strokeWidth={1.75} />
        {count > 0 ? (
          // The count is in the button's name; the badge is decoration. The
          // 1.5px card-colored ring separates it from the bell glyph.
          <span
            aria-hidden
            className="bg-primary text-mono-meta text-primary-foreground ring-card absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-sm px-1 font-mono font-medium tabular-nums ring-[1.5px]"
          >
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* click-away catcher */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          {/* Mobile: fixed to the viewport with small gutters so the dropdown
              can't overflow the right edge (the bell sits near it). sm+: back
              to absolute-anchored under the bell at a fixed 24rem width. */}
          <div className="border-border bg-popover text-popover-foreground fixed inset-x-3 top-14 z-20 mt-1 overflow-hidden rounded-md border sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:w-96">
            <div className="border-border text-h3 border-b px-3 py-2">Backend health</div>
            {advisories.length === 0 ? (
              <p className="text-body text-muted-foreground px-3 py-6 text-center">
                All backends are healthy.
              </p>
            ) : (
              <ul className="divide-border max-h-[60vh] divide-y overflow-y-auto">
                {advisories.map((a) => (
                  <li key={a.id} className="text-body px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className={`mt-[7px] size-1.5 shrink-0 rounded-full ${dotClass(a.severity)}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={
                              a.acknowledged ? "text-muted-foreground" : "text-body-strong"
                            }
                          >
                            {a.title}
                          </span>
                          <Link
                            href={`/admin/servers/${a.backendId}`}
                            className="text-meta text-primary hover:text-primary-hover shrink-0 hover:underline"
                            onClick={() => setOpen(false)}
                          >
                            {a.backendName}
                          </Link>
                        </div>
                        <p className="text-body-sm text-muted-foreground mt-0.5">{a.detail}</p>
                        {!a.acknowledged ? (
                          <button
                            type="button"
                            onClick={() => acknowledge(a.id)}
                            disabled={busy === a.id}
                            aria-busy={busy === a.id}
                            className={buttonClass({ variant: "link", size: "xs" })}
                          >
                            Dismiss
                          </button>
                        ) : (
                          <span className="text-meta text-muted-foreground mt-1 inline-block">
                            Dismissed
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
