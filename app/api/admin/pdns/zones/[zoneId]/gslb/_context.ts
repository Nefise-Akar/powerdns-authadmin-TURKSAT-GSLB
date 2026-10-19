/**
 * app/api/admin/pdns/zones/[zoneId]/gslb/_context.ts
 *
 * Shared plumbing for the per-record GSLB routes: backend resolution, the
 * permission rule, zone scope, audit snapshots and the ADR-0010 check.
 *
 * Permission (ADR-0024 §9): switching GSLB on/off or editing it rewrites the
 * name's RRsets, so it needs `record.create`, `record.update` AND
 * `record.delete` on this zone - the same zone-scoped grants (global role or
 * zone_grant) the RRset PATCH route checks. `gslb.manage` is not involved.
 */

import "server-only";
import { requireCsrf } from "@/lib/auth/csrf";
import { requireUser } from "@/lib/auth/require-user";
import { findDefaultPdnsServer, findPdnsServerBySlug } from "@/lib/db/repositories/pdns-servers";
import { horizonScopeFor } from "@/lib/db/repositories/zone-horizons";
import type { GslbRecordRow, PdnsServer } from "@/lib/db/schema";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { decodeMode } from "@/lib/gslb/model";
import { canonicalName, type ZoneRRset } from "@/lib/gslb/record-plan";
import { GslbPlanError } from "@/lib/gslb/record-sync";
import { normalizeZoneId } from "@/lib/pdns/client";
import { rrsetHash } from "@/lib/pdns/rrset-hash";
import { canActOnZone } from "@/lib/rbac/zone-permissions";

export const GSLB_RECORD_PERMISSIONS = ["record.create", "record.update", "record.delete"] as const;

export interface GslbRouteContext {
  user: { id: string; email: string };
  server: PdnsServer;
  zoneName: string;
  scope: ReturnType<typeof horizonScopeFor>;
}

/**
 * Authenticate, resolve the backend and enforce the record permissions.
 *
 * Auth runs before the body is validated, so a bad request from an
 * unauthenticated caller still answers 401, not 400.
 *
 * @throws {ValidationError} unknown/disabled backend.
 * @throws {ForbiddenError} missing any of the three record permissions.
 */
export async function resolveGslbRouteContext(
  request: Request,
  zoneParam: string,
  serverSlug: unknown,
): Promise<GslbRouteContext> {
  const { user, globalPermissions, zoneGrants } = await requireUser();
  await requireCsrf(request);
  const zoneName = normalizeZoneId(decodeURIComponent(zoneParam));
  // The body is validated after auth; only a string slug is looked up here.
  const server =
    typeof serverSlug === "string" && serverSlug !== ""
      ? await findPdnsServerBySlug(serverSlug)
      : await findDefaultPdnsServer();
  if (server?.disabledAt !== null) {
    throw new ValidationError("Unknown or disabled PowerDNS backend.");
  }
  for (const permission of GSLB_RECORD_PERMISSIONS) {
    const allowed = canActOnZone({
      hasGlobalPermission: globalPermissions.has(permission),
      grants: zoneGrants,
      serverId: server.id,
      zoneName,
      permission,
    });
    if (!allowed) {
      throw new ForbiddenError(
        "Switching GSLB needs record.create, record.update and record.delete on this zone.",
      );
    }
  }
  return {
    user: { id: user.id, email: user.email },
    server,
    zoneName,
    scope: horizonScopeFor(server),
  };
}

/** Owner name from the request: absolute, relative to the zone, or `@`. */
export function ownerName(raw: string, zoneName: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "" || trimmed === "@") return zoneName;
  if (trimmed.endsWith(".")) return trimmed;
  return canonicalName(`${trimmed}.${zoneName}`);
}

/**
 * ADR-0010 for a GSLB switch: the RRsets at the name must hash exactly as the
 * operator saw them - same types, same content - or the switch would capture
 * (and later restore) a state they never reviewed.
 */
export function expectedRRsetGuard(
  expected: ReadonlyArray<{ type: string; hash: string }>,
): (liveAtName: readonly ZoneRRset[]) => void {
  return (liveAtName) => {
    const live = liveAtName.filter((rr) => ["A", "AAAA", "CNAME"].includes(rr.type.toUpperCase()));
    const changed =
      live.length !== expected.length ||
      live.some((rr) => {
        const want = expected.find((e) => e.type === rr.type.toUpperCase());
        return want?.hash !== rrsetHash(rr);
      });
    if (changed) {
      throw new GslbPlanError(
        "This record changed since the page was loaded. Reload the zone and try again.",
      );
    }
  };
}

/** Before/after shape for `gslb.record.*` audit rows - settings only, no secrets. */
export function gslbRecordAuditSnapshot(
  row: Pick<GslbRecordRow, "name" | "kind" | "backendId" | "mode" | "monitor" | "ttl" | "members">,
) {
  // Legacy rows (failover/distribute) are shown as the method they behave as.
  const decoded = decodeMode(row.mode, row.members);
  return {
    name: row.name,
    kind: row.kind,
    backendId: row.backendId,
    method: decoded.method,
    persistence: decoded.persistence,
    monitor: row.monitor,
    ttl: row.ttl,
    members: decoded.members,
  };
}
