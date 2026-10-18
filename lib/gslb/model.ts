/**
 * lib/gslb/model.ts
 *
 * Shapes of a GSLB-managed record (ADR-0024 §3, §5, §6) shared by the DB
 * schema, the planner, the routes and the zone editor. Types and constants
 * only - no "server-only", so client components can import it.
 */

/** Failover = weight tiers under round-robin; Distribute = weighted-random. */
export type GslbMode = "failover" | "distribute";

/**
 * A/AAAA names move together as one "address" record; a lone CNAME is a
 * "cname" record. The kind fixes which member contents are valid.
 */
export type GslbRecordKind = "address" | "cname";

export type GslbMonitorConfig =
  | { type: "icmp" }
  | { type: "tcp"; port: number }
  | { type: "tls"; port: number; tlsVerify: boolean }
  | { type: "http"; path: string; expectedStatus: string }
  | { type: "https"; path: string; expectedStatus: string; tlsVerify: boolean };

export type GslbMonitorType = GslbMonitorConfig["type"];

export interface GslbMember {
  /** IPv4/IPv6 address (address kind) or FQDN with trailing dot (cname kind). */
  content: string;
  /** Region slug on the record's backend, or null for "All clients". */
  region: string | null;
  /** 0-1000. A tier under Failover, a share under Distribute. */
  weight: number;
}

/** Last settings of a name, kept after GSLB is switched off (re-offered, never re-applied). */
export interface GslbRecordPreset {
  backendId: string;
  mode: GslbMode;
  monitor: GslbMonitorConfig;
  ttl: number;
  members: GslbMember[];
}

/** Parent RRset captured when GSLB was switched on, restored when it's switched off. */
export interface GslbRRsetSnapshot {
  name: string;
  type: string;
  ttl: number;
  records: Array<{ content: string; disabled?: boolean }>;
  comments: Array<Record<string, unknown>>;
}

export const GSLB_DEFAULT_TTL = 30;
export const GSLB_MIN_TTL = 5;
export const GSLB_MAX_TTL = 86_400;
export const GSLB_MAX_WEIGHT = 1000;
/** Every member starts in the same tier, so all healthy members serve. */
export const GSLB_DEFAULT_WEIGHT = 10;
export const GSLB_DEFAULT_MODE: GslbMode = "failover";
export const GSLB_MAX_MEMBERS = 32;
export const GSLB_DEFAULT_HTTP_PATH = "/health";
export const GSLB_DEFAULT_EXPECTED_STATUS = "200-399";

/** The default health check: HTTP GET /health expecting 2xx/3xx. */
export const GSLB_DEFAULT_MONITOR: GslbMonitorConfig = {
  type: "http",
  path: GSLB_DEFAULT_HTTP_PATH,
  expectedStatus: GSLB_DEFAULT_EXPECTED_STATUS,
};

/**
 * Prefix of every PowerGSLB object the panel creates (views, monitors,
 * routings). Objects without it are never modified or deleted.
 */
export const GSLB_OWNED_PREFIX = "authadmin:";

/**
 * PowerGSLB's match-all catch-all view. Its records serve only when no
 * specific view matched the caller or every specific record is down - which
 * is what makes cross-site failover work (ADR-0024 §4).
 */
export const GSLB_PUBLIC_VIEW = "Public";

/** Label of the per-zone delegated subzone: records live at `<name>.gslb.<zone>`. */
export const GSLB_SUBZONE_LABEL = "gslb";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Zones-list chip text: "3 records · all up", "1 record · 2 servers down",
 * or "status unavailable".
 */
export function gslbZoneChipLabel(health: {
  total: number;
  down: number;
  serversDown: number;
  unavailable: boolean;
}): string {
  if (health.unavailable) return "status unavailable";
  if (health.down === 0) return `${plural(health.total, "record")} · all up`;
  return `${plural(health.down, "record")} · ${plural(health.serversDown, "server")} down`;
}

/**
 * The no-region warning: null when there is nothing to warn about (no
 * regions defined at all, or every member has one).
 */
export function unassignedRegionWarning(unassigned: number, regionCount: number): string | null {
  if (regionCount === 0 || unassigned === 0) return null;
  return `${plural(unassigned, "server")} ${unassigned === 1 ? "has" : "have"} no region, so ${unassigned === 1 ? "it serves" : "they serve"} all clients and won't give users a nearby server. Continue?`;
}
