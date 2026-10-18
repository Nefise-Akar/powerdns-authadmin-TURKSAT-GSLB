/**
 * app/api/admin/gslb-backends/_shared.ts
 *
 * Wire + audit shapes and error mapping shared by the GSLB backend and region
 * routes. Backend shapes drop the password envelope entirely - not just redact
 * it - so neither the browser nor an audit snapshot ever holds even the
 * ciphertext.
 */

import type { GslbBackend, GslbRegion } from "@/lib/db/schema";
import { GslbError, gslbFailureHint } from "@/lib/gslb/errors";
import { GslbSetupError } from "@/lib/gslb/objects";
import { GslbPlanError } from "@/lib/gslb/record-sync";
import { GslbRuleConflictError, GslbViewInUseError, ownedViewName } from "@/lib/gslb/views";
import { findGslbBackendById } from "@/lib/db/repositories/gslb-backends";
import { listGslbRegions } from "@/lib/db/repositories/gslb-regions";
import { canonicalRule } from "@/lib/validators/gslb-region-rules";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { logger } from "@/lib/logger";

export type PublicGslbBackend = Omit<GslbBackend, "passwordEncrypted">;

export function toPublicGslbBackend(row: GslbBackend): PublicGslbBackend {
  const { passwordEncrypted: _omit, ...rest } = row;
  return rest;
}

export function gslbBackendAuditSnapshot(row: GslbBackend) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    baseUrl: row.baseUrl,
    username: row.username,
    nameserverHost: row.nameserverHost,
    nameserverAddresses: row.nameserverAddresses,
    enabled: row.enabled,
  };
}

export function gslbRegionAuditSnapshot(row: GslbRegion) {
  return {
    id: row.id,
    backendId: row.backendId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    rules: row.rules,
    view: ownedViewName(row.slug),
  };
}

/**
 * Route error mapping for anything that talks to PowerGSLB. The two
 * pre-checked refusals become 409s an operator can act on; any other
 * PowerGSLB failure is a 502 naming the failure class. The upstream message
 * is included only for `upstream` (PowerGSLB's own validation text) - the
 * transport detail of other kinds stays in the server log.
 */
export function gslbRouteErrorResponse(err: unknown, context: string): Response {
  if (err instanceof GslbViewInUseError) {
    return errorResponse(
      new ConflictError(
        `Region is in use by ${err.recordCount} GSLB record${err.recordCount === 1 ? "" : "s"}. Switch GSLB off for those records first.`,
      ),
      context,
    );
  }
  if (err instanceof GslbRuleConflictError) {
    return errorResponse(
      new ConflictError(
        `PowerGSLB view "${err.conflictingView}" already has exactly these rules, and PowerGSLB requires every view rule to be unique.`,
      ),
      context,
    );
  }
  if (err instanceof GslbPlanError || err instanceof GslbSetupError) {
    return errorResponse(new ConflictError(err.message), context);
  }
  if (err instanceof GslbError) {
    logger.warn({ kind: err.kind, status: err.status, error: err.message }, context);
    const detail = err.kind === "upstream" ? ` ${err.message}` : "";
    return Response.json(
      {
        error: `PowerGSLB request failed (${err.kind}): ${gslbFailureHint(err.kind)}${detail}`,
        kind: err.kind,
      },
      { status: 502 },
    );
  }
  return errorResponse(err, context);
}

/**
 * Load a backend for a region write. Disabled backends are refused: "disabled"
 * means the panel stops writing to that PowerGSLB.
 *
 * @throws {NotFoundError} when the backend doesn't exist.
 * @throws {ConflictError} when it is disabled.
 */
export async function loadWritableGslbBackend(id: string): Promise<GslbBackend> {
  const backend = await findGslbBackendById(id);
  if (!backend) throw new NotFoundError("GSLB backend not found.");
  if (!backend.enabled) {
    throw new ConflictError("This GSLB backend is disabled. Enable it to change its regions.");
  }
  return backend;
}

/**
 * PowerGSLB keeps view rules unique, so two regions of one backend can't share
 * identical rules. Checked here to name the clashing region.
 *
 * @throws {ConflictError}
 */
export async function assertRegionRulesUnique(
  backendId: string,
  rules: readonly string[],
  exceptRegionId?: string,
): Promise<void> {
  const rule = canonicalRule(rules.join(" "));
  const clash = (await listGslbRegions(backendId)).find(
    (r) => r.id !== exceptRegionId && canonicalRule(r.rules.join(" ")) === rule,
  );
  if (clash) {
    throw new ConflictError(
      `Region "${clash.name}" already has exactly these rules. PowerGSLB requires every view rule to be unique.`,
    );
  }
}
