"use client";

/**
 * app/(app)/admin/gslb/_components/regions-section.tsx
 *
 * "Regions" on the GSLB backend detail page: the operator-defined sites, each
 * with its PowerGSLB sync state, plus any orphaned panel-owned views. The page
 * computes the overview server-side (one PowerGSLB read per render); nothing
 * here writes on its own - Resync is an explicit click.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Alert } from "@/components/ui/alert";
import { Tag } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { GslbDeleteButton } from "./gslb-delete-button";
import { DataTable } from "@/components/ui/data-table";
import { useDialog } from "@/components/ui/dialog";
import { useGslbMutate } from "../_lib/use-gslb-fetch";

export type RegionStatus = "in-sync" | "missing" | "rule-differs" | "unknown";

export interface RegionRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rules: string[];
  view: string;
  status: RegionStatus;
  remoteRule: string | null;
}

interface Props {
  backendId: string;
  /** Writes are refused for a disabled backend, so the actions hide. */
  canWrite: boolean;
  regions: RegionRow[];
  orphans: Array<{ view: string; rule: string }>;
  remoteError: string | null;
}

const MAX_RULES_SHOWN = 3;

export function RegionsSection({ backendId, canWrite, regions, orphans, remoteError }: Props) {
  const base = `/admin/gslb/${backendId}/regions`;

  const columns = useMemo<Array<ColumnDef<RegionRow, unknown>>>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (ctx) => {
          const row = ctx.row.original;
          return (
            <span className="flex flex-col">
              <Link
                href={`${base}/${row.id}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {row.name}
              </Link>
              <span className="text-muted-foreground font-mono text-xs">{row.view}</span>
            </span>
          );
        },
      },
      {
        id: "rules",
        header: "Rules",
        accessorFn: (row) => row.rules.join(" "),
        cell: (ctx) => <RulesSummary rules={ctx.row.original.rules} />,
      },
      {
        accessorKey: "status",
        header: "PowerGSLB",
        cell: (ctx) => (
          <SyncChip status={ctx.row.original.status} remoteRule={ctx.row.original.remoteRule} />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (ctx) => {
          const row = ctx.row.original;
          if (!canWrite) return null;
          return (
            // One row of same-size buttons, right-aligned: a text link beside
            // padded buttons wraps into a ragged stack in a narrow column.
            <span className="flex flex-nowrap items-center justify-end gap-1">
              {row.status === "missing" || row.status === "rule-differs" ? (
                <ResyncButton backendId={backendId} regionId={row.id} />
              ) : null}
              <Link
                href={`${base}/${row.id}`}
                className={buttonClass({ size: "sm", variant: "ghost" })}
              >
                Edit
              </Link>
              <GslbDeleteButton
                endpoint={`/api/admin/gslb-backends/${backendId}/regions/${row.id}`}
                confirmTitle={`Delete region "${row.name}"?`}
                confirmDescription={`Removes the region and its PowerGSLB view ${row.view}. PowerGSLB refuses while GSLB records still use the view.`}
                confirmLabel="Delete region"
                successMessage="Region deleted."
                label="Delete"
                // buttonClass doesn't merge classes, so the ghost variant's
                // text-foreground would win over a plain text-destructive;
                // the important suffix is what actually turns it red.
                className={buttonClass({
                  size: "sm",
                  variant: "ghost",
                  className: "text-destructive!",
                })}
              />
            </span>
          );
        },
      },
    ],
    [backendId, base, canWrite],
  );

  return (
    <section className="space-y-4" aria-labelledby="gslb-regions-heading">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="gslb-regions-heading" className="text-h2">
            Regions
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Each region becomes a PowerGSLB view named{" "}
            <code className="font-mono">authadmin:&lt;slug&gt;</code>. The panel is the source of
            truth; views it didn&apos;t create are never touched.
          </p>
        </div>
        {canWrite && regions.length > 0 ? (
          <Link
            href={`${base}/new`}
            className={buttonClass({ variant: "primary", className: "w-full sm:w-auto" })}
          >
            Add region
          </Link>
        ) : null}
      </header>

      {remoteError ? (
        <Alert title="powergslb unreachable">Sync state is unknown. {remoteError}</Alert>
      ) : null}

      {regions.length === 0 ? (
        <div className="border-border bg-background rounded-md border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No regions yet. Regions tell GSLB which clients belong to which site — e.g. an
            office&apos;s IP ranges.
          </p>
          {canWrite ? (
            <Link
              href={`${base}/new`}
              className={buttonClass({ variant: "primary", className: "mt-4" })}
            >
              Add your first region
            </Link>
          ) : null}
        </div>
      ) : (
        <DataTable
          data={regions}
          columns={columns}
          pageSize={Math.max(regions.length, 10)}
          hidePagination
          hideSearch
          stateKey="gslb-regions"
          initialSort={[{ id: "name", desc: false }]}
          emptyMessage="No regions match."
          noDataMessage="No regions yet."
        />
      )}

      {orphans.length > 0 ? (
        <Alert title="orphaned views">
          PowerGSLB has panel-owned views with no region here:{" "}
          {orphans.map((o, i) => (
            <span key={o.view}>
              {i > 0 ? ", " : ""}
              <code className="font-mono" title={o.rule}>
                {o.view}
              </code>
            </span>
          ))}
          . They are left untouched; recreate a region with the same slug to adopt one, or remove it
          in PowerGSLB.
        </Alert>
      ) : null}

      {!canWrite ? (
        <p className="text-muted-foreground text-xs">
          This backend is disabled. Enable it to add or change regions.
        </p>
      ) : null}
    </section>
  );
}

function RulesSummary({ rules }: { rules: string[] }) {
  const shown = rules.slice(0, MAX_RULES_SHOWN);
  const rest = rules.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1" title={rules.join("\n")}>
      {shown.map((rule) => (
        <Tag key={rule}>{rule}</Tag>
      ))}
      {rest > 0 ? <span className="text-muted-foreground text-xs">+{rest} more</span> : null}
    </span>
  );
}

const STATUS_LABEL: Record<RegionStatus, { label: string; dot: string; title: string }> = {
  "in-sync": {
    label: "In sync",
    dot: "bg-success",
    title: "PowerGSLB has this view with the same rules.",
  },
  missing: {
    label: "Missing",
    dot: "bg-destructive",
    title: "PowerGSLB has no view for this region. Resync recreates it.",
  },
  "rule-differs": {
    label: "Rules differ",
    dot: "bg-warning",
    title: "The PowerGSLB view has different rules. Resync rewrites them from this region.",
  },
  unknown: {
    label: "Unknown",
    dot: "bg-muted-foreground",
    title: "PowerGSLB couldn't be read.",
  },
};

/** Dot plus word, so state never rests on color alone. */
function SyncChip({ status, remoteRule }: { status: RegionStatus; remoteRule: string | null }) {
  const meta = STATUS_LABEL[status];
  const title = remoteRule ? `${meta.title}\nPowerGSLB has: ${remoteRule}` : meta.title;
  return (
    <span className="inline-flex items-center gap-1 text-xs" title={title}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function ResyncButton({ backendId, regionId }: { backendId: string; regionId: string }) {
  const router = useRouter();
  const gslbMutate = useGslbMutate();
  const { toast } = useDialog();
  const [busy, setBusy] = useState(false);

  async function handleResync() {
    setBusy(true);
    try {
      const result = await gslbMutate(
        `/api/admin/gslb-backends/${backendId}/regions/${regionId}/resync`,
        { method: "POST" },
      );
      if (!result.ok) {
        toast({ kind: "error", title: "Resync failed", description: result.error });
        return;
      }
      toast({ kind: "success", description: "PowerGSLB view rewritten from the region." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleResync}
      disabled={busy}
      aria-busy={busy}
      title="Rewrite the PowerGSLB view from this region."
      className={buttonClass({ size: "sm" })}
    >
      {busy ? "Resyncing…" : "Resync"}
    </button>
  );
}
