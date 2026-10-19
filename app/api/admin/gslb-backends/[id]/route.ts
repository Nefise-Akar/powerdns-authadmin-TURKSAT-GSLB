/**
 * app/api/admin/gslb-backends/[id]/route.ts
 *
 * GET    - one backend connection (gslb.manage), without the password.
 * PATCH  - update it (gslb.manage). The password rotates only when a
 *          non-blank value is sent. The nameserver host/addresses are frozen
 *          while any zone is delegated to them (409 naming the zones).
 * DELETE - remove it (gslb.manage). Hard delete; the audit log keeps history.
 *          Refused while the backend still has regions: each one owns a view
 *          in PowerGSLB, and deleting the connection would strand those views
 *          with nothing left in the panel that knows to clean them up.
 */

import { headers } from "next/headers";
import { ZodError } from "zod";
import { appendAudit } from "@/lib/audit/log";
import { getRequestContext } from "@/lib/client-ip";
import { requireUser } from "@/lib/auth/require-user";
import { requireCsrf } from "@/lib/auth/csrf";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto/encryption";
import {
  deleteGslbBackend,
  findGslbBackendById,
  updateGslbBackend,
} from "@/lib/db/repositories/gslb-backends";
import { listGslbRegions } from "@/lib/db/repositories/gslb-regions";
import { listGslbZonesForBackend } from "@/lib/db/repositories/gslb-records";
import { backendDeleteBlockers, backendNameserverEditBlocker } from "@/lib/gslb/record-plan";
import { GSLB_PASSWORD_USAGE } from "@/lib/gslb/registry";
import { assertSafeGslbUrl } from "@/lib/gslb/url-safety";
import { updateGslbBackendSchema } from "@/lib/validators/gslb-backends";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { gslbBackendAuditSnapshot, toPublicGslbBackend } from "../_shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireUser({ can: "gslb.manage" });
    const { id } = await context.params;
    const row = await findGslbBackendById(id);
    if (!row) throw new NotFoundError("GSLB backend not found.");
    return Response.json(
      { backend: toPublicGslbBackend(row) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, "admin.gslb-backends.id.route.error");
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { user } = await requireUser({ can: "gslb.manage" });
    await requireCsrf(request);
    const { id } = await context.params;

    const existing = await findGslbBackendById(id);
    if (!existing) throw new NotFoundError("GSLB backend not found.");

    let input;
    try {
      input = updateGslbBackendSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError("Invalid input.", {
          fieldErrors: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    if (input.baseUrl !== undefined && input.baseUrl !== existing.baseUrl) {
      await assertSafeGslbUrl(input.baseUrl);
    }

    if (input.nameserverHost !== undefined || input.nameserverAddresses !== undefined) {
      const nameserverBlocker = backendNameserverEditBlocker({
        before: existing,
        after: {
          ...(input.nameserverHost !== undefined ? { nameserverHost: input.nameserverHost } : {}),
          ...(input.nameserverAddresses !== undefined
            ? { nameserverAddresses: input.nameserverAddresses }
            : {}),
        },
        zoneNames: (await listGslbZonesForBackend(id)).map((z) => z.zone.zoneName),
      });
      if (nameserverBlocker) throw new ConflictError(nameserverBlocker);
    }

    const patch: Parameters<typeof updateGslbBackend>[1] = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
    if (input.username !== undefined) patch.username = input.username;
    if (input.password !== undefined) {
      patch.passwordEncrypted = encrypt(input.password, GSLB_PASSWORD_USAGE);
    }
    if (input.nameserverHost !== undefined) patch.nameserverHost = input.nameserverHost;
    if (input.nameserverAddresses !== undefined) {
      patch.nameserverAddresses = input.nameserverAddresses;
    }
    if (input.enabled !== undefined) patch.enabled = input.enabled;

    // The cached Test verdict was measured against the old URL / credentials;
    // showing it next to new ones would claim a connection nobody has tested.
    const connectionChanged =
      (input.baseUrl !== undefined && input.baseUrl !== existing.baseUrl) ||
      (input.username !== undefined && input.username !== existing.username) ||
      input.password !== undefined;
    if (connectionChanged) patch.probeCache = null;

    const hdrs = await headers();
    const updated = await db.transaction(async (tx) => {
      const row = await updateGslbBackend(id, patch, tx);
      if (!row) throw new NotFoundError("GSLB backend not found.");

      await appendAudit(
        {
          actor: { type: "user", id: user.id },
          action: "gslb.backend.update",
          resource: { type: "gslb_backend", id },
          before: gslbBackendAuditSnapshot(existing),
          // A rotation is recorded as a fact, never as a value.
          after: {
            ...gslbBackendAuditSnapshot(row),
            ...(input.password !== undefined ? { passwordRotated: true } : {}),
          },
          request: getRequestContext(hdrs),
        },
        tx,
      );

      return row;
    });

    return Response.json({ backend: toPublicGslbBackend(updated) });
  } catch (err) {
    return errorResponse(err, "admin.gslb-backends.id.route.error");
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { user } = await requireUser({ can: "gslb.manage" });
    await requireCsrf(request);
    const { id } = await context.params;

    const existing = await findGslbBackendById(id);
    if (!existing) throw new NotFoundError("GSLB backend not found.");

    // Everything that still points at this backend, named, with where to
    // remove it - zones/records also hold RESTRICT foreign keys to it.
    const [regions, zones] = await Promise.all([listGslbRegions(id), listGslbZonesForBackend(id)]);
    const blockers = backendDeleteBlockers({
      regions: regions.map((r) => r.name),
      zones: zones.map((z) => ({ zoneName: z.zone.zoneName, records: z.records })),
    });
    if (blockers) throw new ConflictError(blockers);

    const hdrs = await headers();
    await db.transaction(async (tx) => {
      await deleteGslbBackend(id, tx);
      await appendAudit(
        {
          actor: { type: "user", id: user.id },
          action: "gslb.backend.delete",
          resource: { type: "gslb_backend", id },
          before: gslbBackendAuditSnapshot(existing),
          request: getRequestContext(hdrs),
        },
        tx,
      );
    });

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "admin.gslb-backends.id.route.error");
  }
}
