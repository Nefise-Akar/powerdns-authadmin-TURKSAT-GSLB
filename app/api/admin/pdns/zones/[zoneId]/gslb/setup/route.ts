/**
 * app/api/admin/pdns/zones/[zoneId]/gslb/setup/route.ts
 *
 * DELETE - remove a zone's GSLB setup (`?serverSlug=`) once no GSLB record
 * uses it (ADR-0024 §3): the `gslb` NS and its glue in the zone (glue kept
 * while another delegation still names that nameserver), then the PowerGSLB
 * domain `gslb.<zone>`, then the app's zone row - which also releases the
 * record-table locks on those RRsets.
 *
 * A PowerGSLB outage does not block this: the zone side and the app row are
 * removed anyway and the leftover domain is reported in the response and the
 * audit row. Same permission as switching GSLB: record.create + update +
 * delete on the zone.
 */

import { headers } from "next/headers";
import { appendAudit } from "@/lib/audit/log";
import { getRequestContext } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { findGslbBackendById } from "@/lib/db/repositories/gslb-backends";
import {
  deleteGslbZoneRow,
  findGslbZone,
  listGslbRecordsForZone,
} from "@/lib/db/repositories/gslb-records";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { removeGslbDomain } from "@/lib/gslb/record-sync";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import { gslbRouteErrorResponse } from "@/app/api/admin/gslb-backends/_shared";
import { resolveGslbRouteContext } from "../_context";
import { parentZonePort } from "../_parent-zone";

interface RouteContext {
  params: Promise<{ zoneId: string }>;
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const ctx = await resolveGslbRouteContext(
      request,
      (await context.params).zoneId,
      url.searchParams.get("serverSlug"),
    );
    const zone = await findGslbZone(ctx.scope, ctx.zoneName);
    if (!zone) throw new NotFoundError("GSLB is not set up for this zone.");
    const remaining = (await listGslbRecordsForZone(zone.id)).length;
    if (remaining > 0) {
      throw new ConflictError(
        `GSLB is still on for ${remaining} record${remaining === 1 ? "" : "s"} in this zone. Switch ${remaining === 1 ? "it" : "them"} off first.`,
      );
    }
    const backend = await findGslbBackendById(zone.backendId);
    if (!backend) throw new NotFoundError("This zone's GSLB backend no longer exists.");
    const reqInfo = getRequestContext(await headers());

    const result = await removeGslbDomain({
      backendId: backend.id,
      client: getGslbClientForRow(backend),
      subzone: zone.subzone,
      nameserverHost: backend.nameserverHost,
      parent: parentZonePort({
        server: ctx.server,
        zoneName: ctx.zoneName,
        actor: ctx.user,
        request: reqInfo,
      }),
      ownsNoRecords: async () => (await listGslbRecordsForZone(zone.id)).length === 0,
      persist: async (removal) => {
        await db.transaction(async (tx) => {
          await deleteGslbZoneRow(zone.id, tx);
          await appendAudit(
            {
              actor: { type: "user", id: ctx.user.id },
              action: "gslb.zone.disable",
              resource: { type: "zone", id: `${ctx.server.slug}:${ctx.zoneName}` },
              before: { zone: ctx.zoneName, subzone: zone.subzone, backendId: backend.id },
              after: {
                parentRRsetsRemoved: removal.parentChanges.map((c) => `${c.name} ${c.type}`),
                remoteLeftover: removal.remoteLeftover,
              },
              request: reqInfo,
            },
            tx,
          );
        });
      },
    });
    return Response.json({ ok: true, remoteLeftover: result.remoteLeftover });
  } catch (err) {
    return gslbRouteErrorResponse(err, "gslb.zone.disable.error");
  }
}
