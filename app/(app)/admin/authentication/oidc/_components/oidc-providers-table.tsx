"use client";

/**
 * app/(app)/admin/authentication/oidc/_components/oidc-providers-table.tsx
 *
 * Client wrapper using the shared <DataTable>. The env-configured provider (when
 * not shadowed by a DB row) is folded into the same row list so it renders with
 * the same column shape - its read-only/no-edit nature is encoded per-cell, not
 * by a parallel table. Per-row icon, the discovery badge, the freshness label,
 * and the per-row attention tint all live here so the page can hand over
 * fully-serializable data.
 */

import { useMemo } from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { freshnessOf } from "@/lib/freshness";
import { TestDiscoveryButton } from "./test-discovery-button";

export interface OidcProviderRow {
  /** Empty string for the env-only synthetic row - disables actions. */
  id: string;
  name: string;
  slug: string;
  issuerUrl: string;
  enabled: boolean;
  iconUrl: string | null;
  allowedEmailDomains: string[] | null;
  discoveryCache: {
    fetchedAt: string;
    ok: boolean;
    reason?: string;
    endSessionEndpoint?: string | null;
  } | null;
  /** Pre-resolved by lib/freshness - server can compute it once. */
  lastAdminEditLabel: string | null;
  lastAdminEditTitle: string | null;
  /** Pre-resolved human-readable failure hint for the badge tooltip. */
  discoveryFailHint: string | null;
  isEnvManaged: boolean;
}

interface Props {
  rows: OidcProviderRow[];
  canManage: boolean;
  canReadAudit: boolean;
}

export function OidcProvidersTable({ rows, canManage, canReadAudit }: Props) {
  const columns = useMemo<Array<ColumnDef<OidcProviderRow, unknown>>>(() => {
    const base: Array<ColumnDef<OidcProviderRow, unknown>> = [
      {
        id: "icon",
        header: "",
        enableSorting: false,
        cell: (ctx) => {
          const row = ctx.row.original;
          return row.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.iconUrl}
              alt=""
              style={{ width: 20, height: 20, objectFit: "contain", display: "block" }}
            />
          ) : (
            <span className="bg-muted block h-5 w-5 rounded" title="No icon set" />
          );
        },
      },
      {
        accessorKey: "name",
        header: "Name",
        cell: (ctx) => {
          const row = ctx.row.original;
          return (
            <span className="inline-flex items-center gap-2">
              {row.name}
              {row.isEnvManaged ? (
                <span
                  className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap"
                  title="Configured via OIDC_* environment variables. Edit by changing env vars, not the UI."
                >
                  Configured by ENV
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        accessorKey: "slug",
        header: "Slug",
        cell: (ctx) => (
          <code className="bg-background rounded px-1 text-xs">{ctx.getValue<string>()}</code>
        ),
      },
      {
        accessorKey: "issuerUrl",
        header: "Issuer",
        cell: (ctx) => <span className="text-muted-foreground">{ctx.getValue<string>()}</span>,
      },
      {
        accessorKey: "enabled",
        header: "Enabled",
        cell: (ctx) =>
          ctx.getValue<boolean>() ? (
            <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono">
              Yes
            </span>
          ) : (
            <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono">
              No
            </span>
          ),
      },
      {
        id: "domains",
        accessorFn: (row) => row.allowedEmailDomains?.length ?? -1,
        header: "Domains",
        cell: (ctx) => <DomainsCell allowedEmailDomains={ctx.row.original.allowedEmailDomains} />,
      },
      {
        id: "discovery",
        header: "Discovery",
        enableSorting: false,
        cell: (ctx) => {
          const row = ctx.row.original;
          if (row.isEnvManaged) {
            return <span className="text-muted-foreground text-xs">-</span>;
          }
          return <DiscoveryBadge cache={row.discoveryCache} failHint={row.discoveryFailHint} />;
        },
      },
    ];
    if (canReadAudit) {
      base.push({
        id: "lastEdit",
        header: "Last admin edit",
        accessorFn: (row) => row.lastAdminEditLabel ?? "",
        cell: (ctx) => {
          const row = ctx.row.original;
          if (row.isEnvManaged || !row.lastAdminEditLabel) {
            return <span className="text-muted-foreground text-xs">-</span>;
          }
          return (
            <span
              className="text-muted-foreground text-xs"
              title={row.lastAdminEditTitle ?? undefined}
            >
              {row.lastAdminEditLabel}
            </span>
          );
        },
      });
    }
    base.push({
      id: "actions",
      header: "",
      enableSorting: false,
      cell: (ctx) => {
        const row = ctx.row.original;
        if (row.isEnvManaged) {
          return (
            <span
              className="text-muted-foreground text-xs"
              title="Read-only - edit via OIDC_* environment variables"
            >
              Read-only
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-2">
            <TestDiscoveryButton providerId={row.id} />
            <Link href={`/admin/authentication/oidc/${row.id}`} className="text-sm underline">
              {canManage ? "Edit" : "View"}
            </Link>
          </span>
        );
      },
    });
    return base;
  }, [canManage, canReadAudit]);

  return (
    <DataTable
      data={rows}
      columns={columns}
      pageSize={Math.max(rows.length, 10)}
      hidePagination
      hideSearch
      stateKey="oidc-providers"
      emptyMessage="No providers match."
      noDataMessage="No providers configured yet."
    />
  );
}

/**
 * Three-state renderer for the per-provider email-domain allow-list (matches the
 * resolver semantics in `lib/auth/email-domain-allowlist.ts`):
 *
 *   null       → "(inherited)"  - env default applies
 *   []         → "(unrestricted)" - explicit override of env
 *   [a, b, …]  → "N domain(s)" with the list as a tooltip
 */
function DomainsCell({ allowedEmailDomains }: { allowedEmailDomains: string[] | null }) {
  if (allowedEmailDomains === null) {
    return (
      <span className="text-muted-foreground" title="Inherits OIDC_ALLOWED_EMAIL_DOMAINS from env.">
        (inherited)
      </span>
    );
  }
  if (allowedEmailDomains.length === 0) {
    return (
      <span className="text-muted-foreground" title="Override: no restriction at this provider.">
        (unrestricted)
      </span>
    );
  }
  return (
    <span title={allowedEmailDomains.join(", ")}>
      {allowedEmailDomains.length} domain{allowedEmailDomains.length === 1 ? "" : "s"}
    </span>
  );
}

function DiscoveryBadge({
  cache,
  failHint,
}: {
  cache: {
    fetchedAt: string;
    ok: boolean;
    reason?: string;
    endSessionEndpoint?: string | null;
  } | null;
  failHint: string | null;
}) {
  if (!cache) {
    return (
      <span
        className="text-muted-foreground text-xs"
        title="Click Test to probe the issuer's discovery endpoint."
      >
        (not yet probed)
      </span>
    );
  }
  const label = freshnessOf(cache.fetchedAt).label;
  if (cache.ok) {
    // Surface a soft warning when the IdP doesn't advertise an
    // end_session_endpoint. Operationally this means our /api/auth/logout
    // can't tell the IdP to terminate the session - operators get
    // re-authed silently by the still-valid IdP cookie and "logout
    // appears to do nothing." We have a 60s suppression cookie that
    // covers the immediate case, but the underlying config is the real
    // fix. `endSessionEndpoint === undefined` means the cache was
    // written by an older probe before we recorded this field; only
    // an explicit `null` is "definitely missing".
    const endSessionMissing = cache.endSessionEndpoint === null;
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <span className="bg-success h-1.5 w-1.5 rounded-full" />
        Reachable
        <span className="text-muted-foreground">· {label}</span>
        {endSessionMissing ? (
          <span
            className="bg-tag text-mono-xs text-tag-foreground ml-1 inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap"
            title="IdP doesn't advertise end_session_endpoint. RP-initiated sign-out can't reach the IdP - users will see the local sign-out screen instead of the IdP's. Fix: enable Front Channel / Back Channel Logout on the IdP."
          >
            no end-session
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-xs"
      title={failHint ?? "Discovery probe failed."}
    >
      <span className="bg-destructive h-1.5 w-1.5 rounded-full" />
      Failed
      <span className="text-muted-foreground">· {label}</span>
    </span>
  );
}
