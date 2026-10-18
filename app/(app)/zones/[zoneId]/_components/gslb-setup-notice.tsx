"use client";

/**
 * app/(app)/zones/[zoneId]/_components/gslb-setup-notice.tsx
 *
 * Shown on the records tab when a zone still has a GSLB setup (its `gslb`
 * subzone delegation) but no GSLB records: lets the operator tear it down
 * from the UI, which also unlocks those RRsets in the table.
 */

import { buttonClass } from "@/components/ui/button";
import { GslbDeleteButton } from "@/app/(app)/admin/gslb/_components/gslb-delete-button";

export function GslbSetupNotice({
  subzone,
  zoneIdEncoded,
  serverSlug,
  canRemove,
}: {
  subzone: string;
  zoneIdEncoded: string;
  serverSlug: string;
  canRemove: boolean;
}) {
  const query = new URLSearchParams({ serverSlug }).toString();
  return (
    <div className="border-border bg-background flex flex-col gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p>
        GSLB is set up for this zone (<code className="font-mono">{subzone}</code> subzone
        delegation), but no record uses it.
      </p>
      {canRemove ? (
        <GslbDeleteButton
          endpoint={`/api/admin/pdns/zones/${zoneIdEncoded}/gslb/setup?${query}`}
          confirmTitle="Remove the GSLB setup?"
          confirmDescription={`Deletes the ${subzone} NS record and its glue from this zone (glue that another delegation still uses is kept) and the matching domain in PowerGSLB. Switching GSLB on again later sets it up anew.`}
          confirmLabel="Remove GSLB setup"
          successMessage={(body) => {
            const leftover =
              body && typeof body === "object" && "remoteLeftover" in body
                ? body.remoteLeftover
                : null;
            return typeof leftover === "string"
              ? `GSLB setup removed from this zone. ${leftover}`
              : "GSLB setup removed.";
          }}
          label="Remove GSLB setup"
          className={buttonClass({ size: "sm" })}
        />
      ) : null}
    </div>
  );
}
