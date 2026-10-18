/**
 * app/api/admin/gslb-backends/[id]/regions/[regionId]/route.ts
 *
 * GET    - one region (gslb.manage).
 * PATCH  - rename / redescribe / change rules (gslb.manage). Rule changes go
 *          to PowerGSLB first, then the DB.
 * DELETE - remove the region (gslb.manage). PowerGSLB first; refused with 409
 *          while GSLB records still use its view.
 */

import { headers } from "next/headers";
import { ZodError } from "zod";
import { appendAudit } from "@/lib/audit/log";
import { getRequestContext } from "@/lib/client-ip";
import { requireUser } from "@/lib/auth/require-user";
import { requireCsrf } from "@/lib/auth/csrf";
import { db } from "@/lib/db";
import { findGslbBackendById } from "@/lib/db/repositories/gslb-backends";
import {
  deleteGslbRegion,
  findGslbRegion,
  updateGslbRegion,
} from "@/lib/db/repositories/gslb-regions";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import { deleteRegionSynced, updateRegionSynced } from "@/lib/gslb/region-sync";
import { updateGslbRegionSchema } from "@/lib/validators/gslb-regions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import {
  assertRegionRulesUnique,
  gslbRegionAuditSnapshot,
  gslbRouteErrorResponse,
  loadWritableGslbBackend,
} from "../../../_shared";

interface RouteContext {
  params: Promise<{ id: string; regionId: string }>;
}

const CONTEXT = "admin.gslb-regions.id.route.error";

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireUser({ can: "gslb.manage" });
    const { id, regionId } = await context.params;
    if (!(await findGslbBackendById(id))) throw new NotFoundError("GSLB backend not found.");
    const region = await findGslbRegion(id, regionId);
    if (!region) throw new NotFoundError("Region not found.");
    return Response.json({ region }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, CONTEXT);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { user } = await requireUser({ can: "gslb.manage" });
    await requireCsrf(request);
    const { id, regionId } = await context.params;
    const backend = await loadWritableGslbBackend(id);
    const existing = await findGslbRegion(backend.id, regionId);
    if (!existing) throw new NotFoundError("Region not found.");

    let input;
    try {
      input = updateGslbRegionSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError("Invalid input.", { fieldErrors: err.flatten().fieldErrors });
      }
      throw err;
    }

    const patch: Parameters<typeof updateGslbRegion>[1] = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.rules !== undefined) {
      await assertRegionRulesUnique(backend.id, input.rules, existing.id);
      patch.rules = input.rules;
    }

    const hdrs = await headers();
    const persist = () =>
      db.transaction(async (tx) => {
        const row = await updateGslbRegion(existing.id, patch, tx);
        if (!row) throw new NotFoundError("Region not found.");
        await appendAudit(
          {
            actor: { type: "user", id: user.id },
            action: "gslb.region.update",
            resource: { type: "gslb_region", id: existing.id },
            before: gslbRegionAuditSnapshot(existing),
            after: gslbRegionAuditSnapshot(row),
            request: getRequestContext(hdrs),
          },
          tx,
        );
        return row;
      });

    // Name / description live only in the DB; only a rule change needs
    // PowerGSLB, so an unreachable backend doesn't block a rename.
    const updated =
      patch.rules !== undefined
        ? (
            await updateRegionSynced({
              backendId: backend.id,
              client: getGslbClientForRow(backend),
              next: { slug: existing.slug, rules: patch.rules },
              updateLocal: persist,
            })
          ).row
        : await persist();

    return Response.json({ region: updated });
  } catch (err) {
    return gslbRouteErrorResponse(err, CONTEXT);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { user } = await requireUser({ can: "gslb.manage" });
    await requireCsrf(request);
    const { id, regionId } = await context.params;
    const backend = await loadWritableGslbBackend(id);
    const existing = await findGslbRegion(backend.id, regionId);
    if (!existing) throw new NotFoundError("Region not found.");

    const hdrs = await headers();
    const { remoteDeleted } = await deleteRegionSynced({
      backendId: backend.id,
      client: getGslbClientForRow(backend),
      region: existing,
      deleteLocal: () =>
        db.transaction(async (tx) => {
          await deleteGslbRegion(existing.id, tx);
          await appendAudit(
            {
              actor: { type: "user", id: user.id },
              action: "gslb.region.delete",
              resource: { type: "gslb_region", id: existing.id },
              before: gslbRegionAuditSnapshot(existing),
              request: getRequestContext(hdrs),
            },
            tx,
          );
        }),
    });

    return Response.json({ ok: true, remoteDeleted });
  } catch (err) {
    return gslbRouteErrorResponse(err, CONTEXT);
  }
}
