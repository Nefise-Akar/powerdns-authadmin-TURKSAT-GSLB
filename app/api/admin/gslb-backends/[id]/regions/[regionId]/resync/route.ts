/**
 * app/api/admin/gslb-backends/[id]/regions/[regionId]/resync/route.ts
 *
 * POST - rewrite the region's PowerGSLB view from the stored region
 * (gslb.manage). The fix for "missing remotely" / "rule differs" drift; the
 * panel never repairs drift on its own.
 */

import { headers } from "next/headers";
import { appendAudit } from "@/lib/audit/log";
import { getRequestContext } from "@/lib/client-ip";
import { requireUser } from "@/lib/auth/require-user";
import { requireCsrf } from "@/lib/auth/csrf";
import { findGslbRegion } from "@/lib/db/repositories/gslb-regions";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import { resyncRegion } from "@/lib/gslb/region-sync";
import { NotFoundError } from "@/lib/errors";
import {
  gslbRegionAuditSnapshot,
  gslbRouteErrorResponse,
  loadWritableGslbBackend,
} from "../../../../_shared";

interface RouteContext {
  params: Promise<{ id: string; regionId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { user } = await requireUser({ can: "gslb.manage" });
    await requireCsrf(request);
    const { id, regionId } = await context.params;
    const backend = await loadWritableGslbBackend(id);
    const region = await findGslbRegion(backend.id, regionId);
    if (!region) throw new NotFoundError("Region not found.");

    const view = await resyncRegion({
      backendId: backend.id,
      client: getGslbClientForRow(backend),
      region,
    });

    await appendAudit({
      actor: { type: "user", id: user.id },
      action: "gslb.region.resync",
      resource: { type: "gslb_region", id: region.id },
      after: { ...gslbRegionAuditSnapshot(region), remoteViewId: view.recid },
      request: getRequestContext(await headers()),
    });

    return Response.json({ ok: true, view: { name: view.view, rule: view.rule } });
  } catch (err) {
    return gslbRouteErrorResponse(err, "admin.gslb-regions.resync.route.error");
  }
}
