/**
 * lib/gslb/objects.ts
 *
 * PowerGSLB object helpers for per-record GSLB (ADR-0024 §3, §5): domains,
 * monitors, routings, the `Public` view, and a name's `records` rows. Pure
 * protocol logic over `GslbClient` - no DB, RBAC or audit.
 *
 * Every lookup filters client-side as well as by `search`, because PowerGSLB
 * silently drops a search clause it can't apply and returns every row (see
 * `GslbSearch`). Writes touch only `authadmin:` monitors/routings and rows of
 * the panel's own `gslb.<zone>` domains.
 */

import "server-only";
import { z } from "zod";
import type { GslbClient } from "./client";
import { GslbError } from "./errors";
import { GSLB_OWNED_PREFIX, GSLB_PUBLIC_VIEW } from "./model";
import type { GslbObject, PlannedRow, RemoteRow, RowDiff } from "./record-plan";
import { findViewByName } from "./views";

/** Types the panel writes; PowerGSLB resolves `name_type` through its `types` table. */
const REQUIRED_TYPES = ["A", "AAAA", "CNAME", "NS", "SOA"] as const;
const PUBLIC_VIEW_RULE = "0.0.0.0/0 ::/0";

/** A PowerGSLB precondition the operator has to fix (missing type, broken Public view...). */
export class GslbSetupError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GslbSetupError";
  }
}

const remoteRowSchema = z.looseObject({
  recid: z.number().int(),
  domain: z.string(),
  name: z.string(),
  name_type: z.string(),
  view: z.string(),
  content: z.string(),
  ttl: z.coerce.number(),
  policy: z.string(),
  monitor: z.string(),
  weight: z.coerce.number(),
  disabled: z.coerce.number(),
});

function sameText(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

/** JSON equality independent of key order and whitespace. */
function sameJson(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  try {
    return canonicalJson(JSON.parse(a)) === canonicalJson(JSON.parse(b));
  } catch {
    return false;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Create or correct an owned monitor/routing so it carries `object.json`.
 * Names are derived from the settings, so a mismatch means someone edited it
 * in PowerGSLB - the panel's version wins.
 *
 * @throws {GslbError}
 */
export async function ensureOwnedObject(
  client: GslbClient,
  table: "monitors" | "routings",
  object: GslbObject,
): Promise<void> {
  if (!object.name.startsWith(GSLB_OWNED_PREFIX)) {
    throw new Error(`ensureOwnedObject: refusing to write non-owned ${table} "${object.name}"`);
  }
  const nameField = table === "monitors" ? "monitor" : "policy";
  const jsonField = table === "monitors" ? "monitor_json" : "policy_json";
  const page = await client.getRecords(table, {
    search: [{ field: nameField, operator: "is", value: object.name }],
  });
  const existing = page.records.find((row) => sameText(row[nameField], object.name));
  if (existing && sameJson(existing[jsonField], object.json)) return;
  await client.saveRecord(table, existing?.recid ?? 0, {
    [nameField]: object.name,
    [jsonField]: object.json,
  });
}

/**
 * PowerGSLB must know every RR type the panel writes. They ship in its seed
 * data; the panel won't invent type codes, so a missing one is a setup error.
 *
 * @throws {GslbSetupError} when PowerGSLB itself needs fixing.
 * @throws {GslbError} on transport / protocol failures.
 */
export async function assertRequiredTypes(client: GslbClient): Promise<void> {
  const page = await client.getRecords("types");
  const known = new Set(
    page.records.map((row) => (typeof row["name_type"] === "string" ? row["name_type"] : "")),
  );
  const missing = REQUIRED_TYPES.filter((t) => !known.has(t));
  if (missing.length > 0) {
    throw new GslbSetupError(
      `PowerGSLB is missing record type${missing.length === 1 ? "" : "s"} ${missing.join(", ")} in its types table. Restore them in PowerGSLB first.`,
    );
  }
}

function isMatchAll(rule: string): boolean {
  const families = new Set<number>();
  for (const token of rule.split(/\s+/)) {
    if (token === "0.0.0.0/0") families.add(4);
    if (token === "::/0") families.add(6);
  }
  return families.size === 2;
}

/**
 * The `Public` catch-all view the cross-site failover relies on. Created when
 * missing (PowerGSLB's seed has it, but sample data may have been cleared);
 * refused when it exists but is not match-all, since then it would not be the
 * fallback tier.
 *
 * @throws {GslbSetupError} when PowerGSLB itself needs fixing.
 * @throws {GslbError} on transport / protocol failures.
 */
export async function ensurePublicView(client: GslbClient): Promise<void> {
  const view = await findViewByName(client, GSLB_PUBLIC_VIEW);
  if (view) {
    if (!isMatchAll(view.rule)) {
      throw new GslbSetupError(
        `PowerGSLB view "${GSLB_PUBLIC_VIEW}" must match all clients (${PUBLIC_VIEW_RULE}) but has "${view.rule}".`,
      );
    }
    return;
  }
  await client.saveRecord("views", 0, { view: GSLB_PUBLIC_VIEW, rule: PUBLIC_VIEW_RULE });
}

/**
 * Every region view a member list uses must already exist in PowerGSLB.
 *
 * @throws {GslbSetupError} when PowerGSLB itself needs fixing.
 * @throws {GslbError} on transport / protocol failures.
 */
export async function assertViewsExist(
  client: GslbClient,
  viewNames: readonly string[],
): Promise<void> {
  for (const name of new Set(viewNames)) {
    if (name === GSLB_PUBLIC_VIEW) continue;
    if (!(await findViewByName(client, name))) {
      throw new GslbSetupError(
        `PowerGSLB has no view "${name}". Resync that region on the GSLB backend page first.`,
      );
    }
  }
}

/** Create the domain when missing. Returns whether it was created. */
export async function ensureDomain(
  client: GslbClient,
  domain: string,
  description: string,
): Promise<boolean> {
  const page = await client.getRecords("domains", {
    search: [{ field: "domain", operator: "is", value: domain }],
  });
  if (page.records.some((row) => sameText(row["domain"], domain))) return false;
  await client.saveRecord("domains", 0, { domain, description });
  return true;
}

/**
 * `records` rows of one domain, optionally of one owner label.
 *
 * @throws {GslbError}
 */
export async function listRows(
  client: GslbClient,
  domain: string,
  label?: string,
): Promise<RemoteRow[]> {
  const page = await client.getRecords("records", {
    search: [
      { field: "domain", operator: "is", value: domain },
      ...(label !== undefined ? [{ field: "name", operator: "is" as const, value: label }] : []),
    ],
  });
  const rows: RemoteRow[] = [];
  for (const raw of page.records) {
    const parsed = remoteRowSchema.safeParse(raw);
    if (!parsed.success) throw new GslbError("protocol", "records row has an unknown shape.");
    const row = parsed.data;
    if (!sameText(row.domain, domain)) continue;
    if (label !== undefined && !sameText(row.name, label)) continue;
    rows.push({
      recid: row.recid,
      name_type: row.name_type,
      view: row.view,
      content: row.content,
      ttl: row.ttl,
      policy: row.policy,
      monitor: row.monitor,
      weight: row.weight,
      disabled: row.disabled,
    });
  }
  return rows;
}

function toFields(row: PlannedRow): Record<string, string | number> {
  return { ...row };
}

/**
 * Apply a row diff. Updates and inserts run before removals so the name never
 * passes through an empty state while its parent CNAME points at it.
 *
 * @throws {GslbError}
 */
export async function applyRowDiff(client: GslbClient, diff: RowDiff): Promise<void> {
  for (const { recid, row } of diff.update)
    await client.saveRecord("records", recid, toFields(row));
  for (const row of diff.insert) await client.saveRecord("records", 0, toFields(row));
  await client.deleteRecords("records", diff.remove);
}

/** Delete every row of `label` in `domain`. Returns how many were deleted. */
export async function deleteRowsAt(
  client: GslbClient,
  domain: string,
  label: string,
): Promise<number> {
  const rows = await listRows(client, domain, label);
  await client.deleteRecords(
    "records",
    rows.map((row) => row.recid),
  );
  return rows.length;
}

export type MemberState = "On" | "Off";

/**
 * Live health of every record on the backend, keyed
 * `<domain>|<label>|<content>` lowercased (no trailing dots). One request for
 * the whole backend - the zones list needs every GSLB zone at once.
 *
 * @throws {GslbError}
 */
export async function readAllStatus(client: GslbClient): Promise<Map<string, MemberState>> {
  const page = await client.getRecords("status");
  const states = new Map<string, MemberState>();
  for (const row of page.records) {
    const text = (field: string): string => {
      const value = row[field];
      return typeof value === "string" ? value : "";
    };
    const key = `${text("domain")}|${text("name")}|${text("content")}`.toLowerCase();
    if (row["status"] === "On") states.set(key, "On");
    else if (!states.has(key)) states.set(key, "Off");
  }
  return states;
}

/**
 * Live health of one domain's records, from PowerGSLB's read-only `status`
 * table, keyed like {@link readAllStatus} (`<domain>|<label>|<content>`
 * lowercased), so `statusKey` looks members up in either. The zone page reads
 * only its own `gslb.<zone>` this way instead of the whole backend.
 *
 * @throws {GslbError}
 */
export async function readDomainStatus(
  client: GslbClient,
  domain: string,
): Promise<Map<string, MemberState>> {
  const page = await client.getRecords("status", {
    search: [{ field: "domain", operator: "is", value: domain }],
  });
  const states = new Map<string, MemberState>();
  for (const row of page.records) {
    // The search is only a hint (see `GslbSearch`): filter again here.
    if (!sameText(row["domain"], domain)) continue;
    const text = (field: string): string => {
      const value = row[field];
      return typeof value === "string" ? value : "";
    };
    const key = `${text("domain")}|${text("name")}|${text("content")}`.toLowerCase();
    // A member has one row per view; it is up if any of them is.
    if (row["status"] === "On") states.set(key, "On");
    else if (!states.has(key)) states.set(key, "Off");
  }
  return states;
}

/**
 * Delete a panel-owned GSLB domain: its records first (PowerGSLB's GC trigger
 * then drops the empty rrsets), then the domain row. Only ever called for
 * `gslb.<zone>` domains the panel created. Returns whether the domain
 * existed.
 *
 * @throws {GslbError}
 */
export async function deleteOwnedDomain(client: GslbClient, domain: string): Promise<boolean> {
  const rows = await listRows(client, domain);
  await client.deleteRecords(
    "records",
    rows.map((row) => row.recid),
  );
  const page = await client.getRecords("domains", {
    search: [{ field: "domain", operator: "is", value: domain }],
  });
  const ids = page.records.filter((row) => sameText(row["domain"], domain)).map((row) => row.recid);
  await client.deleteRecords("domains", ids);
  return ids.length > 0;
}
