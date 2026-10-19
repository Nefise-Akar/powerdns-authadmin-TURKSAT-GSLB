/**
 * lib/gslb/model.ts
 *
 * Shapes of a GSLB-managed record (ADR-0024 §3, §5, §6) shared by the DB
 * schema, the planner, the routes and the zone editor. Types and constants
 * only - no "server-only", so client components can import it.
 */

/**
 * How a record picks among its healthy members (ADR-0024 §5):
 *   - global-availability: the member list order is the priority; the first
 *     live member answers (ordered failover);
 *   - round-robin: every live member of the preferred set is returned;
 *   - ratio: one member per query, chosen at random in proportion to its ratio.
 * Which members form the "preferred set" is decided by the regions (topology),
 * not by the method.
 */
export type GslbMethod = "global-availability" | "round-robin" | "ratio";

export const GSLB_METHODS: readonly GslbMethod[] = ["global-availability", "round-robin", "ratio"];

/**
 * The value kept in the record's `mode` column (and in presets). The column
 * predates methods, so no migration: new writes use the three methods plus
 * `round-robin+persistence` (persistence only exists with round robin), and
 * the two legacy values are still read - see {@link decodeMode}.
 */
export type GslbMode = GslbMethod | "round-robin+persistence" | "failover" | "distribute";

export interface GslbBalancing {
  method: GslbMethod;
  /** Same client network → same member (PowerGSLB `sticky-hash`). Round robin only. */
  persistence: boolean;
}

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
/** Keeps what the panel did before methods existed: all members equal, local first. */
export const GSLB_DEFAULT_METHOD: GslbMethod = "round-robin";
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

// =============================================================================
// Load-balancing methods
// =============================================================================

/** Step between ordered members' derived weights; room for 32 members under the 1000 cap. */
const ORDER_WEIGHT_STEP = 10;

/** Value to store in the `mode` column for a method + persistence. */
export function encodeMode(balancing: GslbBalancing): GslbMode {
  return balancing.method === "round-robin" && balancing.persistence
    ? "round-robin+persistence"
    : balancing.method;
}

/**
 * Read a stored `mode` (current or legacy) into a method + persistence, and
 * the members in the order they should be shown:
 *   - `failover` with equal weights was effectively round robin;
 *   - `failover` with unequal weights was a priority list → global
 *     availability, ordered by descending weight (stable);
 *   - `distribute` → ratio, weights untouched.
 */
export function decodeMode<M extends { weight: number }>(
  stored: GslbMode,
  members: readonly M[],
): GslbBalancing & { members: M[] } {
  switch (stored) {
    case "global-availability":
    case "round-robin":
    case "ratio":
      return { method: stored, persistence: false, members: [...members] };
    case "round-robin+persistence":
      return { method: "round-robin", persistence: true, members: [...members] };
    case "distribute":
      return { method: "ratio", persistence: false, members: [...members] };
    case "failover": {
      const equal = members.every((m) => m.weight === members[0]?.weight);
      if (equal) return { method: "round-robin", persistence: false, members: [...members] };
      return {
        method: "global-availability",
        persistence: false,
        members: [...members].sort((a, b) => b.weight - a.weight),
      };
    }
  }
}

/**
 * Weights the PowerGSLB rows carry for a method:
 *   - global availability: derived from list position - first is highest, all
 *     distinct, so exactly one live member is the top tier;
 *   - round robin: all equal (default weight), one tier;
 *   - ratio: the operator's ratios as given.
 */
export function deriveWeights<M extends { weight: number }>(
  method: GslbMethod,
  members: readonly M[],
): M[] {
  switch (method) {
    case "global-availability":
      return members.map((m, index) => ({
        ...m,
        weight: (members.length - index) * ORDER_WEIGHT_STEP,
      }));
    case "round-robin":
      return members.map((m) => ({ ...m, weight: GSLB_DEFAULT_WEIGHT }));
    case "ratio":
      return members.map((m) => ({ ...m }));
  }
}

/** Why a method + persistence + member combination is not allowed, or null. */
export function balancingError(
  balancing: GslbBalancing,
  members: ReadonlyArray<{ weight: number }>,
): string | null {
  if (balancing.persistence && balancing.method !== "round-robin") {
    return "Persistence only works with the Round robin method.";
  }
  if (balancing.method === "ratio" && !members.some((m) => m.weight > 0)) {
    return "Give at least one server a ratio above 0.";
  }
  return null;
}

export const GSLB_METHOD_LABELS: Record<GslbMethod, string> = {
  "global-availability": "Global availability",
  "round-robin": "Round robin",
  ratio: "Ratio",
};

/** One sentence per method, shown under the select and in the docs. */
export const GSLB_METHOD_HELP: Record<GslbMethod, string> = {
  "global-availability":
    "Servers are tried in the order listed: the first healthy one answers, the next takes over when it is down.",
  "round-robin":
    "All healthy servers are returned together and the resolver picks one (the DNS server itself does not rotate per query).",
  ratio:
    "Each query gets one healthy server, chosen at random in proportion to its ratio (a 3:1 ratio sends about 75% / 25%).",
};

/** Label for a record row: "Round robin", "Round robin · persistent". */
export function methodLabel(balancing: GslbBalancing): string {
  const label = GSLB_METHOD_LABELS[balancing.method];
  return balancing.persistence ? `${label} · persistent` : label;
}
