/**
 * lib/gslb/client.ts
 *
 * Typed client for the PowerGSLB 2.4 w2ui admin API. All PowerGSLB access in
 * the app goes through here (ADR-0024), the same way PDNS access goes through
 * `lib/pdns/client.ts`.
 *
 * The service account is a full PowerGSLB admin - PowerGSLB has no roles - so
 * RBAC and audit are enforced *above* this client, never inside it.
 *
 * Protocol notes that shape the API below:
 *   - `limit` is honored only together with `offset` (PowerGSLB's
 *     `PageRequest.from_query`), so paging always sends both.
 *   - `save-record` with `recid=0` inserts and returns no id; with a real
 *     recid it overwrites the WHOLE row, so updates must resend every column.
 */

import "server-only";
import { z } from "zod";
import { GslbError } from "./errors";
import { gslbRequest, type GslbHttpConfig } from "./http";
import type {
  GslbPage,
  GslbProbeCounts,
  GslbProbeResult,
  GslbRecordFields,
  GslbRow,
  GslbSearch,
  GslbTable,
  GslbWritableTable,
} from "./types";

const rowSchema = z.looseObject({ recid: z.coerce.number().int() });

const pageSchema = z.object({
  records: z.array(rowSchema),
  total: z.coerce.number().int().nonnegative(),
});

const singleSchema = z.object({ record: rowSchema });

/** Tables the connection probe counts; together they prove read access to the data the panel manages. */
const PROBE_TABLES = ["domains", "monitors", "views", "records"] as const;

export class GslbClient {
  private readonly config: GslbHttpConfig;

  public constructor(config: GslbHttpConfig) {
    this.config = config;
  }

  /**
   * List rows of a table, optionally filtered and paged. See `GslbSearch` for
   * why a search result must still be filtered by the caller.
   *
   * @throws {GslbError}
   */
  public async getRecords(
    data: GslbTable,
    page: { limit?: number; offset?: number; search?: readonly GslbSearch[] } = {},
  ): Promise<GslbPage> {
    const params: Array<[string, string]> = [];
    if (page.limit !== undefined) {
      params.push(["limit", String(page.limit)], ["offset", String(page.offset ?? 0)]);
    }
    if (page.search && page.search.length > 0) {
      page.search.forEach((clause, index) => {
        params.push(
          [`search[${index}][field]`, clause.field],
          [`search[${index}][type]`, "text"],
          [`search[${index}][operator]`, clause.operator],
          [`search[${index}][value]`, clause.value],
        );
      });
      params.push(["searchLogic", "AND"]);
    }
    const envelope = await gslbRequest(this.config, { cmd: "get-records", data, params });
    const parsed = pageSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new GslbError("protocol", `get-records '${data}' reply has an unknown shape.`);
    }
    return { records: parsed.data.records, total: parsed.data.total };
  }

  /**
   * Fetch one row by id. PowerGSLB reports a missing id as `status: "error"`,
   * which surfaces as `GslbError` kind `upstream`.
   *
   * @throws {GslbError}
   */
  public async getRecord(data: GslbTable, recid: number): Promise<GslbRow> {
    const envelope = await gslbRequest(this.config, {
      cmd: "get-record",
      data,
      params: [["recid", String(recid)]],
    });
    const parsed = singleSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new GslbError("protocol", `get-record '${data}' reply has an unknown shape.`);
    }
    return parsed.data.record;
  }

  /**
   * Insert (`recid` 0) or overwrite (`recid` > 0) one row. An overwrite
   * replaces every column, so pass the full row - read it first.
   *
   * @throws {GslbError}
   */
  public async saveRecord(
    data: GslbWritableTable,
    recid: number,
    fields: GslbRecordFields,
  ): Promise<void> {
    const params: Array<[string, string]> = [["recid", String(recid)]];
    for (const [column, value] of Object.entries(fields)) {
      params.push([`record[${column}]`, String(value)]);
    }
    await gslbRequest(this.config, { cmd: "save-record", data, params });
  }

  /**
   * Delete rows by id. A no-op for an empty list (PowerGSLB would reject it).
   *
   * @throws {GslbError}
   */
  public async deleteRecords(data: GslbWritableTable, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    const params = ids.map((id, index): [string, string] => [`selected[${index}]`, String(id)]);
    await gslbRequest(this.config, { cmd: "delete-records", data, params });
  }

  /**
   * Connection check for the admin Test action: one timed round-trip, then the
   * row count of each managed table. Never throws for a GSLB failure - the
   * verdict is returned so the caller can persist it either way.
   */
  public async probe(): Promise<GslbProbeResult> {
    const [first, ...rest] = PROBE_TABLES;
    const start = Date.now();
    try {
      // Time a single request on its own so latency means one round-trip, not
      // the slowest of four parallel ones.
      const firstPage = await this.getRecords(first, { limit: 1 });
      const latencyMs = Date.now() - start;
      const restPages = await Promise.all(
        rest.map((table) => this.getRecords(table, { limit: 1 })),
      );
      const counts = Object.fromEntries([
        [first, firstPage.total],
        ...rest.map((table, index) => [table, restPages[index]!.total]),
      ]) as unknown as GslbProbeCounts;
      return { ok: true, latencyMs, counts };
    } catch (err) {
      if (err instanceof GslbError) {
        return { ok: false, kind: err.kind, message: err.message, latencyMs: Date.now() - start };
      }
      throw err;
    }
  }
}
