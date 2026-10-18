/**
 * app/api/admin/gslb-backends/[id]/test/route.ts
 *
 * POST - operator-triggered connection probe (gslb.manage). Counts domains,
 * monitors, views and records over the admin API, persists the verdict on the
 * row's `probeCache` (the list renders it) and audits the attempt.
 *
 * Failures come back in-band as `200 { ok: false, kind, hint }` so the UI can
 * show the reason inline; the raw upstream / transport message stays in the
 * server log under the request id. Disabled backends can be tested too - that
 * is how an operator checks one before enabling it.
 */

import { headers } from "next/headers";
import { appendAudit } from "@/lib/audit/log";
import { getRequestContext, getRequestId } from "@/lib/client-ip";
import { requireUser } from "@/lib/auth/require-user";
import { requireCsrf } from "@/lib/auth/csrf";
import { findGslbBackendById, setGslbProbeCache } from "@/lib/db/repositories/gslb-backends";
import type { GslbProbeCache } from "@/lib/db/schema";
import { gslbFailureHint } from "@/lib/gslb/errors";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import { NotFoundError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { logger } from "@/lib/logger";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { user } = await requireUser({ can: "gslb.manage" });
    await requireCsrf(request);
    const { id } = await context.params;
    const hdrs = await headers();
    const requestId = getRequestId(hdrs);

    const backend = await findGslbBackendById(id);
    if (!backend) throw new NotFoundError("GSLB backend not found.");

    const result = await getGslbClientForRow(backend, { probe: true }).probe();
    const fetchedAt = new Date().toISOString();
    const cache: GslbProbeCache = result.ok
      ? { fetchedAt, ok: true, latencyMs: result.latencyMs, counts: result.counts }
      : {
          fetchedAt,
          ok: false,
          reason: result.kind,
          ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
        };
    await setGslbProbeCache(id, cache);

    await appendAudit({
      actor: { type: "user", id: user.id },
      action: "gslb.backend.test",
      resource: { type: "gslb_backend", id },
      after: { probe: cache },
      request: getRequestContext(hdrs),
    });

    if (!result.ok) {
      logger.warn(
        { gslbBackendId: id, kind: result.kind, error: result.message, requestId },
        "gslb.backend.test.failed",
      );
      return Response.json({
        ok: false,
        kind: result.kind,
        hint: gslbFailureHint(result.kind),
        fetchedAt,
        requestId,
      });
    }

    return Response.json({
      ok: true,
      latencyMs: result.latencyMs,
      counts: result.counts,
      fetchedAt,
      requestId,
    });
  } catch (err) {
    return errorResponse(err, "admin.gslb-backends.test.route.error");
  }
}
