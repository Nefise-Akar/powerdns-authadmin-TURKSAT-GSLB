/**
 * lib/gslb/record-sync.test.ts
 *
 * Write ordering + rollback for per-record GSLB against an in-memory PowerGSLB
 * (all tables, with its FK and unique-key refusals) and an in-memory parent
 * zone. The point is the invariants: the parent never CNAMEs into an empty
 * name, a failed parent write removes the rows, a changed parent blocks
 * disable, and nothing outside `authadmin:` / the panel's domain is touched.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GslbClient } from "./client";
import { GslbError } from "./errors";
import type { GslbMember } from "./model";
import { recordTarget, type ParentChange, type ZoneRRset } from "./record-plan";
import {
  disableGslbRecord,
  enableGslbRecord,
  GslbCleanupRequiredError,
  GslbPlanError,
  removeGslbDomain,
  updateGslbRecord,
  type ParentZonePort,
} from "./record-sync";
import type { GslbRecordFields, GslbRow, GslbSearch } from "./types";

type Row = GslbRow & Record<string, unknown>;

class FakeGslb {
  public tables: Record<string, Row[]> = {
    types: ["A", "AAAA", "CNAME", "NS", "SOA"].map((t, i) => ({ recid: i + 1, name_type: t })),
    views: [
      { recid: 1, view: "Public", rule: "0.0.0.0/0 ::/0" },
      { recid: 2, view: "authadmin:site-a", rule: "10.1.0.0/16" },
      { recid: 3, view: "Office", rule: "192.168.0.0/16" },
    ],
    monitors: [{ recid: 1, monitor: "Hand made", monitor_json: '{"type":"none"}' }],
    routings: [],
    domains: [],
    records: [],
    status: [],
  };
  public writes: Array<{ table: string; recid: number; fields: GslbRecordFields }> = [];
  public failSaveWhen: ((table: string, fields: GslbRecordFields) => boolean) | null = null;
  /** Accept the write but store nothing - a row PowerGSLB lost. */
  public dropSaveWhen: ((table: string, fields: GslbRecordFields) => boolean) | null = null;
  private nextId = 1000;

  private matches(row: Row, search: readonly GslbSearch[] = []): boolean {
    return search.every((clause) => {
      const cell = row[clause.field];
      const value = (typeof cell === "string" ? cell : "").toLowerCase();
      return clause.operator === "is"
        ? value === clause.value.toLowerCase()
        : value.startsWith(clause.value.toLowerCase());
    });
  }

  public client(): GslbClient {
    return {
      getRecords: vi.fn((data: string, page: { search?: readonly GslbSearch[] } = {}) => {
        const rows = (
          data === "status" ? this.tables["records"]! : (this.tables[data] ?? [])
        ).filter((r) => this.matches(r, page.search));
        const out = data === "status" ? rows.map((r) => ({ ...r, status: "On" })) : rows;
        return Promise.resolve({ records: out.map((r) => ({ ...r })), total: out.length });
      }),
      saveRecord: vi.fn((data: string, recid: number, fields: GslbRecordFields) => {
        if (this.failSaveWhen?.(data, fields)) {
          return Promise.reject(new GslbError("upstream", "PowerGSLB error: internal error"));
        }
        this.writes.push({ table: data, recid, fields });
        const table = this.tables[data]!;
        if (data === "records") {
          const known = (t: string, field: string, value: unknown) =>
            this.tables[t]!.some(
              (r) =>
                typeof r[field] === "string" &&
                typeof value === "string" &&
                r[field].toLowerCase() === value.toLowerCase(),
            );
          // PowerGSLB resolves these by name in subqueries; a miss is an SQL error.
          if (
            !known("domains", "domain", fields["domain"]) ||
            !known("views", "view", fields["view"]) ||
            !known("monitors", "monitor", fields["monitor"]) ||
            !known("routings", "policy", fields["policy"])
          ) {
            return Promise.reject(new GslbError("upstream", "PowerGSLB error: internal error"));
          }
          const clash = table.some(
            (r) =>
              r.recid !== recid &&
              r["domain"] === fields["domain"] &&
              r["name"] === fields["name"] &&
              r["name_type"] === fields["name_type"] &&
              r["view"] === fields["view"] &&
              r["content"] === fields["content"],
          );
          if (clash)
            return Promise.reject(new GslbError("upstream", "PowerGSLB error: internal error"));
          // PowerGSLB's records_before_insert/update triggers.
          const secondCname =
            String(fields["name_type"]) === "CNAME" &&
            table.some(
              (r) =>
                r.recid !== recid &&
                r["domain"] === fields["domain"] &&
                r["name"] === fields["name"] &&
                r["name_type"] === "CNAME" &&
                r["view"] === fields["view"],
            );
          if (secondCname) {
            return Promise.reject(
              new GslbError("upstream", "CNAME rrset allows one record per view"),
            );
          }
        }
        if (this.dropSaveWhen?.(data, fields)) return Promise.resolve();
        if (recid === 0) table.push({ recid: this.nextId++, ...fields });
        else Object.assign(table.find((r) => r.recid === recid)!, fields);
        return Promise.resolve();
      }),
      deleteRecords: vi.fn((data: string, ids: readonly number[]) => {
        this.tables[data] = this.tables[data]!.filter((r) => !ids.includes(r.recid));
        return Promise.resolve();
      }),
    } as unknown as GslbClient;
  }

  public rowsAt(label: string, domain = "gslb.example.com"): Row[] {
    return this.tables["records"]!.filter((r) => r["domain"] === domain && r["name"] === label);
  }
}

class FakeParent implements ParentZonePort {
  public applied: ParentChange[][] = [];
  public failNextApplyWith: Error | null = null;
  public constructor(public rrsets: ZoneRRset[]) {}

  public read(): Promise<ZoneRRset[]> {
    return Promise.resolve(this.rrsets.map((rr) => ({ ...rr, records: [...rr.records] })));
  }

  public apply(changes: ParentChange[]): Promise<void> {
    if (this.failNextApplyWith) {
      const err = this.failNextApplyWith;
      this.failNextApplyWith = null;
      return Promise.reject(err);
    }
    this.applied.push(changes);
    for (const change of changes) {
      this.rrsets = this.rrsets.filter(
        (rr) => !(rr.name === change.name && rr.type === change.type),
      );
      if (change.kind === "upsert") {
        this.rrsets.push({
          name: change.name,
          type: change.type,
          ttl: change.ttl,
          records: change.records,
        });
      }
    }
    return Promise.resolve();
  }

  public at(name: string): ZoneRRset[] {
    return this.rrsets.filter((rr) => rr.name === name);
  }
}

const ZONE = "example.com.";
const NAME = "www.example.com.";
const MEMBERS: GslbMember[] = [
  { content: "192.0.2.10", region: "site-a", weight: 10 },
  { content: "192.0.2.20", region: null, weight: 10 },
];
const SETTINGS = {
  method: "round-robin" as const,
  persistence: false,
  monitor: { type: "http" as const, path: "/health", expectedStatus: "200-399" },
  ttl: 30,
  members: MEMBERS,
};
const DELEGATION = { nameserverHost: "ns1.gslb.example.com.", nameserverAddresses: ["192.0.2.53"] };

let gslb: FakeGslb;
let client: GslbClient;
let parent: FakeParent;

function enableArgs(
  overrides: Partial<Parameters<typeof enableGslbRecord>[0]> & { name?: string } = {},
) {
  const name = overrides.name ?? NAME;
  return {
    backendId: "backend-1",
    client,
    zoneName: ZONE,
    name,
    target: recordTarget(name, ZONE),
    kind: "address" as const,
    settings: SETTINGS,
    delegation: DELEGATION,
    zoneEnabled: false,
    parent,
    assertUnchanged: () => undefined,
    persistZone: vi.fn(() => Promise.resolve()),
    persistRecord: vi.fn(() => Promise.resolve()),
    now: new Date("2026-10-14T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  gslb = new FakeGslb();
  client = gslb.client();
  parent = new FakeParent([
    { name: ZONE, type: "SOA", ttl: 3600, records: [{ content: "ns. h. 1 2 3 4 5" }] },
    { name: NAME, type: "A", ttl: 300, records: [{ content: "192.0.2.10" }] },
  ]);
});

describe("enableGslbRecord", () => {
  it("sets up the zone, writes rows, then switches the parent to the CNAME", async () => {
    const args = enableArgs();
    const result = await enableGslbRecord(args);

    expect(gslb.tables["domains"]!.map((d) => d["domain"])).toEqual(["gslb.example.com"]);
    expect(
      gslb
        .rowsAt("@")
        .map((r) => r["name_type"])
        .sort(),
    ).toEqual(["NS", "SOA"]);
    expect(
      gslb
        .rowsAt("www")
        .map((r) => `${String(r["view"])} ${String(r["content"])}`)
        .sort(),
    ).toEqual(["Public 192.0.2.10", "Public 192.0.2.20", "authadmin:site-a 192.0.2.10"]);
    expect(result.remoteRowIds).toHaveLength(3);
    expect(result.snapshot).toEqual([
      { name: NAME, type: "A", ttl: 300, records: [{ content: "192.0.2.10" }], comments: [] },
    ]);

    // Delegation first, record switch second.
    expect(
      parent.applied.map((batch) => batch.map((c) => `${c.kind} ${c.name} ${c.type}`)),
    ).toEqual([
      ["upsert gslb.example.com. NS", "upsert ns1.gslb.example.com. A"],
      [`delete ${NAME} A`, `upsert ${NAME} CNAME`],
    ]);
    expect(parent.at(NAME)).toEqual([
      {
        name: NAME,
        type: "CNAME",
        ttl: 300,
        records: [{ content: "www.gslb.example.com.", disabled: false }],
      },
    ]);
    expect(args.persistZone).toHaveBeenCalledOnce();
    expect(args.persistRecord).toHaveBeenCalledOnce();
  });

  it("creates only authadmin: monitors/routings and leaves hand-made objects alone", async () => {
    await enableGslbRecord(enableArgs());
    const writtenNames = gslb.writes
      .filter((w) => w.table === "monitors" || w.table === "routings")
      .map((w) => String(w.fields["monitor"] ?? w.fields["policy"]));
    expect(writtenNames.every((n) => n.startsWith("authadmin:"))).toBe(true);
    expect(gslb.tables["monitors"]!.find((m) => m["monitor"] === "Hand made")).toBeTruthy();
    expect(gslb.writes.some((w) => w.table === "views")).toBe(false);
  });

  it("is idempotent for an already-enabled zone", async () => {
    await enableGslbRecord(enableArgs());
    parent.rrsets.push({
      name: "api.example.com.",
      type: "A",
      ttl: 60,
      records: [{ content: "192.0.2.30" }],
    });
    const second = enableArgs({ name: "api.example.com.", zoneEnabled: true });
    await enableGslbRecord(second);
    expect(second.persistZone).not.toHaveBeenCalled();
    expect(parent.applied).toHaveLength(3);
    expect(gslb.tables["domains"]).toHaveLength(1);
  });

  it("deletes the rows again when the parent write fails", async () => {
    await enableGslbRecord(enableArgs()); // zone set up
    parent.rrsets.push({
      name: "api.example.com.",
      type: "A",
      ttl: 60,
      records: [{ content: "192.0.2.30" }],
    });
    parent.failNextApplyWith = new Error("PDNS said no");
    const args = enableArgs({ name: "api.example.com.", zoneEnabled: true });

    await expect(enableGslbRecord(args)).rejects.toThrow("PDNS said no");
    expect(gslb.rowsAt("api")).toEqual([]);
    expect(parent.at("api.example.com.")[0]?.type).toBe("A");
    expect(args.persistRecord).not.toHaveBeenCalled();
  });

  it("deletes the rows when a row write fails midway, before touching the parent", async () => {
    gslb.failSaveWhen = (table, fields) =>
      table === "records" && fields["content"] === "192.0.2.20";
    await expect(enableGslbRecord(enableArgs())).rejects.toBeInstanceOf(GslbError);
    expect(gslb.rowsAt("www")).toEqual([]);
    expect(parent.at(NAME)[0]?.type).toBe("A");
  });

  it("rolls the switch back when persisting fails after the parent was switched", async () => {
    const args = enableArgs({ persistRecord: vi.fn(() => Promise.reject(new Error("db down"))) });
    const failure = enableGslbRecord(args);
    await expect(failure).rejects.toBeInstanceOf(GslbPlanError);
    await expect(failure).rejects.toThrow(/put back as it was/);
    // Parent restored exactly, then the rows removed - no untracked CNAME.
    expect(parent.at(NAME)).toEqual([
      {
        name: NAME,
        type: "A",
        ttl: 300,
        records: [{ content: "192.0.2.10", disabled: false }],
      },
    ]);
    expect(gslb.rowsAt("www")).toEqual([]);
  });

  it("says exactly what to clean up when the rollback itself fails", async () => {
    const args = enableArgs({
      persistRecord: vi.fn(() => {
        parent.failNextApplyWith = new Error("PDNS down");
        return Promise.reject(new Error("db down"));
      }),
    });
    const failure = enableGslbRecord(args);
    await expect(failure).rejects.toBeInstanceOf(GslbCleanupRequiredError);
    await expect(failure).rejects.toThrow(
      /www\.example\.com\. may still be a CNAME to www\.gslb\.example\.com\..*\(A 192\.0\.2\.10\).*rows named "www" in domain gslb\.example\.com/,
    );
    // Nothing more was removed: the CNAME still has its rows behind it.
    expect(parent.at(NAME)[0]?.type).toBe("CNAME");
    expect(gslb.rowsAt("www")).toHaveLength(3);
  });

  it("serves an in-bailiwick nameserver's own address from the GSLB domain", async () => {
    await enableGslbRecord(enableArgs());
    expect(
      gslb.rowsAt("ns1").map((r) => [r["name_type"], r["content"], r["view"], r["monitor"]]),
    ).toEqual([["A", "192.0.2.53", "Public", "authadmin:none"]]);
    // Idempotent: a second record doesn't duplicate them.
    parent.rrsets.push({
      name: "api.example.com.",
      type: "A",
      ttl: 60,
      records: [{ content: "192.0.2.30" }],
    });
    await enableGslbRecord(enableArgs({ name: "api.example.com.", zoneEnabled: true }));
    expect(gslb.rowsAt("ns1")).toHaveLength(1);
  });

  it("refuses a name whose GSLB target is the nameserver's own name", async () => {
    parent.rrsets.push({
      name: "ns1.example.com.",
      type: "A",
      ttl: 60,
      records: [{ content: "192.0.2.40" }],
    });
    await expect(enableGslbRecord(enableArgs({ name: "ns1.example.com." }))).rejects.toThrow(
      /GSLB nameserver's own name/,
    );
    expect(parent.applied).toEqual([]);
  });

  it("refuses an ineligible name, a missing nameserver, or a parent changed since load", async () => {
    parent.rrsets.push({ name: NAME, type: "TXT", ttl: 60, records: [{ content: '"x"' }] });
    await expect(enableGslbRecord(enableArgs())).rejects.toThrow(
      "This name also has a TXT record.",
    );
    parent.rrsets = parent.rrsets.filter((rr) => rr.type !== "TXT");

    await expect(
      enableGslbRecord(
        enableArgs({ delegation: { nameserverHost: null, nameserverAddresses: null } }),
      ),
    ).rejects.toBeInstanceOf(GslbPlanError);

    await expect(
      enableGslbRecord(
        enableArgs({
          assertUnchanged: () => {
            throw new GslbPlanError("changed");
          },
        }),
      ),
    ).rejects.toThrow("changed");
    expect(parent.applied).toEqual([]);
    expect(gslb.rowsAt("www")).toEqual([]);
  });

  it("refuses a region whose view doesn't exist in PowerGSLB", async () => {
    await expect(
      enableGslbRecord(
        enableArgs({
          settings: {
            ...SETTINGS,
            members: [{ content: "192.0.2.10", region: "missing", weight: 1 }],
          },
        }),
      ),
    ).rejects.toThrow(/no view "authadmin:missing"/);
    expect(parent.at(NAME)[0]?.type).toBe("A");
  });
});

describe("updateGslbRecord", () => {
  it("diffs rows in place and leaves the parent alone", async () => {
    await enableGslbRecord(enableArgs());
    const appliedBefore = parent.applied.length;
    const persist = vi.fn(() => Promise.resolve());
    const ids = await updateGslbRecord({
      backendId: "backend-1",
      client,
      target: recordTarget(NAME, ZONE),
      kind: "address",
      settings: {
        ...SETTINGS,
        method: "ratio",
        members: [
          { content: "192.0.2.10", region: "site-a", weight: 5 },
          { content: "192.0.2.30", region: null, weight: 1 },
        ],
      },
      persistRecord: persist,
    });
    expect(
      gslb
        .rowsAt("www")
        .map((r) => `${String(r["view"])} ${String(r["content"])} ${String(r["weight"])}`)
        .sort(),
    ).toEqual(["Public 192.0.2.10 5", "Public 192.0.2.30 1", "authadmin:site-a 192.0.2.10 5"]);
    expect(ids).toHaveLength(3);
    expect(persist).toHaveBeenCalledWith(ids);
    expect(parent.applied).toHaveLength(appliedBefore);
  });
});

describe("updateGslbRecord safety", () => {
  it("fails loudly when PowerGSLB holds fewer rows than were written", async () => {
    await enableGslbRecord(enableArgs());
    gslb.dropSaveWhen = (table, fields) =>
      table === "records" && fields["content"] === "192.0.2.30";
    const persist = vi.fn(() => Promise.resolve());
    await expect(
      updateGslbRecord({
        backendId: "backend-1",
        client,
        target: recordTarget(NAME, ZONE),
        kind: "address",
        settings: {
          ...SETTINGS,
          members: [...MEMBERS, { content: "192.0.2.30", region: null, weight: 10 }],
        },
        persistRecord: persist,
      }),
    ).rejects.toBeInstanceOf(GslbCleanupRequiredError);
    expect(persist).not.toHaveBeenCalled();
  });

  it("changes a CNAME target in place - one record per view is never exceeded", async () => {
    const app = "app.example.com.";
    parent.rrsets.push({
      name: app,
      type: "CNAME",
      ttl: 60,
      records: [{ content: "a.example.net." }],
    });
    const cname = {
      ...SETTINGS,
      method: "global-availability" as const,
      members: [{ content: "a.example.net.", region: "site-a", weight: 10 }],
    };
    await enableGslbRecord(enableArgs({ name: app, kind: "cname", settings: cname }));
    const idsBefore = gslb
      .rowsAt("app")
      .map((r) => r.recid)
      .sort();

    await updateGslbRecord({
      backendId: "backend-1",
      client,
      target: recordTarget(app, ZONE),
      kind: "cname",
      settings: {
        ...cname,
        members: [{ content: "b.example.net.", region: "site-a", weight: 10 }],
      },
      persistRecord: () => Promise.resolve(),
    });
    const rows = gslb.rowsAt("app");
    expect(rows.map((r) => r.recid).sort()).toEqual(idsBefore);
    expect(rows.map((r) => `${String(r["view"])} ${String(r["content"])}`).sort()).toEqual([
      "Public b.example.net",
      "authadmin:site-a b.example.net",
    ]);
  });
});

describe("changing the method on an enabled record", () => {
  it("rewrites weights and policy in place - the name is never emptied", async () => {
    await enableGslbRecord(enableArgs());
    const idsBefore = gslb
      .rowsAt("www")
      .map((r) => r.recid)
      .sort();
    const deletesBefore = (client.deleteRecords as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length;

    await updateGslbRecord({
      backendId: "backend-1",
      client,
      target: recordTarget(NAME, ZONE),
      kind: "address",
      settings: { ...SETTINGS, method: "global-availability" },
      persistRecord: () => Promise.resolve(),
    });

    const rows = gslb.rowsAt("www");
    expect(rows.map((r) => r.recid).sort()).toEqual(idsBefore);
    expect(
      rows.map((r) => `${String(r["view"])} ${String(r["content"])} ${String(r["weight"])}`).sort(),
    ).toEqual(["Public 192.0.2.10 20", "Public 192.0.2.20 10", "authadmin:site-a 192.0.2.10 20"]);
    // Only an empty `delete-records` for removals - nothing was deleted.
    const deletes = (client.deleteRecords as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(deletes.length - deletesBefore).toBeLessThanOrEqual(1);
    expect(parent.at(NAME)[0]?.type).toBe("CNAME");
  });

  it("creates the owned sticky policy on demand for persistence", async () => {
    await enableGslbRecord(enableArgs());
    await updateGslbRecord({
      backendId: "backend-1",
      client,
      target: recordTarget(NAME, ZONE),
      kind: "address",
      settings: { ...SETTINGS, method: "round-robin", persistence: true },
      persistRecord: () => Promise.resolve(),
    });
    expect(gslb.tables["routings"]!.map((r) => r["policy"])).toContain("authadmin:sticky");
    expect(new Set(gslb.rowsAt("www").map((r) => r["policy"]))).toEqual(
      new Set(["authadmin:sticky"]),
    );
  });
});

describe("disableGslbRecord", () => {
  it("restores the parent, then deletes the rows, then persists", async () => {
    const enabled = await enableGslbRecord(enableArgs());
    const order: string[] = [];
    const persistRemoval = vi.fn(() => {
      order.push(`persist rows=${gslb.rowsAt("www").length}`);
      return Promise.resolve();
    });
    const result = await disableGslbRecord({
      backendId: "backend-1",
      client,
      zoneName: ZONE,
      name: NAME,
      target: recordTarget(NAME, ZONE),
      kind: "address",
      members: MEMBERS,
      snapshot: enabled.snapshot,
      parent,
      persistRemoval,
    });
    expect(result).toEqual({ remoteCleaned: true });
    expect(parent.at(NAME)).toEqual([
      {
        name: NAME,
        type: "A",
        ttl: 300,
        records: [
          { content: "192.0.2.10", disabled: false },
          { content: "192.0.2.20", disabled: false },
        ],
      },
    ]);
    expect(order).toEqual(["persist rows=0"]);
    // The subzone stays for the zone's other records.
    expect(gslb.rowsAt("@")).toHaveLength(2);
  });

  it("refuses when the parent CNAME was changed outside GSLB", async () => {
    const enabled = await enableGslbRecord(enableArgs());
    parent.rrsets = parent.rrsets.map((rr) =>
      rr.name === NAME ? { ...rr, records: [{ content: "elsewhere.example.net." }] } : rr,
    );
    const persistRemoval = vi.fn(() => Promise.resolve());
    await expect(
      disableGslbRecord({
        backendId: "backend-1",
        client,
        zoneName: ZONE,
        name: NAME,
        target: recordTarget(NAME, ZONE),
        kind: "address",
        members: MEMBERS,
        snapshot: enabled.snapshot,
        parent,
        persistRemoval,
      }),
    ).rejects.toThrow(/changed outside GSLB/);
    expect(gslb.rowsAt("www")).toHaveLength(3);
    expect(persistRemoval).not.toHaveBeenCalled();
  });
});

describe("removeGslbDomain (zone GSLB setup tear-down)", () => {
  async function enableThenDisable() {
    const enabled = await enableGslbRecord(enableArgs());
    await disableGslbRecord({
      backendId: "backend-1",
      client,
      zoneName: ZONE,
      name: NAME,
      target: recordTarget(NAME, ZONE),
      kind: "address",
      members: MEMBERS,
      snapshot: enabled.snapshot,
      parent,
      persistRemoval: () => Promise.resolve(),
    });
  }

  it("removes the delegation, then the PowerGSLB domain, then persists", async () => {
    await enableThenDisable();
    const persist = vi.fn(() => {
      // The parent and PowerGSLB are already clean when the app row goes.
      expect(parent.rrsets.some((rr) => rr.name.endsWith("gslb.example.com."))).toBe(false);
      expect(gslb.tables["domains"]).toEqual([]);
      return Promise.resolve();
    });
    const result = await removeGslbDomain({
      backendId: "backend-1",
      client,
      subzone: "gslb.example.com.",
      nameserverHost: "ns1.gslb.example.com.",
      parent,
      ownsNoRecords: () => Promise.resolve(true),
      persist,
    });
    expect(result.remoteLeftover).toBeNull();
    expect(result.parentChanges.map((c) => `${c.name} ${c.type}`)).toEqual([
      "gslb.example.com. NS",
      "ns1.gslb.example.com. A",
    ]);
    expect(persist).toHaveBeenCalledOnce();
    expect(gslb.rowsAt("@")).toEqual([]);
    // The nameserver's own rows go with the domain.
    expect(gslb.rowsAt("ns1")).toEqual([]);
  });

  it("still removes the zone side and the app row when PowerGSLB fails, reporting the leftover", async () => {
    await enableThenDisable();
    vi.spyOn(client, "deleteRecords").mockRejectedValueOnce(
      new GslbError("unreachable", "connect ECONNREFUSED"),
    );
    const persist = vi.fn(() => Promise.resolve());
    const result = await removeGslbDomain({
      backendId: "backend-1",
      client,
      subzone: "gslb.example.com.",
      nameserverHost: "ns1.gslb.example.com.",
      parent,
      ownsNoRecords: () => Promise.resolve(true),
      persist,
    });
    expect(result.remoteLeftover).toMatch(/gslb\.example\.com\. is left there/);
    expect(parent.rrsets.some((rr) => rr.type === "NS")).toBe(false);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("refuses while a GSLB record still uses the domain, changing nothing", async () => {
    await enableGslbRecord(enableArgs());
    const applied = parent.applied.length;
    await expect(
      removeGslbDomain({
        backendId: "backend-1",
        client,
        subzone: "gslb.example.com.",
        nameserverHost: "ns1.gslb.example.com.",
        parent,
        ownsNoRecords: () => Promise.resolve(false),
        persist: () => Promise.resolve(),
      }),
    ).rejects.toBeInstanceOf(GslbPlanError);
    expect(parent.applied).toHaveLength(applied);
  });
});
