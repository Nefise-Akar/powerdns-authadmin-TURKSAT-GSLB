/**
 * Metadata tab body - rendered from the main zone page when `?tab=metadata`.
 * Originally lived at `/zones/[id]/metadata/page.tsx`; collapsed in so
 * every tab is a query-string switch.
 */

import { getBackendGateway } from "@/lib/realtime/backend-gateway";
import { PdnsNotFoundError } from "@/lib/pdns/errors";
import { redact } from "@/lib/errors/redact";
import { logger } from "@/lib/logger";
import type { PdnsServer } from "@/lib/db/schema";
import type { PdnsMetadata } from "@/lib/pdns/types";
import { AddMetadataKind } from "../metadata/_components/add-metadata-kind";
import { KIND_SPECS, ZONE_OBJECT_KINDS } from "../metadata/_components/kind-specs";
import { MetadataEditor } from "../metadata/_components/metadata-editor";
import { ZoneTsigTransfer } from "./zone-tsig-transfer";
import { Alert } from "@/components/ui/alert";

interface Props {
  zoneIdEncoded: string;
  zoneName: string;
  selected: PdnsServer;
  // Per-zone authorization decided by the parent page (global permission OR
  // a zone_grant for this server+zone) - see app/(app)/zones/[zoneId]/page.tsx.
  canRead: boolean;
  canWrite: boolean;
  /** Authoritative (Master/Primary) zone - show the friendly TSIG transfer-key
   *  selector. Mirror/Native zones don't serve AXFR, so it's hidden there. */
  showTsigTransfer: boolean;
}

export async function MetadataSection({
  zoneIdEncoded,
  zoneName,
  selected,
  canRead,
  canWrite,
  showTsigTransfer,
}: Props) {
  if (!canRead) {
    return (
      <Alert title="no permission">
        You don&apos;t have permission to view metadata for this zone.
      </Alert>
    );
  }

  let items: PdnsMetadata[] | null = null;
  let fetchError: string | null = null;
  try {
    const client = getBackendGateway(selected);
    items = await client.listZoneMetadata(zoneName);
  } catch (err) {
    if (err instanceof PdnsNotFoundError) {
      return <Alert variant="destructive" title="zone not found on backend" />;
    }
    fetchError = err instanceof Error ? redact(err.message) : "Unknown error";
    logger.warn(
      { server: selected.slug, zone: zoneName, err: fetchError },
      "zone.metadata.list.failed",
    );
  }

  const sorted = items
    ? [...items]
        .filter((m) => !ZONE_OBJECT_KINDS.has(m.kind))
        .sort((a, b) => a.kind.localeCompare(b.kind))
    : null;

  // Friendly TSIG transfer-key selector for authoritative zones: the available
  // keys on this backend + the current TSIG-ALLOW-AXFR selection. Fetched only
  // when relevant. A key-list failure just hides the selector (the raw metadata
  // editor below still works).
  let tsigKeyNames: string[] | null = null;
  if (showTsigTransfer && items !== null) {
    try {
      tsigKeyNames = (await getBackendGateway(selected).listTsigKeys()).map((k) => k.name).sort();
    } catch (err) {
      logger.warn(
        {
          server: selected.slug,
          zone: zoneName,
          err: err instanceof Error ? redact(err.message) : "unknown",
        },
        "zone.tsig.list.failed",
      );
    }
  }
  // Current transfer keys come from the (readable) TSIG-ALLOW-AXFR metadata,
  // which PDNS populates from the zone's master_tsig_key_ids.
  const currentTransferKeys = items?.find((m) => m.kind === "TSIG-ALLOW-AXFR")?.metadata ?? [];

  return (
    <div className="space-y-4">
      {tsigKeyNames !== null ? (
        <ZoneTsigTransfer
          zoneIdEncoded={zoneIdEncoded}
          serverSlug={selected.slug}
          allKeys={tsigKeyNames}
          currentKeys={currentTransferKeys}
          canWrite={canWrite}
        />
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Zone metadata{" "}
          <span className="text-muted-foreground text-sm font-normal">
            - per-zone configuration the PDNS daemon honors at lookup and transfer time.
          </span>
        </h2>
        {canWrite ? (
          <AddMetadataKind
            zoneIdEncoded={zoneIdEncoded}
            serverSlug={selected.slug}
            existingKinds={sorted?.map((m) => m.kind) ?? []}
          />
        ) : null}
      </div>

      {fetchError ? (
        <Alert variant="destructive" title="could not list metadata">
          {fetchError}
        </Alert>
      ) : null}

      {sorted?.length === 0 ? (
        <div className="border-border bg-background rounded-md border p-5 text-sm">
          No metadata configured. The zone uses PDNS defaults for transfers, notifications, and
          signing.
        </div>
      ) : null}

      {sorted && sorted.length > 0 ? (
        <ul className="space-y-3">
          {sorted.map((m) => {
            const desc = KIND_SPECS[m.kind]?.description;
            return (
              <li key={m.kind} className="border-border bg-card rounded-md border p-5">
                <header className="flex flex-wrap items-baseline gap-x-3">
                  <h3 className="font-mono text-sm font-medium">{m.kind}</h3>
                  <span className="text-muted-foreground text-xs">
                    {m.metadata.length} value
                    {m.metadata.length === 1 ? "" : "s"}
                  </span>
                </header>
                {desc ? <p className="text-muted-foreground mt-1 text-xs">{desc}</p> : null}
                {m.metadata.length > 0 ? (
                  <ul className="bg-background mt-3 space-y-1 rounded p-3 font-mono text-xs">
                    {m.metadata.map((v, i) => (
                      <li key={i}>
                        <code className="break-all">{v}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground mt-3 text-xs italic">(kind set but empty)</p>
                )}
                {canWrite ? (
                  <MetadataEditor
                    zoneIdEncoded={zoneIdEncoded}
                    serverSlug={selected.slug}
                    kind={m.kind}
                    initialValues={m.metadata}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
