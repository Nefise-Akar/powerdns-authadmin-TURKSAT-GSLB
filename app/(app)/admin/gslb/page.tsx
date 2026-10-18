/**
 * app/(app)/admin/gslb/page.tsx
 *
 * PowerGSLB backend connections (ADR-0024). The panel signs in to each
 * backend's admin API with a service account; operators never use PowerGSLB's
 * own UI, which has no roles or SSO. Gated by `gslb.manage`.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireUserForPage } from "@/lib/auth/require-user";
import { listAllGslbBackends } from "@/lib/db/repositories/gslb-backends";
import { gslbFailureHint, isGslbErrorKind } from "@/lib/gslb/errors";
import { buttonClass } from "@/components/ui/button";
import { CreateButton } from "@/components/ui/create-button";
import { GslbBackendsTable, type GslbBackendRow } from "./_components/gslb-backends-table";

export const metadata: Metadata = { title: "GSLB" };

export default async function GslbBackendsPage() {
  await requireUserForPage({ can: "gslb.manage" });
  const backends = await listAllGslbBackends();

  const rows: GslbBackendRow[] = backends.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    baseUrl: b.baseUrl,
    username: b.username,
    enabled: b.enabled,
    probeCache: b.probeCache ?? null,
    probeFailHint:
      b.probeCache && !b.probeCache.ok && isGslbErrorKind(b.probeCache.reason)
        ? gslbFailureHint(b.probeCache.reason)
        : null,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-h1">GSLB</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            PowerGSLB backends this panel manages. Operators switch GSLB on per record; these
            connections are what the panel uses to do it.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2 [&>*]:w-full sm:[&>*]:w-auto">
          {backends.length > 0 ? (
            <CreateButton href="/admin/gslb/new" label="Add GSLB backend" />
          ) : null}
        </div>
      </header>

      {backends.length === 0 ? (
        <div className="border-border bg-background rounded-md border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No GSLB backends yet. Add a PowerGSLB admin API connection - base URL plus a dedicated
            service account - then use Test to check it.
          </p>
          <Link
            href="/admin/gslb/new"
            className={buttonClass({ variant: "primary", className: "mt-4" })}
          >
            Add your first GSLB backend
          </Link>
        </div>
      ) : (
        <GslbBackendsTable rows={rows} />
      )}
    </div>
  );
}
