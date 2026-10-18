"use client";

/**
 * app/(app)/admin/gslb/_components/gslb-backends-table.tsx
 *
 * PowerGSLB backend list on the shared <DataTable> (reflows to cards under
 * `md`). The page hands over fully serializable rows - failure hints are
 * resolved server-side because `lib/gslb` is server-only.
 */

import { useMemo } from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { Tag } from "@/components/ui/badge";
import { freshnessOf } from "@/lib/freshness";
import { describeCounts, TestGslbButton } from "./test-gslb-button";

export interface GslbBackendRow {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  username: string;
  enabled: boolean;
  probeCache: {
    fetchedAt: string;
    ok: boolean;
    reason?: string;
    latencyMs?: number;
    counts?: { domains: number; monitors: number; views: number; records: number };
  } | null;
  /** Operator hint for a failed probe, resolved by the page. */
  probeFailHint: string | null;
}

export function GslbBackendsTable({ rows }: { rows: GslbBackendRow[] }) {
  const columns = useMemo<Array<ColumnDef<GslbBackendRow, unknown>>>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (ctx) => {
          const row = ctx.row.original;
          return (
            <Link
              href={`/admin/gslb/${row.id}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              {row.name}
            </Link>
          );
        },
      },
      {
        accessorKey: "baseUrl",
        header: "Base URL",
        cell: (ctx) => (
          <span className="text-muted-foreground font-mono text-xs break-all">
            {ctx.getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: "username",
        header: "Username",
        cell: (ctx) => <span className="font-mono text-xs">{ctx.getValue<string>()}</span>,
      },
      {
        id: "lastTest",
        header: "Last test",
        accessorFn: (row) => (row.probeCache ? (row.probeCache.ok ? 1 : 0) : -1),
        cell: (ctx) => (
          <ProbeChip
            cache={ctx.row.original.probeCache}
            failHint={ctx.row.original.probeFailHint}
          />
        ),
      },
      {
        accessorKey: "enabled",
        header: "Enabled",
        cell: (ctx) => <Tag>{ctx.getValue<boolean>() ? "yes" : "no"}</Tag>,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (ctx) => {
          const row = ctx.row.original;
          return (
            <span className="inline-flex items-center gap-2">
              <TestGslbButton backendId={row.id} />
              <Link href={`/admin/gslb/${row.id}`} className="text-sm underline">
                Edit
              </Link>
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      pageSize={Math.max(rows.length, 10)}
      hidePagination
      hideSearch
      stateKey="gslb-backends"
      initialSort={[{ id: "name", desc: false }]}
      emptyMessage="No GSLB backends match."
      noDataMessage="No GSLB backends configured yet."
    />
  );
}

/**
 * Last Test verdict. A dot plus a word, so the state never rests on color
 * alone; the counts (or the failure hint) sit in the tooltip.
 */
export function ProbeChip({
  cache,
  failHint,
}: {
  cache: GslbBackendRow["probeCache"];
  failHint: string | null;
}) {
  if (!cache) {
    return (
      <span className="text-muted-foreground text-xs" title="Click Test to check the connection.">
        Not tested
      </span>
    );
  }
  const age = freshnessOf(cache.fetchedAt).label;
  if (cache.ok) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs"
        title={cache.counts ? describeCounts(cache.counts) : undefined}
      >
        <span aria-hidden className="bg-success h-1.5 w-1.5 rounded-full" />
        Connected
        {cache.latencyMs !== undefined ? (
          <span className="text-muted-foreground tabular-nums">· {cache.latencyMs} ms</span>
        ) : null}
        <span className="text-muted-foreground">· {age}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs" title={failHint ?? undefined}>
      <span aria-hidden className="bg-destructive h-1.5 w-1.5 rounded-full" />
      Failed{cache.reason ? ` (${cache.reason})` : ""}
      <span className="text-muted-foreground">· {age}</span>
    </span>
  );
}
