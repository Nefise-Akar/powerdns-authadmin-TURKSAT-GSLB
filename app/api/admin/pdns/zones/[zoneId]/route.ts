/**
 * app/api/admin/pdns/zones/[zoneId]/route.ts
 *
 * DELETE - drop the zone on the PDNS backend entirely. Permission:
 *          `zone.delete` (type-level OR a per-zone grant).
 *
 * The web UI gates this behind a download-backup + type-to-confirm
 * flow; the API does NOT (per the user's call - programmatic clients
 * shouldn't be asked to type a phrase). The API still requires CSRF
 * + the right permission.
 */

import { headers } from "next/headers";
import { z, ZodError } from "zod";
import { appendAudit } from "@/lib/audit/log";
import { publishZoneEvent } from "@/lib/realtime/event-bus";
import { scheduleImmediatePoll } from "@/lib/realtime/zone-poller";
import { getRequestContext } from "@/lib/client-ip";
import { requireUser } from "@/lib/auth/require-user";
import { requireCsrf } from "@/lib/auth/csrf";
import { findDefaultPdnsServer, findPdnsServerBySlug } from "@/lib/db/repositories/pdns-servers";
import { deleteZoneHorizon, horizonScopeFor } from "@/lib/db/repositories/zone-horizons";
import { getBackendGateway } from "@/lib/realtime/backend-gateway";
import { canonicalZoneName } from "@/lib/dns/zone-name";
import { PdnsError, PdnsNotFoundError } from "@/lib/pdns/errors";
import { canActOnZone } from "@/lib/rbac/zone-permissions";
import { redact } from "@/lib/errors/redact";
import { logger } from "@/lib/logger";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import {
  deleteGslbZoneRow,
  findGslbZone,
  listGslbRecordsForZone,
} from "@/lib/db/repositories/gslb-records";
import { canonicalName } from "@/lib/gslb/record-plan";
import { removeGslbDomain } from "@/lib/gslb/record-sync";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import { findGslbBackendById } from "@/lib/db/repositories/gslb-backends";

const deleteQuerySchema = z.object({
  serverSlug: z.string().optional(),
});

interface RouteContext {
  params: Promise<{ zoneId: string }>;
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { user: actor, globalPermissions, zoneGrants } = await requireUser();
    await requireCsrf(request);

    const { zoneId } = await context.params;
    const url = new URL(request.url);
    let parsed;
    try {
      parsed = deleteQuerySchema.parse(Object.fromEntries(url.searchParams));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError("Invalid input.", {
          fieldErrors: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    const selected = parsed.serverSlug
      ? await findPdnsServerBySlug(parsed.serverSlug)
      : await findDefaultPdnsServer();
    if (selected?.disabledAt !== null) {
      throw new NotFoundError("No PDNS backend selected.");
    }

    const client = getBackendGateway(selected);
    // Canonical form: grants are stored lowercase with the trailing dot, and
    // the audit resource id must not vary with the casing the URL carried.
    const zoneName = canonicalZoneName(decodeURIComponent(zoneId));

    if (
      !canActOnZone({
        hasGlobalPermission: globalPermissions.has("zone.delete"),
        grants: zoneGrants,
        serverId: selected.id,
        zoneName,
        permission: "zone.delete",
      })
    ) {
      throw new ForbiddenError("Missing zone.delete for this zone.");
    }

    // ADR-0024: a zone with GSLB-managed names can't be deleted from under
    // them - the PowerGSLB rows and the app's restore snapshots would be
    // stranded. A GSLB zone row without records only remembers the subzone;
    // it is dropped after the delete below.
    const gslbZone = await findGslbZone(horizonScopeFor(selected), canonicalName(zoneName));
    if (gslbZone) {
      const managed = await listGslbRecordsForZone(gslbZone.id);
      if (managed.length > 0) {
        throw new ConflictError(
          `GSLB is on for ${managed.length} record${managed.length === 1 ? "" : "s"} in this zone. Switch GSLB off for ${managed.length === 1 ? "it" : "them"} first.`,
        );
      }
    }

    // Snapshot for the audit before-state. Capture the zone meta and
    // a record count - full rrsets are too large for the audit row and
    // the operator has the download for forensics anyway.
    const before = await client.getZone(zoneName).catch(() => null);

    try {
      await client.deleteZone(zoneName);
    } catch (err) {
      if (err instanceof PdnsNotFoundError) {
        throw new NotFoundError("Zone not found on backend.");
      }
      if (err instanceof PdnsError) {
        const message = redact(err.message);
        logger.warn({ err: message }, "pdns.zone.delete.failed");
        return Response.json({ error: `PDNS rejected the request: ${message}` }, { status: 502 });
      }
      throw err;
    }

    if (gslbZone) {
      // The zone (and with it the delegation) is gone; drop the PowerGSLB
      // domain and the app's GSLB setup row too, so the backend can be
      // deleted later. A PowerGSLB failure is logged, never fails the delete.
      const backend = await findGslbBackendById(gslbZone.backendId);
      try {
        await removeGslbDomain({
          backendId: gslbZone.backendId,
          client: backend ? getGslbClientForRow(backend) : null,
          subzone: gslbZone.subzone,
          nameserverHost: null,
          parent: null,
          ownsNoRecords: () => Promise.resolve(true),
          persist: async (removal) => {
            await deleteGslbZoneRow(gslbZone.id);
            if (removal.remoteLeftover) {
              logger.warn(
                { zone: zoneName, leftover: removal.remoteLeftover },
                "gslb.zone.unbind.remote-leftover",
              );
            }
          },
        });
      } catch (err) {
        logger.warn(
          { zone: zoneName, error: err instanceof Error ? err.message : "unknown" },
          "gslb.zone.unbind.failed",
        );
      }
    }

    // Drop the horizon classification with the zone. Left behind, it would
    // silently re-apply to a zone of the same name recreated later on this
    // backend. Best-effort: the zone is already gone on PDNS, and a stale row
    // classifies nothing until such a recreate.
    try {
      await deleteZoneHorizon(horizonScopeFor(selected), zoneName);
    } catch (err) {
      logger.warn(
        {
          server: selected.slug,
          zone: zoneName,
          error: err instanceof Error ? redact(err.message) : "unknown",
        },
        "zone.delete.horizon-cleanup.failed",
      );
    }

    const hdrs = await headers();
    await appendAudit({
      actor: { type: "user", id: actor.id },
      action: "zone.delete",
      resource: { type: "zone", id: `${selected.slug}:${zoneName}` },
      before: before
        ? {
            name: before.name,
            kind: before.kind,
            serial: before.serial,
            rrsetCount: (before.rrsets ?? []).length,
          }
        : null,
      after: null,
      request: getRequestContext(hdrs),
    });

    publishZoneEvent({
      type: "zone.updated",
      zone: zoneName,
      serverSlug: selected.slug,
      actor: actor.email,
      at: new Date().toISOString(),
    });
    scheduleImmediatePoll();

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return Response.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message, details: err.details }, { status: 400 });
    }
    logger.error(
      { err: err instanceof Error ? err.message : "unknown" },
      "pdns.zone.delete.route.error",
    );
    return Response.json({ error: "Internal error." }, { status: 500 });
  }
}
