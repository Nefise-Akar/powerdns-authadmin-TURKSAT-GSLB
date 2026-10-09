/**
 * app/(app)/admin/autoprimaries/page.tsx
 *
 * Per-backend list of trusted upstream primaries from which this PDNS
 * server will auto-create slave zones via incoming NOTIFY.
 *
 * Permission: `autoprimary.manage` (read AND mutate gated under the
 * same permission - autoprimaries are connection config, not
 * something operators with read-only access need to inspect).
 *
 * Backend selection: `?server=<slug>` to inspect a non-default
 * backend (matches /admin/tsig-keys and /admin/servers).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireUserForPage } from "@/lib/auth/require-user";
import { findServerToInspect, listAllPdnsServers } from "@/lib/db/repositories/pdns-servers";
import { getBackendGateway } from "@/lib/realtime/backend-gateway";
import { PdnsAuthError } from "@/lib/pdns/errors";
import { logger } from "@/lib/logger";
import { redact } from "@/lib/errors/redact";
import { AutoprimaryActions } from "./_components/autoprimary-actions";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Autoprimaries" };

interface PageProps {
  searchParams: Promise<{ server?: string }>;
}

export default async function AutoprimariesPage({ searchParams }: PageProps) {
  await requireUserForPage({ can: "autoprimary.manage" });
  const { server: requestedSlug } = await searchParams;

  const selected = await findServerToInspect(requestedSlug);
  const servers = await listAllPdnsServers();

  if (selected?.disabledAt !== null) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-h1">Autoprimaries</h1>
        </header>
        <Alert
          title="no backend selected"
          action={<Link href="/admin/servers">Add a server</Link>}
        />
      </div>
    );
  }

  let rows: Awaited<ReturnType<typeof loadRows>> | null = null;
  let fetchError: string | null = null;
  try {
    rows = await loadRows(selected);
  } catch (err) {
    // The gateway already recorded reachability in the shared store; here we
    // just show a generic message - the raw connect error (host:port) is a
    // fingerprint oracle (S-12), so it goes to the log only.
    fetchError =
      err instanceof PdnsAuthError
        ? "API rejected the configured key (401/403)."
        : "Backend unreachable - the app hasn't reached its API recently.";
    logger.warn(
      { server: selected.slug, err: err instanceof Error ? redact(err.message) : "unknown" },
      "admin.autoprimaries.list.failed",
    );
  }

  const sorted = rows
    ? [...rows].sort((a, b) => `${a.ip}|${a.nameserver}`.localeCompare(`${b.ip}|${b.nameserver}`))
    : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h1">Autoprimaries</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Primaries this PDNS server trusts to trigger automatic slave-zone creation via NOTIFY.
          Keyed on the (IP, nameserver) pair.
        </p>
      </header>

      {servers.length > 1 ? (
        <nav className="flex flex-wrap gap-2 text-xs">
          {servers
            .filter((s) => s.disabledAt === null)
            .map((s) => (
              <Link
                key={s.id}
                href={`/admin/autoprimaries?server=${encodeURIComponent(s.slug)}`}
                className={
                  s.slug === selected.slug
                    ? "border-primary bg-primary text-primary-foreground rounded border px-2 py-1"
                    : "border-border hover:bg-muted rounded border px-2 py-1"
                }
              >
                {s.name}
              </Link>
            ))}
        </nav>
      ) : null}

      {fetchError ? (
        <Alert variant="destructive" title="could not list autoprimaries">
          {fetchError}
        </Alert>
      ) : null}

      {/* The empty-state copy now renders inside the table via DataTable's
          `noDataMessage` (matches the TSIG keys page). Skip the actions
          component entirely on a fetch error so we don't show "No
          autoprimaries configured" when the real answer is "we couldn't ask". */}
      {fetchError ? null : <AutoprimaryActions serverSlug={selected.slug} rows={sorted ?? []} />}
    </div>
  );
}

async function loadRows(selected: Awaited<ReturnType<typeof findServerToInspect>> & object) {
  const client = getBackendGateway(selected);
  return client.listAutoprimaries();
}
