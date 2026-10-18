/**
 * app/(app)/admin/gslb/[id]/regions/new/page.tsx
 *
 * "Add region" for one GSLB backend. Gated by `gslb.manage`.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUserForPage } from "@/lib/auth/require-user";
import { findGslbBackendById } from "@/lib/db/repositories/gslb-backends";
import { RegionForm } from "../../../_components/region-form";

export const metadata: Metadata = { title: "Add region" };

export default async function NewGslbRegionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserForPage({ can: "gslb.manage" });
  const { id } = await params;
  const backend = await findGslbBackendById(id);
  if (!backend) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-h1">Add region</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A region is one of your sites on <span className="font-medium">{backend.name}</span>.
          Saving creates its PowerGSLB view; if PowerGSLB refuses, nothing is kept.
        </p>
      </header>
      <RegionForm mode="create" backendId={backend.id} />
    </div>
  );
}
