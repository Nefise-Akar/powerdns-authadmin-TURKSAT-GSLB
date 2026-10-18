/**
 * app/api/admin/gslb-backends/[id]/regions/route.ts
 *
 * GET  - the backend's regions with their PowerGSLB drift state (gslb.manage).
 * POST - add a region and push it as the owned view `authadmin:<slug>`
 *        (gslb.manage). If PowerGSLB refuses, the region is not kept.
 */

import { headers } from "next/headers";
import { ZodError } from "zod";
import { appendAudit } from "@/lib/audit/log";
import { getRequestContext } from "@/lib/client-ip";
import { requireUser } from "@/lib/auth/require-user";
import { requireCsrf } from "@/lib/auth/csrf";
import { findGslbBackendById } from "@/lib/db/repositories/gslb-backends";
import {
  deleteGslbRegion,
  insertGslbRegion,
  listGslbRegions,
} from "@/lib/db/repositories/gslb-regions";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import { createRegionSynced } from "@/lib/gslb/region-sync";
import { createGslbRegionSchema } from "@/lib/validators/gslb-regions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { loadRegionOverview } from "@/app/(app)/admin/gslb/_lib/region-overview";
import {
  assertRegionRulesUnique,
  gslbRegionAuditSnapshot,
  gslbRouteErrorResponse,
  loadWritableGslbBackend,
} from "../../_shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CONTEXT = "admin.gslb-regions.route.error";

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireUser({ can: "gslb.manage" });
    const { id } = await context.params;
    const backend = await findGslbBackendById(id);
    if (!backend) throw new NotFoundError("GSLB backend not found.");
    return Response.json(await loadRegionOverview(backend), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err, CONTEXT);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { user } = await requireUser({ can: "gslb.manage" });
    await requireCsrf(request);
    const { id } = await context.params;
    const backend = await loadWritableGslbBackend(id);

    let input;
    try {
      input = createGslbRegionSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError("Invalid input.", { fieldErrors: err.flatten().fieldErrors });
      }
      throw err;
    }

    // Pre-checked for a readable error; the (backend_id, slug) unique index
    // still guards the race, and region writes are serialized per backend.
    if ((await listGslbRegions(backend.id)).some((r) => r.slug === input.slug)) {
      throw new ConflictError(`A region with slug "${input.slug}" already exists.`);
    }
    await assertRegionRulesUnique(backend.id, input.rules);

    const { row } = await createRegionSynced({
      backendId: backend.id,
      client: getGslbClientForRow(backend),
      insertLocal: () =>
        insertGslbRegion({
          backendId: backend.id,
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          rules: input.rules,
          createdBy: user.id,
        }),
      removeLocal: (created) => deleteGslbRegion(created.id),
    });

    // Audited once both sides hold the region; a create rolled back after a
    // PowerGSLB refusal leaves no trace to audit.
    await appendAudit({
      actor: { type: "user", id: user.id },
      action: "gslb.region.create",
      resource: { type: "gslb_region", id: row.id },
      after: gslbRegionAuditSnapshot(row),
      request: getRequestContext(await headers()),
    });

    return Response.json({ region: row }, { status: 201 });
  } catch (err) {
    return gslbRouteErrorResponse(err, CONTEXT);
  }
}
