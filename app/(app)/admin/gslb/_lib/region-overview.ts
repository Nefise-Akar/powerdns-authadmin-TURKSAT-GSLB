/**
 * app/(app)/admin/gslb/_lib/region-overview.ts
 *
 * Regions of one backend joined with their PowerGSLB drift state. Shared by
 * the backend detail page and `GET /api/admin/gslb-backends/[id]/regions`.
 * Read-only: the drift check never writes - Resync is an explicit operator
 * action.
 */

import "server-only";
import type { GslbBackend } from "@/lib/db/schema";
import { listGslbRegions } from "@/lib/db/repositories/gslb-regions";
import { GslbError, gslbFailureHint } from "@/lib/gslb/errors";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import { computeRegionDrift, listOwnedViews, ownedViewName } from "@/lib/gslb/views";
import { logger } from "@/lib/logger";

export type RegionOverviewStatus = "in-sync" | "missing" | "rule-differs" | "unknown";

export interface RegionOverviewRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rules: string[];
  view: string;
  status: RegionOverviewStatus;
  remoteRule: string | null;
}

export interface RegionOverview {
  regions: RegionOverviewRow[];
  /** Owned views (`authadmin:` prefix) with no region row. */
  orphans: Array<{ view: string; rule: string }>;
  /** Set when PowerGSLB couldn't be read; every status is then `unknown`. */
  remoteError: string | null;
}

export async function loadRegionOverview(backend: GslbBackend): Promise<RegionOverview> {
  const regions = await listGslbRegions(backend.id);

  let drift: ReturnType<typeof computeRegionDrift> | null = null;
  let remoteError: string | null = null;
  try {
    const views = await listOwnedViews(getGslbClientForRow(backend, { probe: true }));
    drift = computeRegionDrift(regions, views);
  } catch (err) {
    if (!(err instanceof GslbError)) throw err;
    logger.warn(
      { gslbBackend: backend.slug, kind: err.kind, error: err.message },
      "gslb.regions.drift.failed",
    );
    remoteError = gslbFailureHint(err.kind);
  }

  const byId = new Map(drift?.regions.map((d) => [d.regionId, d]) ?? []);
  return {
    regions: regions.map((r) => {
      const d = byId.get(r.id);
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        rules: r.rules,
        view: ownedViewName(r.slug),
        status: d?.status ?? "unknown",
        remoteRule: d?.remoteRule ?? null,
      };
    }),
    orphans: drift?.orphans.map((v) => ({ view: v.view, rule: v.rule })) ?? [],
    remoteError,
  };
}
