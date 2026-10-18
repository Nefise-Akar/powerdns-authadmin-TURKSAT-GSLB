/**
 * lib/gslb/record-plan.ts
 *
 * Pure planning for per-record GSLB (ADR-0024 §3, §5): which names may be
 * switched on, what PowerGSLB rows a member list becomes, which monitor and
 * routing objects that needs, and which parent-zone RRset changes enable,
 * delegate and restore a name. No I/O - `record-sync.ts` executes the plans,
 * and every rule here is unit-tested directly.
 *
 * Conventions:
 *   - Parent-zone names are canonical: lowercase with a trailing dot.
 *   - PowerGSLB stores the domain without a trailing dot, the owner as a label
 *     relative to it (`@` for the apex), and NS/CNAME content without a
 *     trailing dot - the same shape as its own seed data.
 */

import { normalizeIpAddress } from "@/lib/validators/gslb-region-rules";
import {
  GSLB_OWNED_PREFIX,
  GSLB_PUBLIC_VIEW,
  GSLB_SUBZONE_LABEL,
  type GslbMember,
  type GslbMode,
  type GslbMonitorConfig,
  type GslbRecordKind,
  type GslbRRsetSnapshot,
} from "./model";

/** An RRset as the PDNS API returns it (only the fields planning reads). */
export interface ZoneRRset {
  name: string;
  type: string;
  ttl: number;
  records: ReadonlyArray<{ content: string; disabled?: boolean }>;
  comments?: unknown;
}

/** One parent-zone change, executed through the normal PDNS write path. */
export type ParentChange =
  | {
      kind: "upsert";
      name: string;
      type: string;
      ttl: number;
      records: Array<{ content: string; disabled: boolean }>;
      /** Undefined keeps whatever comments PDNS has. */
      comments?: Array<Record<string, unknown>>;
    }
  | { kind: "delete"; name: string; type: string };

/** Fields of one PowerGSLB `records` row as `save-record` takes them. */
export interface PlannedRow {
  domain: string;
  name: string;
  name_type: string;
  ttl: number;
  policy: string;
  content: string;
  monitor: string;
  view: string;
  weight: number;
  disabled: number;
}

const ELIGIBLE_TYPES = new Set(["A", "AAAA", "CNAME"]);
const DELEGATION_TTL = 3600;
/** TTL a restored RRset falls back to when the snapshot has none for its type. */
const FALLBACK_RESTORE_TTL = 300;

// =============================================================================
// Names
// =============================================================================

export function canonicalName(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.endsWith(".") ? lower : `${lower}.`;
}

function stripDot(name: string): string {
  return name.endsWith(".") ? name.slice(0, -1) : name;
}

function isAtOrBelow(name: string, ancestor: string): boolean {
  return name === ancestor || name.endsWith(`.${ancestor}`);
}

/** `gslb.<zone>` (canonical). */
export function subzoneFor(zoneName: string): string {
  return `${GSLB_SUBZONE_LABEL}.${canonicalName(zoneName)}`;
}

/** PowerGSLB `domains.domain` for the zone's subzone (no trailing dot). */
export function gslbDomainFor(zoneName: string): string {
  return stripDot(subzoneFor(zoneName));
}

/**
 * Owner label of `name` relative to `zoneName` - the PowerGSLB `name` column
 * (`www.example.com.` in `example.com.` → `www`).
 *
 * @throws {Error} when `name` is not strictly below the zone apex.
 */
export function relativeLabel(name: string, zoneName: string): string {
  const owner = canonicalName(name);
  const zone = canonicalName(zoneName);
  if (owner === zone || !owner.endsWith(`.${zone}`)) {
    throw new Error(`relativeLabel: ${owner} is not below ${zone}`);
  }
  return owner.slice(0, -(zone.length + 1));
}

/** The parent CNAME target for a GSLB-managed name: `<label>.gslb.<zone>`. */
export function gslbTargetFor(name: string, zoneName: string): string {
  return `${relativeLabel(name, zoneName)}.${subzoneFor(zoneName)}`;
}

/**
 * Where a record's GSLB answers live in PowerGSLB: an owner `label` inside a
 * delegated `domain` (canonical, trailing dot) - `<relative name>.gslb.<zone>`.
 */
export interface GslbTarget {
  domain: string;
  label: string;
}

/** The fully-qualified name a parent CNAME points at. */
export function targetName(target: GslbTarget): string {
  return `${target.label}.${canonicalName(target.domain)}`;
}

/** Target of a GSLB-managed record. */
export function recordTarget(name: string, zoneName: string): GslbTarget {
  return { domain: subzoneFor(zoneName), label: relativeLabel(name, zoneName) };
}

export function regionViewName(regionSlug: string): string {
  return `${GSLB_OWNED_PREFIX}${regionSlug}`;
}

// =============================================================================
// Eligibility
// =============================================================================

export type GslbEligibility =
  | { eligible: true; kind: GslbRecordKind; types: string[] }
  | { eligible: false; reason: string };

/** "an" before letters whose name starts with a vowel sound (an MX, an NS, a TXT). */
function withArticle(type: string): string {
  return `${"AEFHILMNORSX".includes(type[0] ?? "") ? "an" : "a"} ${type}`;
}

/**
 * Can GSLB be switched on for `name`? A/AAAA (moving together) or a lone
 * CNAME, below the apex, with no other RRset at the owner - the parent CNAME
 * that replaces them can't coexist with anything else. The reason is
 * operator-facing and shown next to the disabled switch.
 */
export function gslbEligibility(
  rrsets: readonly ZoneRRset[],
  zoneName: string,
  name: string,
): GslbEligibility {
  const zone = canonicalName(zoneName);
  const owner = canonicalName(name);
  const subzone = subzoneFor(zone);

  if (owner === zone) return { eligible: false, reason: "The zone apex can't be GSLB-balanced." };
  if (!owner.endsWith(`.${zone}`)) {
    return { eligible: false, reason: "This name is outside the zone." };
  }
  if (owner.split(".").includes("*")) {
    return { eligible: false, reason: "Wildcard names can't be GSLB-balanced." };
  }
  if (isAtOrBelow(owner, subzone)) {
    return { eligible: false, reason: `This name is part of the GSLB subzone ${subzone}` };
  }

  // A name below a child delegation is served by that child zone, not this one.
  const delegation = rrsets.find(
    (rr) =>
      rr.type === "NS" &&
      canonicalName(rr.name) !== zone &&
      canonicalName(rr.name) !== owner &&
      isAtOrBelow(owner, canonicalName(rr.name)),
  );
  if (delegation) {
    return {
      eligible: false,
      reason: `This name is inside the delegated zone ${canonicalName(delegation.name)}`,
    };
  }

  const atName = rrsets.filter((rr) => canonicalName(rr.name) === owner);
  const types = [...new Set(atName.map((rr) => rr.type.toUpperCase()))].sort();
  if (!types.some((t) => ELIGIBLE_TYPES.has(t))) {
    return { eligible: false, reason: "Only A, AAAA and CNAME records can be GSLB-balanced." };
  }
  const others = types.filter((t) => !ELIGIBLE_TYPES.has(t));
  if (others.length > 0) {
    const list =
      others.length === 1
        ? `${withArticle(others[0]!)} record`
        : `${others.slice(0, -1).join(", ")} and ${others.at(-1)!} records`;
    return { eligible: false, reason: `This name also has ${list}.` };
  }
  if (atName.some((rr) => rr.records.some((r) => r.disabled === true))) {
    return {
      eligible: false,
      reason: "This name has disabled records. Enable or remove them first.",
    };
  }
  const pointsIntoSubzone = atName.some(
    (rr) =>
      rr.type.toUpperCase() === "CNAME" &&
      rr.records.some((r) => isAtOrBelow(canonicalName(r.content), subzone)),
  );
  if (pointsIntoSubzone) {
    return {
      eligible: false,
      reason: `This CNAME already points into ${subzone} but isn't tracked by GSLB.`,
    };
  }
  if (atName.every((rr) => rr.records.length === 0)) {
    return { eligible: false, reason: "This name has no records." };
  }
  return { eligible: true, kind: types.includes("CNAME") ? "cname" : "address", types };
}

// =============================================================================
// Members
// =============================================================================

const HOST_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?$/;

/**
 * Validate + canonicalize one member's content for the record kind: an IPv4
 * or IPv6 address for `address`, a fully-qualified host name for `cname`.
 */
export function normalizeMemberContent(
  kind: GslbRecordKind,
  content: string,
): { ok: true; content: string; type: "A" | "AAAA" | "CNAME" } | { ok: false; error: string } {
  if (kind === "address") {
    const ip = normalizeIpAddress(content);
    if (!ip) return { ok: false, error: `'${content.trim()}' is not an IPv4 or IPv6 address.` };
    return { ok: true, content: ip.address, type: ip.family === 4 ? "A" : "AAAA" };
  }
  if (normalizeIpAddress(content)) {
    return {
      ok: false,
      error: `'${content.trim()}' is an address; a CNAME member needs a host name.`,
    };
  }
  const host = canonicalName(content);
  const labels = stripDot(host).split(".");
  if (host.length > 254 || labels.length < 2 || !labels.every((l) => HOST_LABEL.test(l))) {
    return {
      ok: false,
      error: `'${content.trim()}' is not a fully-qualified host name (e.g. app.example.com).`,
    };
  }
  return { ok: true, content: host, type: "CNAME" };
}

// =============================================================================
// Monitors + routings
// =============================================================================

export interface GslbObject {
  name: string;
  json: string;
}

/** Monitor for the SOA/NS rows of a subzone apex - never run. */
export const NONE_MONITOR: GslbObject = {
  name: `${GSLB_OWNED_PREFIX}none`,
  json: JSON.stringify({ type: "none" }),
};

/**
 * Member content family decides the monitor: an IPv6 literal must be
 * bracketed inside an HTTP URL, so HTTP(S) presets get a separate `:v6`
 * monitor. Names are derived from the settings, so equal settings always
 * share one PowerGSLB monitor.
 */
export type MemberFamily = 4 | 6 | "name";

export function monitorFor(config: GslbMonitorConfig, family: MemberFamily): GslbObject {
  const host = family === 6 ? "[${content}]" : "${content}";
  const v6Suffix = family === 6 ? ":v6" : "";
  const verifyLabel = (verify: boolean) => (verify ? "verify" : "noverify");
  switch (config.type) {
    case "icmp":
      return {
        name: `${GSLB_OWNED_PREFIX}icmp`,
        json: JSON.stringify({ type: "icmp", ip: "${content}" }),
      };
    case "tcp":
      return {
        name: `${GSLB_OWNED_PREFIX}tcp:${config.port}`,
        json: JSON.stringify({ type: "tcp", ip: "${content}", port: config.port }),
      };
    case "tls":
      return {
        name: `${GSLB_OWNED_PREFIX}tls:${config.port}:${verifyLabel(config.tlsVerify)}`,
        json: JSON.stringify({
          type: "tls",
          ip: "${content}",
          port: config.port,
          tls_verify: config.tlsVerify,
        }),
      };
    case "http":
      return {
        name: `${GSLB_OWNED_PREFIX}http:${config.path}:${config.expectedStatus}${v6Suffix}`,
        json: JSON.stringify({
          type: "http",
          url: `http://${host}${config.path}`,
          expected_status: config.expectedStatus,
        }),
      };
    case "https":
      return {
        name: `${GSLB_OWNED_PREFIX}https:${config.path}:${config.expectedStatus}:${verifyLabel(config.tlsVerify)}${v6Suffix}`,
        json: JSON.stringify({
          type: "http",
          url: `https://${host}${config.path}`,
          expected_status: config.expectedStatus,
          tls_verify: config.tlsVerify,
        }),
      };
  }
}

export const ROUTINGS = {
  failover: { name: `${GSLB_OWNED_PREFIX}failover`, json: JSON.stringify({ type: "round-robin" }) },
  failoverSingle: {
    name: `${GSLB_OWNED_PREFIX}failover-single`,
    json: JSON.stringify({ type: "round-robin", max_answers: 1 }),
  },
  weighted: {
    name: `${GSLB_OWNED_PREFIX}weighted`,
    json: JSON.stringify({ type: "weighted-random", max_answers: 1 }),
  },
} as const satisfies Record<string, GslbObject>;

/**
 * Routing for a record. A CNAME RRset may hold one answer only, so a cname
 * record never gets the multi-answer failover policy.
 */
export function routingFor(mode: GslbMode, kind: GslbRecordKind): GslbObject {
  if (mode === "distribute") return ROUTINGS.weighted;
  return kind === "cname" ? ROUTINGS.failoverSingle : ROUTINGS.failover;
}

// =============================================================================
// Rows
// =============================================================================

export interface RecordPlanInput {
  target: GslbTarget;
  kind: GslbRecordKind;
  mode: GslbMode;
  monitor: GslbMonitorConfig;
  ttl: number;
  members: readonly GslbMember[];
}

/**
 * PowerGSLB rows for a member list. A member in region R gets a row in R's
 * view AND one in `Public`: the region row answers its own site, the Public
 * row is the catch-all tier PowerGSLB falls back to when the caller's site has
 * no live member - that is the cross-site failover. "All clients" members get
 * the Public row only.
 */
export function planMemberRows(input: RecordPlanInput): PlannedRow[] {
  const domain = stripDot(canonicalName(input.target.domain));
  const label = input.target.label;
  const policy = routingFor(input.mode, input.kind).name;
  const rows: PlannedRow[] = [];
  const seen = new Set<string>();

  for (const member of input.members) {
    const normalized = normalizeMemberContent(input.kind, member.content);
    if (!normalized.ok) throw new Error(normalized.error);
    const family: MemberFamily =
      normalized.type === "A" ? 4 : normalized.type === "AAAA" ? 6 : "name";
    const base = {
      domain,
      name: label,
      name_type: normalized.type,
      ttl: input.ttl,
      policy,
      content: stripDot(normalized.content),
      monitor: monitorFor(input.monitor, family).name,
      weight: member.weight,
      disabled: 0,
    };
    const views = member.region
      ? [regionViewName(member.region), GSLB_PUBLIC_VIEW]
      : [GSLB_PUBLIC_VIEW];
    for (const view of views) {
      const row = { ...base, view };
      const key = rowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

/** Monitors the planned rows reference (one per content family in use). */
export function monitorsForMembers(input: RecordPlanInput): GslbObject[] {
  const byName = new Map<string, GslbObject>();
  for (const member of input.members) {
    const normalized = normalizeMemberContent(input.kind, member.content);
    if (!normalized.ok) continue;
    const family: MemberFamily =
      normalized.type === "A" ? 4 : normalized.type === "AAAA" ? 6 : "name";
    const monitor = monitorFor(input.monitor, family);
    byName.set(monitor.name, monitor);
  }
  return [...byName.values()];
}

/**
 * SOA + NS rows at the apex of a zone's `gslb.<zone>` domain. `zoneName` is the parent zone; its hostmaster mailbox is used.
 */
export function planSubzoneApexRows(args: {
  zoneName: string;
  subzone: string;
  nameserverHost: string;
  serial: number;
}): PlannedRow[] {
  const zone = canonicalName(args.zoneName);
  const ns = canonicalName(args.nameserverHost);
  const common = {
    domain: stripDot(canonicalName(args.subzone)),
    name: "@",
    ttl: DELEGATION_TTL,
    policy: ROUTINGS.failover.name,
    monitor: NONE_MONITOR.name,
    view: GSLB_PUBLIC_VIEW,
    weight: 0,
    disabled: 0,
  };
  return [
    {
      ...common,
      name_type: "SOA",
      content: `${ns} hostmaster.${zone} ${args.serial} 3600 600 86400 30`,
    },
    { ...common, name_type: "NS", content: stripDot(ns) },
  ];
}

/** YYYYMMDD01 for `date` - a conventional starting SOA serial. */
export function initialSerial(date: Date): number {
  const ymd = date.toISOString().slice(0, 10).replaceAll("-", "");
  return Number(`${ymd}01`);
}

export function rowKey(row: { name_type: string; view: string; content: string }): string {
  return `${row.name_type.toUpperCase()}|${row.view.toLowerCase()}|${stripDot(row.content).toLowerCase()}`;
}

/** A PowerGSLB `records` row as read back. */
export interface RemoteRow {
  recid: number;
  name_type: string;
  view: string;
  content: string;
  ttl: number;
  policy: string;
  monitor: string;
  weight: number;
  disabled: number;
}

export interface RowDiff {
  update: Array<{ recid: number; row: PlannedRow }>;
  insert: PlannedRow[];
  remove: number[];
}

/**
 * Turn the name's current rows into the desired ones with the fewest writes,
 * matching on (type, view, content) - PowerGSLB's own unique key. Rows kept
 * in place are rewritten only when a setting changed.
 */
export function diffRows(existing: readonly RemoteRow[], desired: readonly PlannedRow[]): RowDiff {
  const byKey = new Map(existing.map((row) => [rowKey(row), row]));
  const diff: RowDiff = { update: [], insert: [], remove: [] };
  for (const row of desired) {
    const key = rowKey(row);
    const current = byKey.get(key);
    if (!current) {
      diff.insert.push(row);
      continue;
    }
    byKey.delete(key);
    const changed =
      Number(current.ttl) !== row.ttl ||
      current.policy !== row.policy ||
      current.monitor !== row.monitor ||
      Number(current.weight) !== row.weight ||
      Number(current.disabled) !== row.disabled;
    if (changed) diff.update.push({ recid: current.recid, row });
  }
  diff.remove = [...byKey.values()].map((row) => row.recid);
  return diff;
}

// =============================================================================
// Parent zone: delegation
// =============================================================================

export type DelegationPlan = { ok: true; changes: ParentChange[] } | { ok: false; reason: string };

function sameContents(rr: ZoneRRset | undefined, contents: readonly string[]): boolean {
  if (!rr) return false;
  const have = rr.records.map((r) => canonicalName(r.content)).sort();
  const want = contents.map(canonicalName).sort();
  return have.length === want.length && have.every((c, i) => c === want[i]);
}

/**
 * NS (and in-bailiwick glue) that delegate `gslb.<zone>` to the GSLB
 * nameserver. Idempotent: an existing identical delegation yields no changes;
 * anything else already living at or under the subzone is a conflict the
 * operator must resolve - the panel never overwrites it.
 */
export function planDelegation(args: {
  /** Delegated domain, canonical: `gslb.<zone>`. */
  subzone: string;
  rrsets: readonly ZoneRRset[];
  nameserverHost: string;
  nameserverAddresses: readonly string[];
}): DelegationPlan {
  const subzone = canonicalName(args.subzone);
  const ns = canonicalName(args.nameserverHost);
  const inBailiwick = isAtOrBelow(ns, subzone);

  const addresses = args.nameserverAddresses.map((a) => normalizeIpAddress(a));
  if (addresses.some((a) => a === null)) {
    return { ok: false, reason: "The GSLB backend's nameserver addresses are not valid IPs." };
  }
  const v4 = addresses.filter((a) => a!.family === 4).map((a) => a!.address);
  const v6 = addresses.filter((a) => a!.family === 6).map((a) => a!.address);

  const glue: ZoneRRset[] = [];
  if (inBailiwick) {
    if (v4.length > 0)
      glue.push({
        name: ns,
        type: "A",
        ttl: DELEGATION_TTL,
        records: v4.map((content) => ({ content })),
      });
    if (v6.length > 0)
      glue.push({
        name: ns,
        type: "AAAA",
        ttl: DELEGATION_TTL,
        records: v6.map((content) => ({ content })),
      });
  }

  const under = args.rrsets.filter((rr) => isAtOrBelow(canonicalName(rr.name), subzone));
  const changes: ParentChange[] = [];

  const existingNs = under.find((rr) => canonicalName(rr.name) === subzone && rr.type === "NS");
  if (existingNs && !sameContents(existingNs, [ns])) {
    return {
      ok: false,
      reason: `${subzone} already has NS records that don't point at ${ns}. Remove them or change the backend's nameserver.`,
    };
  }
  if (!existingNs) {
    changes.push({
      kind: "upsert",
      name: subzone,
      type: "NS",
      ttl: DELEGATION_TTL,
      records: [{ content: ns, disabled: false }],
    });
  }

  for (const rr of glue) {
    const live = under.find((u) => canonicalName(u.name) === rr.name && u.type === rr.type);
    const wanted = rr.records.map((r) => r.content);
    if (live) {
      const liveContents = live.records
        .map((r) => normalizeIpAddress(r.content)?.address ?? r.content)
        .sort();
      if (liveContents.join(" ") !== [...wanted].sort().join(" ")) {
        return {
          ok: false,
          reason: `${rr.name} already has ${rr.type} records that differ from the backend's nameserver addresses.`,
        };
      }
      continue;
    }
    changes.push({
      kind: "upsert",
      name: rr.name,
      type: rr.type,
      ttl: DELEGATION_TTL,
      records: wanted.map((content) => ({ content, disabled: false })),
    });
  }

  const allowed = new Set([`${subzone}|NS`, ...glue.map((g) => `${g.name}|${g.type}`)]);
  const stray = under.find((rr) => !allowed.has(`${canonicalName(rr.name)}|${rr.type}`));
  if (stray) {
    return {
      ok: false,
      reason: `${canonicalName(stray.name)} (${stray.type}) already exists under ${subzone}. The GSLB subzone must be empty in this zone.`,
    };
  }
  return { ok: true, changes };
}

/**
 * Changes that remove a GSLB domain's delegation from its parent zone: the NS
 * RRset at `subzone`, and the nameserver's glue when it is in-bailiwick -
 * unless another NS RRset in the zone still names that nameserver (another
 * delegation to the same `ns1.gslb...`), in which case the glue must stay or
 * that delegation breaks.
 */
export function planDelegationRemoval(args: {
  subzone: string;
  nameserverHost: string | null;
  rrsets: readonly ZoneRRset[];
}): ParentChange[] {
  const subzone = canonicalName(args.subzone);
  const changes: ParentChange[] = [];
  if (args.rrsets.some((rr) => canonicalName(rr.name) === subzone && rr.type === "NS")) {
    changes.push({ kind: "delete", name: subzone, type: "NS" });
  }
  if (!args.nameserverHost) return changes;
  const ns = canonicalName(args.nameserverHost);
  if (!isAtOrBelow(ns, subzone)) return changes;
  const stillReferenced = args.rrsets.some(
    (rr) =>
      rr.type === "NS" &&
      canonicalName(rr.name) !== subzone &&
      rr.records.some((r) => canonicalName(r.content) === ns),
  );
  if (stillReferenced) return changes;
  for (const type of ["A", "AAAA"]) {
    if (args.rrsets.some((rr) => canonicalName(rr.name) === ns && rr.type === type)) {
      changes.push({ kind: "delete", name: ns, type });
    }
  }
  return changes;
}

/**
 * RRsets GSLB owns in one zone, derived ONLY from app rows - so they unlock
 * the moment those rows are gone:
 *   - every RRset at a GSLB-managed name;
 *   - the zone's `gslb.<zone>` delegation while its GSLB setup row exists.
 */
export function computeOwnedRRsets(input: {
  managedNames: readonly string[];
  zoneDelegation: { subzone: string; nameserverHost: string | null } | null;
}): { names: Set<string>; delegationKeys: Set<string> } {
  const keys = new Set(
    input.zoneDelegation
      ? delegationRRsetKeys(input.zoneDelegation.subzone, input.zoneDelegation.nameserverHost)
      : [],
  );
  return { names: new Set(input.managedNames.map(canonicalName)), delegationKeys: keys };
}

/** Parent RRsets that belong to the delegation, for "Managed by GSLB" labels. */
export function delegationRRsetKeys(subzoneName: string, nameserverHost: string | null): string[] {
  const subzone = canonicalName(subzoneName);
  const keys = [`${subzone}|NS`];
  if (nameserverHost) {
    const ns = canonicalName(nameserverHost);
    if (isAtOrBelow(ns, subzone)) keys.push(`${ns}|A`, `${ns}|AAAA`);
  }
  return keys;
}

// =============================================================================
// Parent zone: enable + restore
// =============================================================================

function readComments(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null);
}

/**
 * Replace the RRset(s) at `name` with `CNAME <name>.gslb.<zone>.` and capture
 * what they were. Deletes come first so PowerDNS never sees the CNAME next to
 * an A/AAAA. The CNAME keeps the replaced RRset's TTL - its target never
 * changes, so caching it longer than the GSLB answers is harmless.
 */
export function planParentEnable(args: {
  name: string;
  /** CNAME target, from `targetName()`. */
  target: string;
  liveAtName: readonly ZoneRRset[];
}): { changes: ParentChange[]; snapshot: GslbRRsetSnapshot[]; types: string[] } {
  const owner = canonicalName(args.name);
  const relevant = args.liveAtName.filter(
    (rr) => canonicalName(rr.name) === owner && ELIGIBLE_TYPES.has(rr.type.toUpperCase()),
  );
  const snapshot: GslbRRsetSnapshot[] = relevant.map((rr) => ({
    name: owner,
    type: rr.type.toUpperCase(),
    ttl: rr.ttl,
    records: rr.records.map((r) => ({
      content: r.content,
      ...(r.disabled ? { disabled: true } : {}),
    })),
    comments: readComments(rr.comments),
  }));
  const ttl = Math.max(...relevant.map((rr) => rr.ttl), 60);
  const changes: ParentChange[] = relevant
    .filter((rr) => rr.type.toUpperCase() !== "CNAME")
    .map((rr) => ({ kind: "delete" as const, name: owner, type: rr.type.toUpperCase() }));
  changes.push({
    kind: "upsert",
    name: owner,
    type: "CNAME",
    ttl,
    records: [{ content: canonicalName(args.target), disabled: false }],
  });
  return { changes, snapshot, types: snapshot.map((s) => s.type) };
}

/** True when the parent holds exactly one RRset at `name`: our CNAME into the subzone. */
export function parentPointsAtGslb(
  liveAtName: readonly ZoneRRset[],
  name: string,
  target: string,
): boolean {
  const owner = canonicalName(name);
  const live = liveAtName.filter((rr) => canonicalName(rr.name) === owner);
  const cname = live[0];
  return (
    live.length === 1 &&
    cname?.type.toUpperCase() === "CNAME" &&
    cname.records.length === 1 &&
    canonicalName(cname.records[0]!.content) === canonicalName(target)
  );
}

export type RestorePlan = { ok: true; changes: ParentChange[] } | { ok: false; reason: string };

/**
 * Put the name back the way GSLB found it. Refuses unless the parent still
 * holds exactly our CNAME - otherwise someone changed it outside GSLB and
 * restoring would overwrite their change. Members win over the snapshot for
 * address records, so edits made while GSLB was on survive; a cname record
 * restores its first member.
 */
export function planParentRestore(args: {
  name: string;
  /** The CNAME target GSLB set, from `targetName()`. */
  target: string;
  liveAtName: readonly ZoneRRset[];
  kind: GslbRecordKind;
  members: readonly GslbMember[];
  snapshot: readonly GslbRRsetSnapshot[];
}): RestorePlan {
  const owner = canonicalName(args.name);
  const target = canonicalName(args.target);
  if (!parentPointsAtGslb(args.liveAtName, owner, target)) {
    return {
      ok: false,
      reason: `The record was changed outside GSLB: ${owner} no longer points only at ${target}. Fix it in the record table first; GSLB was left on.`,
    };
  }

  const snapshotOf = (type: string) => args.snapshot.find((s) => s.type === type);
  const fallbackTtl = args.snapshot[0]?.ttl ?? FALLBACK_RESTORE_TTL;

  if (args.kind === "cname") {
    const first = args.members[0];
    if (!first) return { ok: false, reason: "No member to restore the CNAME from." };
    const snap = snapshotOf("CNAME");
    return {
      ok: true,
      changes: [
        {
          kind: "upsert",
          name: owner,
          type: "CNAME",
          ttl: snap?.ttl ?? fallbackTtl,
          records: [{ content: canonicalName(first.content), disabled: false }],
          comments: snap?.comments ?? [],
        },
      ],
    };
  }

  const byType: Record<"A" | "AAAA", string[]> = { A: [], AAAA: [] };
  for (const member of args.members) {
    const ip = normalizeIpAddress(member.content);
    if (!ip) continue;
    const list = byType[ip.family === 4 ? "A" : "AAAA"];
    if (!list.includes(ip.address)) list.push(ip.address);
  }
  const changes: ParentChange[] = [{ kind: "delete", name: owner, type: "CNAME" }];
  for (const type of ["A", "AAAA"] as const) {
    if (byType[type].length === 0) continue;
    const snap = snapshotOf(type);
    changes.push({
      kind: "upsert",
      name: owner,
      type,
      ttl: snap?.ttl ?? fallbackTtl,
      records: byType[type].map((content) => ({ content, disabled: false })),
      comments: snap?.comments ?? [],
    });
  }
  if (changes.length === 1) return { ok: false, reason: "No member address to restore." };
  return { ok: true, changes };
}

// =============================================================================
// Zones list health
// =============================================================================

/**
 * GSLB health of one zone for the zones list: how many managed names it has
 * and how many have at least one member Off. `states` is the backend's whole
 * status table keyed `<domain>|<label>|<content>` (lowercase, no trailing
 * dots); `null` means PowerGSLB couldn't be read. A member with no status row
 * yet is not counted as down.
 */
export interface ZoneGslbHealth {
  total: number;
  /** Records with at least one member Off. */
  down: number;
  /** Distinct members (servers) Off across those records. */
  serversDown: number;
  unavailable: boolean;
}

export function statusKey(target: GslbTarget, content: string): string {
  return `${stripDot(canonicalName(target.domain))}|${target.label}|${stripDot(content)}`.toLowerCase();
}

/**
 * Records are given with their target (`<name>.gslb.<zone>`) and members.
 */
export function zoneGslbHealth(
  records: ReadonlyArray<{ target: GslbTarget; members: readonly GslbMember[] }>,
  states: ReadonlyMap<string, "On" | "Off"> | null,
): ZoneGslbHealth {
  if (!states) return { total: records.length, down: 0, serversDown: 0, unavailable: true };
  let down = 0;
  const offServers = new Set<string>();
  for (const record of records) {
    let anyOff = false;
    for (const member of record.members) {
      const key = statusKey(record.target, member.content);
      if (states.get(key) === "Off") {
        anyOff = true;
        offServers.add(key);
      }
    }
    if (anyOff) down++;
  }
  return { total: records.length, down, serversDown: offServers.size, unavailable: false };
}

/**
 * Why a GSLB backend can't be deleted yet, naming each blocker and where to
 * remove it - or null when nothing blocks.
 */
export function backendDeleteBlockers(input: {
  regions: readonly string[];
  zones: ReadonlyArray<{ zoneName: string; records: number }>;
}): string | null {
  const parts: string[] = [];
  if (input.regions.length > 0) {
    parts.push(
      `regions ${input.regions.join(", ")} - delete them in the Regions section of this page`,
    );
  }
  if (input.zones.length > 0) {
    const zones = input.zones.map((z) =>
      z.records > 0
        ? `${z.zoneName} (${z.records} GSLB record${z.records === 1 ? "" : "s"})`
        : `${z.zoneName} (GSLB setup only)`,
    );
    parts.push(
      `zones ${zones.join(", ")} - in each zone's Records tab switch GSLB off for its records, then use "Remove GSLB setup"`,
    );
  }
  return parts.length > 0 ? `This GSLB backend is still in use: ${parts.join("; ")}.` : null;
}

/**
 * RRsets of a zone being cloned, with GSLB stripped: GSLB isn't copied, so a
 * clone must not inherit CNAMEs into the source's subzone or its delegation.
 * Every GSLB-managed name becomes plain A/AAAA (or CNAME) from its current
 * members - exactly what switching it off would write - and the `gslb`
 * delegation (NS, glue, anything under the subzone) is dropped. A managed
 * name whose CNAME was changed outside GSLB is copied as it is.
 */
export function stripGslbForClone(args: {
  zoneName: string;
  rrsets: readonly ZoneRRset[];
  records: ReadonlyArray<{
    name: string;
    kind: GslbRecordKind;
    members: readonly GslbMember[];
    snapshot: readonly GslbRRsetSnapshot[];
  }>;
  /** The zone's `gslb.<zone>` when it has a GSLB setup, else null. */
  subzone: string | null;
  delegationKeys: readonly string[];
}): { rrsets: ZoneRRset[]; plainNames: number } {
  const dropKeys = new Set(args.delegationKeys);
  const replaced = new Map<string, ZoneRRset[]>();
  for (const record of args.records) {
    const owner = canonicalName(record.name);
    const plan = planParentRestore({
      name: owner,
      target: targetName(recordTarget(owner, args.zoneName)),
      liveAtName: args.rrsets.filter((rr) => canonicalName(rr.name) === owner),
      kind: record.kind,
      members: record.members,
      snapshot: record.snapshot,
    });
    if (!plan.ok) continue;
    replaced.set(
      owner,
      plan.changes.flatMap((c) =>
        c.kind === "upsert" ? [{ name: c.name, type: c.type, ttl: c.ttl, records: c.records }] : [],
      ),
    );
  }
  const out: ZoneRRset[] = [];
  for (const rr of args.rrsets) {
    const owner = canonicalName(rr.name);
    if (replaced.has(owner)) continue;
    if (dropKeys.has(`${owner}|${rr.type}`)) continue;
    if (args.subzone && isAtOrBelow(owner, canonicalName(args.subzone))) continue;
    out.push(rr);
  }
  for (const rrsets of replaced.values()) out.push(...rrsets);
  return { rrsets: out, plainNames: replaced.size };
}
