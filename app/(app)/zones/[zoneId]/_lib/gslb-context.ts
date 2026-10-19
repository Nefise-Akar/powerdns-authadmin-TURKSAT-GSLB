/**
 * app/(app)/zones/[zoneId]/_lib/gslb-context.ts
 *
 * Server-side data for the record table's GSLB column (ADR-0024 §3, §8):
 * per-name eligibility, the ADR-0010 hashes the enable call must echo, the
 * managed names with live member health, the backends' regions (with rules,
 * for auto-region), last-used presets, the delegation RRsets to lock, and
 * whether the zone's GSLB setup can be removed (no GSLB records left).
 *
 * Health comes from one read of this zone's rows of PowerGSLB's `status`
 * table (filtered to `gslb.<zone>`) through the
 * fast-fail probe client; if PowerGSLB is unreachable the page still renders
 * and members show "status unavailable". Returns `null` when GSLB can't apply
 * here (no enabled backend and no GSLB setup), so the column doesn't render.
 */

import "server-only";
import { listAllGslbBackends } from "@/lib/db/repositories/gslb-backends";
import {
  findGslbZone,
  listGslbRecordPresets,
  listGslbRecordsForZone,
} from "@/lib/db/repositories/gslb-records";
import { listGslbRegions } from "@/lib/db/repositories/gslb-regions";
import { horizonScopeFor } from "@/lib/db/repositories/zone-horizons";
import type { GslbBackend, PdnsServer } from "@/lib/db/schema";
import { GslbError, gslbFailureHint } from "@/lib/gslb/errors";
import {
  decodeMode,
  type GslbBalancing,
  type GslbMember,
  type GslbMonitorConfig,
  type GslbRecordKind,
  type GslbRecordPreset,
} from "@/lib/gslb/model";
import { readDomainStatus, type MemberState } from "@/lib/gslb/objects";
import {
  canonicalName,
  delegationRRsetKeys,
  gslbDomainFor,
  gslbEligibility,
  recordTarget,
  statusKey,
  type GslbTarget,
  type ZoneRRset,
} from "@/lib/gslb/record-plan";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import { logger } from "@/lib/logger";
import { rrsetHash } from "@/lib/pdns/rrset-hash";

export interface GslbMemberView {
  content: string;
  region: string | null;
  regionName: string | null;
  weight: number;
  state: MemberState | null;
}

export interface GslbRecordView extends GslbBalancing {
  name: string;
  kind: GslbRecordKind;
  monitor: GslbMonitorConfig;
  ttl: number;
  members: GslbMemberView[];
}

export type GslbNameEligibility =
  | { eligible: true; kind: GslbRecordKind }
  | { eligible: false; reason: string };

export interface GslbRegionOption {
  slug: string;
  name: string;
  /** Normalized rule tokens - CIDRs drive the member auto-region. */
  rules: string[];
}

export interface GslbBackendOption {
  id: string;
  name: string;
  /** Nameserver host + addresses set - required for a zone's first GSLB record. */
  nameserverReady: boolean;
  regions: GslbRegionOption[];
}

export interface GslbTableContext {
  /** Backends the dialog may use: the zone's own, or every enabled one for a new zone. */
  backends: GslbBackendOption[];
  /** Set once GSLB is set up in this zone - later records must use the same backend. */
  zoneBackendId: string | null;
  eligibility: Record<string, GslbNameEligibility>;
  expected: Record<string, Array<{ type: string; hash: string }>>;
  records: Record<string, GslbRecordView>;
  /** `${name}|${type}` of delegation RRsets GSLB owns in this zone. */
  delegationKeys: string[];
  statusError: string | null;
  /** record.create + record.update + record.delete on this zone. */
  canToggle: boolean;
  /** Last settings of names GSLB was switched off for - offered, never applied. */
  presets: Record<string, GslbRecordPreset>;
  /**
   * The zone has a GSLB setup (subzone + delegation) but no GSLB records -
   * it can be torn down from the records tab.
   */
  setupRemovable: { subzone: string } | null;
}

const GSLB_TYPES = new Set(["A", "AAAA", "CNAME"]);

function memberViews(
  members: readonly GslbMember[],
  target: GslbTarget,
  regionNames: ReadonlyMap<string, string>,
  states: ReadonlyMap<string, MemberState> | null,
): GslbMemberView[] {
  return members.map((m) => ({
    content: m.content,
    region: m.region,
    weight: m.weight,
    regionName: m.region ? (regionNames.get(m.region) ?? m.region) : null,
    state: states ? (states.get(statusKey(target, m.content)) ?? null) : null,
  }));
}

async function backendStates(
  backend: GslbBackend,
  zoneName: string,
): Promise<{ states: Map<string, MemberState> | null; error: string | null }> {
  try {
    return {
      states: await readDomainStatus(
        getGslbClientForRow(backend, { probe: true }),
        gslbDomainFor(zoneName),
      ),
      error: null,
    };
  } catch (err) {
    if (!(err instanceof GslbError)) throw err;
    logger.warn({ zone: zoneName, kind: err.kind, error: err.message }, "gslb.zone.status.failed");
    return { states: null, error: gslbFailureHint(err.kind) };
  }
}

export async function loadGslbTableContext(args: {
  server: PdnsServer;
  zoneName: string;
  rrsets: readonly ZoneRRset[];
  canToggle: boolean;
}): Promise<GslbTableContext | null> {
  const zoneName = canonicalName(args.zoneName);
  const scope = horizonScopeFor(args.server);
  const [allBackends, gslbZone] = await Promise.all([
    listAllGslbBackends(),
    findGslbZone(scope, zoneName),
  ]);
  const zoneBackend = gslbZone
    ? (allBackends.find((b) => b.id === gslbZone.backendId) ?? null)
    : null;
  const usable = zoneBackend ? [zoneBackend] : allBackends.filter((b) => b.enabled);
  if (usable.length === 0 && !gslbZone) return null;

  const records = gslbZone ? await listGslbRecordsForZone(gslbZone.id) : [];
  const [regionsByBackend, presetMap, status] = await Promise.all([
    Promise.all(usable.map((b) => listGslbRegions(b.id))),
    listGslbRecordPresets(scope, zoneName),
    zoneBackend && records.length > 0
      ? backendStates(zoneBackend, zoneName)
      : Promise.resolve({ states: null, error: null }),
  ]);
  const regionNames = new Map(regionsByBackend.flat().map((r) => [r.slug, r.name] as const));

  const backends: GslbBackendOption[] = usable.map((b, i) => ({
    id: b.id,
    name: b.name,
    nameserverReady: Boolean(b.nameserverHost) && (b.nameserverAddresses?.length ?? 0) > 0,
    regions: (regionsByBackend[i] ?? []).map((r) => ({
      slug: r.slug,
      name: r.name,
      rules: r.rules,
    })),
  }));

  const managed = new Set(records.map((r) => r.name));
  const eligibility: Record<string, GslbNameEligibility> = {};
  const expected: Record<string, Array<{ type: string; hash: string }>> = {};
  const names = new Set(
    args.rrsets
      .filter((rr) => GSLB_TYPES.has(rr.type.toUpperCase()))
      .map((rr) => canonicalName(rr.name)),
  );
  for (const name of names) {
    if (managed.has(name)) continue;
    const verdict = gslbEligibility(args.rrsets, zoneName, name);
    eligibility[name] = verdict.eligible ? { eligible: true, kind: verdict.kind } : verdict;
    if (verdict.eligible) {
      expected[name] = args.rrsets
        .filter((rr) => canonicalName(rr.name) === name && GSLB_TYPES.has(rr.type.toUpperCase()))
        .map((rr) => ({ type: rr.type.toUpperCase(), hash: rrsetHash(rr) }));
    }
  }

  const recordViews: Record<string, GslbRecordView> = {};
  for (const record of records) {
    // Legacy failover/distribute rows are shown as the method they behave as,
    // members in priority order.
    const balancing = decodeMode(record.mode, record.members);
    recordViews[record.name] = {
      name: record.name,
      kind: record.kind,
      method: balancing.method,
      persistence: balancing.persistence,
      monitor: record.monitor,
      ttl: record.ttl,
      members: memberViews(
        balancing.members,
        recordTarget(record.name, zoneName),
        regionNames,
        status.states,
      ),
    };
  }

  return {
    backends,
    zoneBackendId: zoneBackend?.id ?? null,
    eligibility,
    expected,
    records: recordViews,
    delegationKeys: gslbZone
      ? delegationRRsetKeys(gslbZone.subzone, zoneBackend?.nameserverHost ?? null)
      : [],
    statusError: status.error,
    canToggle: args.canToggle,
    presets: Object.fromEntries(
      [...presetMap].filter(([name]) => eligibility[name]?.eligible === true),
    ),
    setupRemovable: gslbZone && records.length === 0 ? { subzone: gslbZone.subzone } : null,
  };
}
