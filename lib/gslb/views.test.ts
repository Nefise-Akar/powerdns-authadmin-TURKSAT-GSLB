/**
 * lib/gslb/views.test.ts
 *
 * Owned-view helpers, drift, and the DB/remote write ordering in
 * region-sync.ts, against an in-memory fake of PowerGSLB's views + records
 * tables. The fake mimics the two behaviours the helpers defend against:
 * case-insensitive name/rule uniqueness and `save-record` returning no id.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GslbClient } from "./client";
import { GslbError } from "./errors";
import {
  createRegionSynced,
  deleteRegionSynced,
  resyncRegion,
  updateRegionSynced,
} from "./region-sync";
import type { GslbRecordFields, GslbRow, GslbSearch } from "./types";
import {
  computeRegionDrift,
  countRecordsUsingView,
  deleteOwnedView,
  findViewByName,
  GslbRuleConflictError,
  GslbViewInUseError,
  listOwnedViews,
  ownedViewName,
  pushOwnedView,
} from "./views";

interface FakeView {
  recid: number;
  view: string;
  rule: string;
}

class FakeGslb {
  public views: FakeView[] = [];
  public records: Array<{ recid: number; view: string }> = [];
  public saves: Array<{ recid: number; fields: GslbRecordFields }> = [];
  public deletes: number[][] = [];
  /** Simulate PowerGSLB dropping an unknown search clause (matches everything). */
  public ignoreSearch = false;
  private nextId = 100;

  private match(row: Record<string, unknown>, search: readonly GslbSearch[] = []): boolean {
    if (this.ignoreSearch) return true;
    return search.every((clause) => {
      const cell = row[clause.field];
      const value = (typeof cell === "string" ? cell : "").toLowerCase();
      const wanted = clause.value.toLowerCase();
      if (clause.operator === "is") return value === wanted;
      if (clause.operator === "begins") return value.startsWith(wanted);
      return value.includes(wanted);
    });
  }

  public client(): GslbClient {
    const fake = {
      getRecords: vi.fn((data: string, page: { search?: readonly GslbSearch[] } = {}) => {
        const table: GslbRow[] =
          data === "views" ? [...this.views] : data === "records" ? [...this.records] : [];
        const rows = table.filter((row) => this.match(row, page.search));
        return Promise.resolve({ records: rows, total: rows.length });
      }),
      saveRecord: vi.fn((data: string, recid: number, fields: GslbRecordFields) => {
        expect(data).toBe("views");
        this.saves.push({ recid, fields });
        const view = String(fields["view"]);
        const rule = String(fields["rule"]);
        const clash = this.views.find(
          (v) =>
            v.recid !== recid &&
            (v.view.toLowerCase() === view.toLowerCase() ||
              v.rule.toLowerCase() === rule.toLowerCase()),
        );
        if (clash)
          return Promise.reject(new GslbError("upstream", "PowerGSLB error: internal error"));
        if (recid === 0) this.views.push({ recid: this.nextId++, view, rule });
        else Object.assign(this.views.find((v) => v.recid === recid)!, { view, rule });
        return Promise.resolve();
      }),
      deleteRecords: vi.fn((_data: string, ids: readonly number[]) => {
        this.deletes.push([...ids]);
        this.views = this.views.filter((v) => !ids.includes(v.recid));
        return Promise.resolve();
      }),
    };
    return fake as unknown as GslbClient;
  }
}

let gslb: FakeGslb;
let client: GslbClient;

beforeEach(() => {
  gslb = new FakeGslb();
  client = gslb.client();
});

describe("view lookups", () => {
  it("finds a view by exact, case-insensitive name", async () => {
    gslb.views.push({ recid: 1, view: "authadmin:site-a", rule: "10.0.0.0/8" });
    expect(await findViewByName(client, "AUTHADMIN:site-a")).toMatchObject({ recid: 1 });
    expect(await findViewByName(client, "authadmin:site")).toBeNull();
  });

  it("filters client-side when PowerGSLB ignores the search clause", async () => {
    gslb.ignoreSearch = true;
    gslb.views.push(
      { recid: 1, view: "Public", rule: "0.0.0.0/0 ::/0" },
      { recid: 2, view: "authadmin:site-a", rule: "10.0.0.0/8" },
    );
    expect(await findViewByName(client, "authadmin:site-a")).toMatchObject({ recid: 2 });
    expect((await listOwnedViews(client)).map((v) => v.view)).toEqual(["authadmin:site-a"]);
    gslb.records.push({ recid: 9, view: "Public" });
    expect(await countRecordsUsingView(client, "authadmin:site-a")).toBe(0);
  });

  it("lists only owned views", async () => {
    gslb.views.push(
      { recid: 1, view: "Public", rule: "0.0.0.0/0 ::/0" },
      { recid: 2, view: "authadmin:b", rule: "10.2.0.0/16" },
      { recid: 3, view: "Office", rule: "192.168.0.0/16" },
    );
    expect((await listOwnedViews(client)).map((v) => v.recid)).toEqual([2]);
  });
});

describe("pushOwnedView", () => {
  it("inserts with recid 0 and reads the new row back", async () => {
    const view = await pushOwnedView(client, "authadmin:a", "10.1.0.0/16 country:DE");
    expect(gslb.saves).toEqual([
      { recid: 0, fields: { view: "authadmin:a", rule: "10.1.0.0/16 country:DE" } },
    ]);
    expect(view).toEqual({ recid: 100, view: "authadmin:a", rule: "10.1.0.0/16 country:DE" });
  });

  it("overwrites an existing view in place", async () => {
    gslb.views.push({ recid: 7, view: "authadmin:a", rule: "10.1.0.0/16" });
    await pushOwnedView(client, "authadmin:a", "10.2.0.0/16");
    expect(gslb.saves[0]?.recid).toBe(7);
    expect(gslb.views).toEqual([{ recid: 7, view: "authadmin:a", rule: "10.2.0.0/16" }]);
  });

  it("skips the write when the rule already matches (ignoring case and spacing)", async () => {
    gslb.views.push({ recid: 7, view: "authadmin:a", rule: "10.1.0.0/16  country:de" });
    await pushOwnedView(client, "authadmin:a", "10.1.0.0/16 country:DE");
    expect(gslb.saves).toEqual([]);
  });

  it("names the view that already holds the rule", async () => {
    gslb.views.push({ recid: 3, view: "Office", rule: "10.1.0.0/16" });
    await expect(pushOwnedView(client, "authadmin:a", "10.1.0.0/16")).rejects.toBeInstanceOf(
      GslbRuleConflictError,
    );
    expect(gslb.saves).toEqual([]);
  });

  it("refuses to write a view outside the owned prefix", async () => {
    await expect(pushOwnedView(client, "Public", "10.0.0.0/8")).rejects.toThrow(/non-owned/);
  });
});

describe("deleteOwnedView", () => {
  it("deletes an unused owned view", async () => {
    gslb.views.push({ recid: 5, view: "authadmin:a", rule: "10.1.0.0/16" });
    expect(await deleteOwnedView(client, "authadmin:a")).toBe(true);
    expect(gslb.deletes).toEqual([[5]]);
  });

  it("reports an already-missing view without deleting anything", async () => {
    expect(await deleteOwnedView(client, "authadmin:a")).toBe(false);
    expect(gslb.deletes).toEqual([]);
  });

  it("refuses while GSLB records use the view", async () => {
    gslb.views.push({ recid: 5, view: "authadmin:a", rule: "10.1.0.0/16" });
    gslb.records.push({ recid: 1, view: "authadmin:a" }, { recid: 2, view: "authadmin:a" });
    const err = await deleteOwnedView(client, "authadmin:a").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GslbViewInUseError);
    expect((err as GslbViewInUseError).recordCount).toBe(2);
    expect(gslb.deletes).toEqual([]);
  });
});

describe("computeRegionDrift", () => {
  it("classifies in-sync, missing, rule-differs and orphans", () => {
    const regions = [
      { id: "1", slug: "a", rules: ["10.1.0.0/16"] },
      { id: "2", slug: "b", rules: ["10.2.0.0/16"] },
      { id: "3", slug: "c", rules: ["10.3.0.0/16", "country:DE"] },
    ];
    const views = [
      { recid: 1, view: "authadmin:a", rule: "10.1.0.0/16" },
      { recid: 3, view: "authadmin:c", rule: "10.3.0.0/16" },
      { recid: 4, view: "authadmin:old", rule: "10.9.0.0/16" },
    ];
    expect(computeRegionDrift(regions, views)).toEqual({
      regions: [
        { regionId: "1", status: "in-sync" },
        { regionId: "2", status: "missing" },
        { regionId: "3", status: "rule-differs", remoteRule: "10.3.0.0/16" },
      ],
      orphans: [{ recid: 4, view: "authadmin:old", rule: "10.9.0.0/16" }],
    });
  });
});

describe("region-sync ordering", () => {
  const region = { id: "r1", slug: "a", rules: ["10.1.0.0/16"] };

  it("create: inserts locally, then pushes the view", async () => {
    const order: string[] = [];
    const result = await createRegionSynced({
      backendId: "b1",
      client,
      insertLocal: () => {
        order.push("db");
        return Promise.resolve(region);
      },
      removeLocal: () => {
        order.push("rollback");
        return Promise.resolve();
      },
    });
    expect(order).toEqual(["db"]);
    expect(result.view.view).toBe(ownedViewName("a"));
  });

  it("create: removes the local row when PowerGSLB refuses", async () => {
    gslb.views.push({ recid: 3, view: "Office", rule: "10.1.0.0/16" });
    const removeLocal = vi.fn(() => Promise.resolve());
    await expect(
      createRegionSynced({
        backendId: "b1",
        client,
        insertLocal: () => Promise.resolve(region),
        removeLocal,
      }),
    ).rejects.toBeInstanceOf(GslbRuleConflictError);
    expect(removeLocal).toHaveBeenCalledWith(region);
  });

  it("update: pushes first and skips the DB when the push fails", async () => {
    const updateLocal = vi.fn(() => Promise.resolve(region));
    gslb.views.push({ recid: 3, view: "Office", rule: "10.5.0.0/16" });
    await expect(
      updateRegionSynced({
        backendId: "b1",
        client,
        next: { slug: "a", rules: ["10.5.0.0/16"] },
        updateLocal,
      }),
    ).rejects.toBeInstanceOf(GslbRuleConflictError);
    expect(updateLocal).not.toHaveBeenCalled();
  });

  it("delete: keeps the local row while the view is in use", async () => {
    gslb.views.push({ recid: 5, view: "authadmin:a", rule: "10.1.0.0/16" });
    gslb.records.push({ recid: 1, view: "authadmin:a" });
    const deleteLocal = vi.fn(() => Promise.resolve());
    await expect(
      deleteRegionSynced({ backendId: "b1", client, region, deleteLocal }),
    ).rejects.toBeInstanceOf(GslbViewInUseError);
    expect(deleteLocal).not.toHaveBeenCalled();
  });

  it("delete: deletes locally even when the view is already gone", async () => {
    const deleteLocal = vi.fn(() => Promise.resolve());
    const result = await deleteRegionSynced({ backendId: "b1", client, region, deleteLocal });
    expect(result).toEqual({ remoteDeleted: false });
    expect(deleteLocal).toHaveBeenCalledOnce();
  });

  it("resync: rewrites a drifted view from the region", async () => {
    gslb.views.push({ recid: 5, view: "authadmin:a", rule: "10.9.0.0/16" });
    await resyncRegion({ backendId: "b1", client, region });
    expect(gslb.views).toEqual([{ recid: 5, view: "authadmin:a", rule: "10.1.0.0/16" }]);
  });

  it("serializes concurrent writes to one backend", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = createRegionSynced({
      backendId: "b-lock",
      client,
      insertLocal: async () => {
        events.push("first:start");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push("first:end");
        return region;
      },
      removeLocal: () => Promise.resolve(),
    });
    const second = resyncRegion({
      backendId: "b-lock",
      client,
      region: { slug: "b", rules: ["10.2.0.0/16"] },
    }).then(() => events.push("second"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });
});
