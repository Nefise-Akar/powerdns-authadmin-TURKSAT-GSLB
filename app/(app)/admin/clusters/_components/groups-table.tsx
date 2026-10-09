"use client";

/**
 * app/(app)/admin/clusters/_components/groups-table.tsx
 *
 * Client wrapper around the shared `<DataTable>` for the Groups list -
 * sortable columns + search on desktop, cards on mobile. Mirrors the other
 * admin list tables (roles/users/teams).
 */

import Link from "next/link";
import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";

export interface GroupRow {
  id: string;
  name: string;
  slug: string;
  /** Human label from classifyGroup (e.g. "Multi-primary cluster"). */
  typeLabel: string;
  isMultiPrimary: boolean;
  /** Raw write strategy (e.g. "round_robin"); only meaningful when multi-primary. */
  writeStrategy: string;
  memberCount: number;
}

export function GroupsTable({ rows }: { rows: GroupRow[] }) {
  const columns = useMemo<Array<ColumnDef<GroupRow, unknown>>>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (ctx) => (
          <Link
            href={`/admin/clusters/${ctx.row.original.id}`}
            className="hover:text-primary hover:text-primary-hover font-medium hover:underline"
          >
            {ctx.getValue<string>()}
          </Link>
        ),
      },
      {
        accessorKey: "slug",
        header: "Slug",
        cell: (ctx) => <code className="font-mono text-xs">{ctx.getValue<string>()}</code>,
      },
      {
        accessorKey: "typeLabel",
        header: "Type",
        cell: (ctx) => (
          <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
            {ctx.getValue<string>()}
          </span>
        ),
      },
      {
        id: "strategy",
        header: "Strategy",
        accessorFn: (row) => (row.isMultiPrimary ? row.writeStrategy : ""),
        cell: (ctx) => {
          const r = ctx.row.original;
          return r.isMultiPrimary ? (
            <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
              {r.writeStrategy.replace("_", " ")}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          );
        },
      },
      {
        accessorKey: "memberCount",
        header: "Members",
        cell: (ctx) => <span className="text-xs">{ctx.getValue<number>()}</span>,
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search groups"
      initialSort={[{ id: "name", desc: false }]}
      sortParam="sort"
      pageSizeParam="pageSize"
      rowHref={(r) => `/admin/clusters/${r.id}`}
    />
  );
}
