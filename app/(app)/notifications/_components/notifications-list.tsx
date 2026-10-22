"use client";

/**
 * The Notifications page body: filter chips, a searchable table with one
 * chevron accordion for the detail, and dismissal per row or for everything
 * currently shown. Data arrives as server props and is refreshed in place on
 * `health.updated` (and after a realtime reconnect), so filters, search and
 * the open row survive every update.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { AppNotification, NotificationSeverity } from "@/lib/health/notifications";
import { apiFetch } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { useDialog } from "@/components/ui/dialog";
import { LocalTime } from "@/components/ui/local-time";
import {
  DisclosureChevron,
  RowDisclosurePanel,
  rowDetailId,
  useRowDisclosure,
} from "@/components/ui/row-disclosure";
import { ToggleChip, type ToggleChipTone } from "@/components/ui/toggle-chip";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { severityDotClass, severityWord } from "@/components/domain/notification-format";

type StatusFilter = "active" | "dismissed" | "all";
type SourceFilter = "backend" | "zone";

const SEVERITIES: ReadonlyArray<{
  key: NotificationSeverity;
  label: string;
  tone: ToggleChipTone;
}> = [
  { key: "error", label: "Errors", tone: "error" },
  { key: "warn", label: "Warnings", tone: "warn" },
  { key: "info", label: "Notices", tone: "muted" },
];

const SOURCES: ReadonlyArray<{ key: SourceFilter; label: string }> = [
  { key: "backend", label: "Backend health" },
  { key: "zone", label: "Zone monitoring" },
];

const STATUSES: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "active", label: "Active" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
];

const PANEL_PREFIX = "notification";
const SEVERITY_RANK: Record<NotificationSeverity, number> = { error: 0, warn: 1, info: 2 };

function sourceLabel(n: AppNotification): string {
  return n.source === "zone" ? "Zone monitoring" : "Backend health";
}

function zoneHref(n: AppNotification): string | null {
  if (!n.zone) return null;
  return `/zones/${encodeURIComponent(n.zone)}?server=${encodeURIComponent(n.backendSlug)}`;
}

export function NotificationsList({ notifications }: { notifications: AppNotification[] }) {
  const router = useRouter();
  const { confirm, toast } = useDialog();
  const details = useRowDisclosure();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [severities, setSeverities] = useState<ReadonlySet<NotificationSeverity>>(new Set());
  const [sources, setSources] = useState<ReadonlySet<SourceFilter>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const lastRefreshAt = useRef(0);
  useRealtimeEvent(
    (event) => event.type === "health.updated" || event.type === "realtime.reconnected",
    () => {
      const now = Date.now();
      if (now - lastRefreshAt.current < 500) return;
      lastRefreshAt.current = now;
      router.refresh();
    },
  );

  const byStatus = useMemo(
    () =>
      notifications.filter((n) =>
        status === "all" ? true : status === "active" ? !n.acknowledged : n.acknowledged,
      ),
    [notifications, status],
  );

  // Chip counts follow the other filters, so each chip says what clicking it would show.
  const severityCounts = useMemo(() => {
    const c: Record<NotificationSeverity, number> = { error: 0, warn: 0, info: 0 };
    for (const n of byStatus) if (sources.size === 0 || sources.has(n.source)) c[n.severity]++;
    return c;
  }, [byStatus, sources]);
  const sourceCounts = useMemo(() => {
    const c: Record<SourceFilter, number> = { backend: 0, zone: 0 };
    for (const n of byStatus)
      if (severities.size === 0 || severities.has(n.severity)) c[n.source]++;
    return c;
  }, [byStatus, severities]);
  const statusCounts = useMemo(() => {
    const dismissed = notifications.filter((n) => n.acknowledged).length;
    return { active: notifications.length - dismissed, dismissed, all: notifications.length };
  }, [notifications]);

  const rows = useMemo(
    () =>
      byStatus.filter(
        (n) =>
          (severities.size === 0 || severities.has(n.severity)) &&
          (sources.size === 0 || sources.has(n.source)),
      ),
    [byStatus, severities, sources],
  );
  const dismissableShown = rows.filter((n) => !n.acknowledged);

  function toggle<T>(set: ReadonlySet<T>, key: T): Set<T> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  async function dismiss(ids: string[], label: string) {
    setBusy(ids.length === 1 ? ids[0]! : "bulk");
    try {
      const res = await apiFetch("/api/admin/notifications/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => null)) as {
        dismissed?: string[];
        error?: string;
      } | null;
      if (!res.ok) {
        toast({
          kind: "error",
          title: `Could not dismiss ${label}`,
          description: data?.error ?? `The server answered ${res.status}.`,
        });
        return;
      }
      const n = data?.dismissed?.length ?? 0;
      if (ids.length > 1) {
        toast({
          kind: "success",
          title: `Dismissed ${n} notification${n === 1 ? "" : "s"}`,
          description: "They return if their condition changes or comes back.",
        });
      }
      router.refresh();
    } catch {
      toast({
        kind: "error",
        title: `Could not dismiss ${label}`,
        description: "Network error - nothing was changed.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function dismissShown() {
    const ids = dismissableShown.map((n) => n.id);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Dismiss ${ids.length} notification${ids.length === 1 ? "" : "s"}?`,
      description:
        "They leave the bell and this list's Active view. Any that change or come back after clearing will notify again.",
      confirmLabel: "Dismiss",
    });
    if (ok) await dismiss(ids, "the notifications");
  }

  const columns = useMemo<Array<ColumnDef<AppNotification, unknown>>>(
    () => [
      {
        id: "notification",
        accessorFn: (n) => `${n.title} ${n.detail} ${n.zone ?? ""} ${n.backendName}`,
        header: "Notification",
        sortingFn: (a, b) =>
          SEVERITY_RANK[a.original.severity] - SEVERITY_RANK[b.original.severity] ||
          a.original.title.localeCompare(b.original.title),
        meta: { className: "md:w-[55%]" },
        cell: ({ row }) => {
          const n = row.original;
          return (
            <span className="flex min-w-0 items-start gap-2">
              <DisclosureChevron
                open={details.isOpen(n.id)}
                onToggle={() => details.toggle(n.id)}
                label={n.title}
                controls={rowDetailId(PANEL_PREFIX, n.id)}
              />
              <span
                aria-hidden
                className={`mt-2 h-2 w-2 shrink-0 rounded-full ${severityDotClass(n.severity)}`}
              />
              <span className="min-w-0">
                <Link
                  href={n.href}
                  className={`text-body-medium break-words hover:underline ${n.acknowledged ? "text-muted-foreground" : ""}`}
                >
                  <span className="sr-only">{severityWord(n.severity)}: </span>
                  {n.title}
                </Link>
                <span className="text-muted-foreground text-meta mt-0.5 line-clamp-1 block break-words">
                  {n.detail}
                </span>
              </span>
            </span>
          );
        },
      },
      {
        id: "source",
        accessorFn: (n) => `${sourceLabel(n)} ${n.backendName}`,
        header: "Source",
        cell: ({ row }) => (
          <span className="text-xs">
            <span className="block">{sourceLabel(row.original)}</span>
            <span className="text-muted-foreground text-mono-xs block font-mono">
              {row.original.backendName}
            </span>
          </span>
        ),
      },
      {
        id: "lastSeen",
        accessorFn: (n) => n.lastSeenAt,
        header: "Last seen",
        cell: ({ row }) => (
          <LocalTime ts={row.original.lastSeenAt} style="relative" className="text-xs" />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { className: "text-right" },
        cell: ({ row }) => {
          const n = row.original;
          if (n.acknowledged) {
            return <span className="text-muted-foreground text-meta">Dismissed</span>;
          }
          return (
            <button
              type="button"
              onClick={() => void dismiss([n.id], "the notification")}
              disabled={busy !== null}
              className={buttonClass({ size: "sm" })}
            >
              {busy === n.id ? "Dismissing…" : "Dismiss"}
              <span className="sr-only"> {n.title}</span>
            </button>
          );
        },
      },
    ],
    // `dismiss` closes over state that `busy` already tracks for re-rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [details, busy],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Status"
            className="border-border inline-flex overflow-hidden rounded-md border"
          >
            {STATUSES.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={status === s.key}
                onClick={() => setStatus(s.key)}
                className={`text-label h-7 px-3 ${
                  status === s.key
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {s.label} <span className="tabular-nums">{statusCounts[s.key]}</span>
              </button>
            ))}
          </div>
          <span aria-hidden className="bg-border hidden h-5 w-px sm:block" />
          <div role="group" aria-label="Severity" className="flex flex-wrap gap-2">
            {SEVERITIES.map((s) => (
              <ToggleChip
                key={s.key}
                active={severities.has(s.key)}
                tone={s.tone}
                title={`Show only ${s.label.toLowerCase()}`}
                count={severityCounts[s.key]}
                onClick={() => setSeverities((cur) => toggle(cur, s.key))}
              >
                {s.label}
              </ToggleChip>
            ))}
          </div>
          <div role="group" aria-label="Source" className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <ToggleChip
                key={s.key}
                active={sources.has(s.key)}
                tone="accent"
                title={`Show only ${s.label.toLowerCase()}`}
                count={sourceCounts[s.key]}
                onClick={() => setSources((cur) => toggle(cur, s.key))}
              >
                {s.label}
              </ToggleChip>
            ))}
          </div>
        </div>
        {dismissableShown.length > 0 ? (
          <button
            type="button"
            onClick={() => void dismissShown()}
            disabled={busy !== null}
            className={buttonClass({ className: "self-start lg:self-auto" })}
          >
            {busy === "bulk" ? "Dismissing…" : `Dismiss ${dismissableShown.length} shown`}
          </button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search notifications…"
        pageSize={25}
        initialSort={[{ id: "lastSeen", desc: true }]}
        stateKey="notifications"
        noDataMessage={
          notifications.length === 0
            ? "Nothing to report. Backend health and zone monitoring are clear."
            : status === "active" && statusCounts.active === 0
              ? "You're all caught up."
              : "No notifications match the selected filters."
        }
        renderRowDetail={(n) =>
          details.isOpen(n.id) ? (
            <RowDisclosurePanel
              id={rowDetailId(PANEL_PREFIX, n.id)}
              label={`Details for ${n.title}`}
            >
              <NotificationDetail n={n} />
            </RowDisclosurePanel>
          ) : null
        }
      />
    </div>
  );
}

function NotificationDetail({ n }: { n: AppNotification }) {
  const zone = zoneHref(n);
  return (
    <div className="grid gap-4 pt-3 text-sm lg:grid-cols-3">
      <p className="break-words whitespace-pre-line lg:col-span-2">{n.detail}</p>
      <dl className="text-meta grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Severity</dt>
        <dd>{severityWord(n.severity)}</dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd>{sourceLabel(n)}</dd>
        <dt className="text-muted-foreground">Backend</dt>
        <dd className="text-mono-xs font-mono break-all">{n.backendName}</dd>
        {n.zone ? (
          <>
            <dt className="text-muted-foreground">Zone</dt>
            <dd className="text-mono-xs font-mono break-all">
              {zone ? (
                <Link href={zone} className="text-primary hover:text-primary-hover hover:underline">
                  {n.zone}
                </Link>
              ) : (
                n.zone
              )}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">First seen</dt>
        <dd>
          <LocalTime ts={n.firstSeenAt} />
        </dd>
        <dt className="text-muted-foreground">Last seen</dt>
        <dd>
          <LocalTime ts={n.lastSeenAt} />
        </dd>
      </dl>
      <div className="lg:col-span-3">
        <Link
          href={n.href}
          className="text-primary hover:text-primary-hover text-sm hover:underline"
        >
          {n.source === "zone" ? "Open Zone Monitoring" : "Open the backend"}
        </Link>
      </div>
    </div>
  );
}
