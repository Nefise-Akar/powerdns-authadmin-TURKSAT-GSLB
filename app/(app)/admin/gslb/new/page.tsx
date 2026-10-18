/**
 * app/(app)/admin/gslb/new/page.tsx
 *
 * "Add GSLB backend" form shell. Gated by `gslb.manage`.
 */

import type { Metadata } from "next";
import { requireUserForPage } from "@/lib/auth/require-user";
import { GslbBackendForm } from "../_components/gslb-backend-form";

export const metadata: Metadata = { title: "Add GSLB backend" };

export default async function NewGslbBackendPage() {
  await requireUserForPage({ can: "gslb.manage" });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-h1">Add GSLB backend</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect to a PowerGSLB admin API. Use a service account created for this panel only; its
          password is encrypted at rest and never shown again.
        </p>
      </header>

      <GslbBackendForm mode="create" />
    </div>
  );
}
