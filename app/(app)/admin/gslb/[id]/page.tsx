/**
 * app/(app)/admin/gslb/[id]/page.tsx
 *
 * Edit / test / delete one PowerGSLB backend connection, and manage its
 * regions. Gated by `gslb.manage`.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUserForPage } from "@/lib/auth/require-user";
import { findGslbBackendById } from "@/lib/db/repositories/gslb-backends";
import { gslbFailureHint, isGslbErrorKind } from "@/lib/gslb/errors";
import { GslbDeleteButton } from "../_components/gslb-delete-button";
import { buttonClass } from "@/components/ui/button";
import { GslbBackendForm } from "../_components/gslb-backend-form";
import { RegionsSection } from "../_components/regions-section";
import { loadRegionOverview } from "../_lib/region-overview";
import { ProbeChip } from "../_components/gslb-backends-table";
import { TestGslbButton } from "../_components/test-gslb-button";

export const metadata: Metadata = { title: "GSLB backend" };

export default async function GslbBackendPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserForPage({ can: "gslb.manage" });
  const { id } = await params;

  const backend = await findGslbBackendById(id);
  if (!backend) notFound();

  const overview = await loadRegionOverview(backend);
  const probe = backend.probeCache ?? null;
  const failHint =
    probe && !probe.ok && isGslbErrorKind(probe.reason) ? gslbFailureHint(probe.reason) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1">{backend.name}</h1>
        <p className="text-muted-foreground text-sm">
          Slug <code className="bg-background rounded px-1">{backend.slug}</code> - can&apos;t be
          changed.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <ProbeChip cache={probe} failHint={failHint} />
          <TestGslbButton backendId={backend.id} label="Test connection" />
        </div>
        {failHint ? <p className="text-destructive text-xs">{failHint}</p> : null}
      </header>

      <GslbBackendForm
        mode="edit"
        initial={{
          id: backend.id,
          slug: backend.slug,
          name: backend.name,
          description: backend.description,
          baseUrl: backend.baseUrl,
          username: backend.username,
          nameserverHost: backend.nameserverHost,
          nameserverAddresses: backend.nameserverAddresses ?? null,
          enabled: backend.enabled,
        }}
      />

      <RegionsSection
        backendId={backend.id}
        canWrite={backend.enabled}
        regions={overview.regions}
        orphans={overview.orphans}
        remoteError={overview.remoteError}
      />

      <section className="border-destructive bg-destructive-muted mt-12 rounded-md border p-4">
        <h2 className="text-destructive text-base font-medium">Danger zone</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Removes this connection from the panel. The panel refuses while anything still uses it -
          regions, or zones with GSLB records or a GSLB setup - and says where to remove each, so
          nothing is left behind in PowerGSLB or PowerDNS. Audit history is preserved.
        </p>
        <GslbDeleteButton
          endpoint={`/api/admin/gslb-backends/${backend.id}`}
          confirmTitle={`Delete GSLB backend "${backend.name}"?`}
          confirmDescription="A backend that still has regions or zones using it can't be deleted; the error lists what to remove first. Otherwise the panel stops using this PowerGSLB connection immediately. This cannot be undone."
          confirmLabel="Delete backend"
          successMessage="GSLB backend deleted."
          label="Delete backend"
          redirectTo="/admin/gslb"
          className={buttonClass({ variant: "destructive", className: "mt-4" })}
        />
      </section>
    </div>
  );
}
