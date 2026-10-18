/**
 * app/api/admin/gslb-backends/route.ts
 *
 * GET  - list every PowerGSLB backend connection (gslb.manage).
 * POST - add one (gslb.manage). The service-account password is encrypted
 *        before insert and never returned over the wire.
 *
 * Reads need `gslb.manage` too: the list exposes the service-account user and
 * the admin API location, which is only useful to whoever manages them.
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
  findGslbBackendBySlug,
  insertGslbBackend,
  listAllGslbBackends,
} from "@/lib/db/repositories/gslb-backends";
import { GSLB_PASSWORD_USAGE } from "@/lib/gslb/registry";
import { assertSafeGslbUrl } from "@/lib/gslb/url-safety";
import { createGslbBackendSchema } from "@/lib/validators/gslb-backends";
import { ConflictError, ValidationError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { gslbBackendAuditSnapshot, toPublicGslbBackend } from "./_shared";

export async function GET(): Promise<Response> {
  try {
    await requireUser({ can: "gslb.manage" });
    const rows = await listAllGslbBackends();
    return Response.json(
      { backends: rows.map(toPublicGslbBackend) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, "admin.gslb-backends.route.error");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { user } = await requireUser({ can: "gslb.manage" });
    await requireCsrf(request);

    let input;
    try {
      input = createGslbBackendSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError("Invalid input.", {
          fieldErrors: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    if (await findGslbBackendBySlug(input.slug)) {
      throw new ConflictError(`A GSLB backend with slug "${input.slug}" already exists.`);
    }

    // SSRF guard before persisting: the URL is fetched server-side with the
    // service-account password attached.
    await assertSafeGslbUrl(input.baseUrl);

    const passwordEncrypted = encrypt(input.password, GSLB_PASSWORD_USAGE);

    const hdrs = await headers();
    const row = await db.transaction(async (tx) => {
      const created = await insertGslbBackend(
        {
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          baseUrl: input.baseUrl,
          username: input.username,
          passwordEncrypted,
          nameserverHost: input.nameserverHost ?? null,
          nameserverAddresses: input.nameserverAddresses ?? null,
          enabled: input.enabled,
          createdBy: user.id,
        },
        tx,
      );

      await appendAudit(
        {
          actor: { type: "user", id: user.id },
          action: "gslb.backend.create",
          resource: { type: "gslb_backend", id: created.id },
          after: gslbBackendAuditSnapshot(created),
          request: getRequestContext(hdrs),
        },
        tx,
      );

      return created;
    });

    return Response.json({ backend: toPublicGslbBackend(row) }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "admin.gslb-backends.route.error");
  }
}
