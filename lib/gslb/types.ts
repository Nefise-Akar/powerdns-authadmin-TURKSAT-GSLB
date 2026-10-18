/**
 * lib/gslb/types.ts
 *
 * Wire types for the PowerGSLB 2.4 w2ui admin API (`POST <base>/admin/w2ui`).
 * Every table is addressed by a `data` token; rows come back as flat objects
 * keyed by column name plus a numeric `recid`. Rows stay loosely typed here -
 * per-table shapes belong to the callers that write them (ADR-0024 Part 2).
 */

import type { GslbErrorKind } from "./errors";

/** Tables the admin API exposes. `status` and `audit` are read-only. */
export const GSLB_TABLES = [
  "domains",
  "monitors",
  "views",
  "records",
  "routings",
  "types",
  "users",
  "status",
  "audit",
] as const;

export type GslbTable = (typeof GSLB_TABLES)[number];

/** Tables `save-record` / `delete-records` accept. */
export type GslbWritableTable = Exclude<GslbTable, "status" | "audit">;

/** One row as PowerGSLB returns it. */
export interface GslbRow {
  recid: number;
  [column: string]: unknown;
}

/**
 * One w2ui grid search clause, sent as `search[i][field|type|operator|value]`.
 * Clauses combine with AND. PowerGSLB SILENTLY DROPS a clause whose type or
 * operator it doesn't know and then matches every row, so callers must still
 * filter the result themselves - treat the search as a narrowing hint only.
 */
export interface GslbSearch {
  field: string;
  /** Text equality (`is`) is case-insensitive: PowerGSLB's MySQL collation is `_ci`. */
  operator: "is" | "begins" | "contains" | "ends";
  value: string;
}

/** A page of rows plus the total match count (for paging). */
export interface GslbPage {
  records: GslbRow[];
  total: number;
}

/**
 * Field values for `save-record`. PowerGSLB form-decodes everything as
 * strings; numbers are stringified on the wire. Booleans are deliberately not
 * accepted - columns like `disabled` are 0/1 and the caller should say which.
 */
export type GslbRecordFields = Record<string, string | number>;

export interface GslbProbeCounts {
  domains: number;
  monitors: number;
  views: number;
  records: number;
}

export type GslbProbeResult =
  | { ok: true; latencyMs: number; counts: GslbProbeCounts }
  | {
      ok: false;
      kind: GslbErrorKind;
      /** Redacted upstream / transport message - for logs, not the UI. */
      message: string;
      latencyMs?: number;
    };
