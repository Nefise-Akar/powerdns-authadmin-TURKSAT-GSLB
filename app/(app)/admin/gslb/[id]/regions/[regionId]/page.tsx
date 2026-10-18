/**
 * app/(app)/admin/gslb/[id]/regions/[regionId]/page.tsx
 *
 * Edit one GSLB region. Gated by `gslb.manage`.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUserForPage } from "@/lib/auth/require-user";
import { findGslbBackendById } from "@/lib/db/repositories/gslb-backends";
import { findGslbRegion } from "@/lib/db/repositories/gslb-regions";
import { ownedViewName } from "@/lib/gslb/views";
import { RegionForm } from "../../../_components/region-form";

export const metadata: Metadata = { title: "Edit region" };

export default async function GslbRegionPage({
  params,
}: {
  params: Promise<{ id: string; regionId: string }>;
}) {
  await requireUserForPage({ can: "gslb.manage" });
  const { id, regionId } = await params;
  const backend = await findGslbBackendById(id);
  if (!backend) notFound();
  const region = await findGslbRegion(backend.id, regionId);
  if (!region) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1">{region.name}</h1>
        <p className="text-muted-foreground text-sm">
          Region on <span className="font-medium">{backend.name}</span> · PowerGSLB view{" "}
          <code className="bg-background rounded px-1 font-mono">{ownedViewName(region.slug)}</code>
        </p>
      </header>
      <RegionForm
        mode="edit"
        backendId={backend.id}
        initial={{
          id: region.id,
          slug: region.slug,
          name: region.name,
          description: region.description,
          rules: region.rules,
        }}
      />
    </div>
  );
}
