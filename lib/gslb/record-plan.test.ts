/**
 * lib/gslb/record-plan.test.ts
 *
 * Pure GSLB record planning: eligibility, monitor/routing objects, member →
 * row planning, row diffs, delegation, and the enable / restore plans.
 */

import { describe, expect, it } from "vitest";
import {
  balancingError,
  decodeMode,
  deriveWeights,
  encodeMode,
  gslbZoneChipLabel,
  methodLabel,
  unassignedRegionWarning,
  type GslbMember,
} from "./model";
import {
  backendNameserverEditBlocker,
  pdnsDeleteGslbBlocker,
  planNameserverRows,
  planParentRollback,
  delegationRRsetKeys,
  diffRows,
  gslbEligibility,
  gslbTargetFor,
  initialSerial,
  monitorFor,
  monitorsForMembers,
  normalizeMemberContent,
  parentPointsAtGslb,
  planDelegation,
  planMemberRows,
  planParentEnable,
  planParentRestore,
  planSubzoneApexRows,
  backendDeleteBlockers,
  computeOwnedRRsets,
  planDelegationRemoval,
  stripGslbForClone,
  recordTarget,
  relativeLabel,
  ROUTINGS,
  routingFor,
  targetName,
  zoneGslbHealth,
  type RemoteRow,
  type ZoneRRset,
} from "./record-plan";

const ZONE = "example.com.";

function rr(name: string, type: string, contents: string[], ttl = 300): ZoneRRset {
  return { name, type, ttl, records: contents.map((content) => ({ content })) };
}

describe("names", () => {
  it("derives the relative label and the CNAME target", () => {
    expect(relativeLabel("WWW.Example.com.", ZONE)).toBe("www");
    expect(relativeLabel("a.b.example.com", ZONE)).toBe("a.b");
    expect(gslbTargetFor("www.example.com.", ZONE)).toBe("www.gslb.example.com.");
    expect(targetName(recordTarget("www.example.com.", ZONE))).toBe("www.gslb.example.com.");
    expect(() => relativeLabel(ZONE, ZONE)).toThrow();
    expect(() => relativeLabel("www.other.org.", ZONE)).toThrow();
  });
});

describe("gslbEligibility", () => {
  it("allows an A/AAAA name and reports both types (they move together)", () => {
    const rrsets = [
      rr("www.example.com.", "A", ["192.0.2.1"]),
      rr("www.example.com.", "AAAA", ["2001:db8::1"]),
    ];
    expect(gslbEligibility(rrsets, ZONE, "www.example.com.")).toEqual({
      eligible: true,
      kind: "address",
      types: ["A", "AAAA"],
    });
  });

  it("allows a lone CNAME", () => {
    expect(
      gslbEligibility(
        [rr("app.example.com.", "CNAME", ["lb.example.net."])],
        ZONE,
        "app.example.com.",
      ),
    ).toMatchObject({
      eligible: true,
      kind: "cname",
    });
  });

  it("refuses the apex", () => {
    expect(gslbEligibility([rr(ZONE, "A", ["192.0.2.1"])], ZONE, ZONE)).toEqual({
      eligible: false,
      reason: "The zone apex can't be GSLB-balanced.",
    });
  });

  it("names the other RRset at the owner", () => {
    const rrsets = [
      rr("www.example.com.", "A", ["192.0.2.1"]),
      rr("www.example.com.", "TXT", ['"x"']),
    ];
    expect(gslbEligibility(rrsets, ZONE, "www.example.com.")).toEqual({
      eligible: false,
      reason: "This name also has a TXT record.",
    });
    const more = [...rrsets, rr("www.example.com.", "MX", ["10 mx.example.com."])];
    expect(gslbEligibility(more, ZONE, "www.example.com.")).toMatchObject({
      reason: "This name also has MX and TXT records.",
    });
    expect(
      gslbEligibility(
        [rr("s.example.com.", "A", ["192.0.2.1"]), rr("s.example.com.", "NS", ["ns.x."])],
        ZONE,
        "s.example.com.",
      ),
    ).toMatchObject({ reason: "This name also has an NS record." });
  });

  it("refuses wildcards, names under a child delegation, and the GSLB subzone", () => {
    expect(
      gslbEligibility([rr("*.example.com.", "A", ["192.0.2.1"])], ZONE, "*.example.com."),
    ).toMatchObject({ eligible: false });
    const delegated = [
      rr("sub.example.com.", "NS", ["ns1.sub.example.com."]),
      rr("ns1.sub.example.com.", "A", ["192.0.2.9"]),
    ];
    expect(gslbEligibility(delegated, ZONE, "ns1.sub.example.com.")).toMatchObject({
      eligible: false,
      reason: "This name is inside the delegated zone sub.example.com.",
    });
    expect(
      gslbEligibility(
        [rr("ns1.gslb.example.com.", "A", ["192.0.2.53"])],
        ZONE,
        "ns1.gslb.example.com.",
      ),
    ).toMatchObject({
      eligible: false,
    });
  });

  it("refuses disabled records and CNAMEs that already point into the subzone", () => {
    const disabled: ZoneRRset = {
      name: "www.example.com.",
      type: "A",
      ttl: 60,
      records: [{ content: "192.0.2.1", disabled: true }],
    };
    expect(gslbEligibility([disabled], ZONE, "www.example.com.")).toMatchObject({
      eligible: false,
    });
    expect(
      gslbEligibility(
        [rr("www.example.com.", "CNAME", ["www.gslb.example.com."])],
        ZONE,
        "www.example.com.",
      ),
    ).toMatchObject({ eligible: false });
  });
});

describe("normalizeMemberContent", () => {
  it("types address members by family and canonicalizes", () => {
    expect(normalizeMemberContent("address", " 192.0.2.10 ")).toEqual({
      ok: true,
      content: "192.0.2.10",
      type: "A",
    });
    expect(normalizeMemberContent("address", "2001:DB8::0:1")).toEqual({
      ok: true,
      content: "2001:db8::1",
      type: "AAAA",
    });
    expect(normalizeMemberContent("address", "app.example.com").ok).toBe(false);
  });

  it("requires an FQDN for cname members", () => {
    expect(normalizeMemberContent("cname", "Edge.Example.NET")).toEqual({
      ok: true,
      content: "edge.example.net.",
      type: "CNAME",
    });
    expect(normalizeMemberContent("cname", "localhost").ok).toBe(false);
    expect(normalizeMemberContent("cname", "192.0.2.1").ok).toBe(false);
  });
});

/** Monitor name without its `#<hash>` suffix. */
function readable(name: string): string {
  return name.split("#")[0]!;
}

describe("monitorFor", () => {
  it("derives deterministic names and PowerGSLB JSON", () => {
    const icmp = monitorFor({ type: "icmp" }, 4);
    expect(readable(icmp.name)).toBe("authadmin:icmp");
    expect(icmp.json).toBe('{"type":"icmp","ip":"${content}"}');
    expect(readable(monitorFor({ type: "tcp", port: 443 }, 6).name)).toBe("authadmin:tcp:443");
    const tls = monitorFor({ type: "tls", port: 8443, tlsVerify: false }, 4);
    expect(readable(tls.name)).toBe("authadmin:tls:8443:noverify");
    expect(tls.json).toBe('{"type":"tls","ip":"${content}","port":8443,"tls_verify":false}');
    const http = monitorFor({ type: "http", path: "/health", expectedStatus: "200-399" }, 4);
    expect(readable(http.name)).toBe("authadmin:http:/health:200-399");
    expect(http.json).toBe(
      '{"type":"http","url":"http://${content}/health","expected_status":"200-399"}',
    );
    expect(monitorFor({ type: "http", path: "/health", expectedStatus: "200-399" }, 4)).toEqual(
      http,
    );
  });

  it("suffixes a lowercase hash of the exact JSON so names stay distinct case-insensitively", () => {
    const lower = monitorFor({ type: "http", path: "/health", expectedStatus: "200" }, 4);
    const upper = monitorFor({ type: "http", path: "/Health", expectedStatus: "200" }, 4);
    expect(lower.name).toMatch(/#[0-9a-f]{12}$/);
    expect(lower.json).not.toBe(upper.json);
    // PowerGSLB's monitors.monitor is UNIQUE under a _ci collation.
    expect(lower.name.toLowerCase()).not.toBe(upper.name.toLowerCase());
  });

  it("keeps the longest possible name within PowerGSLB's 255-character column", () => {
    const longest = monitorFor(
      {
        type: "https",
        path: `/${"a".repeat(199)}`,
        expectedStatus: `${"200,".repeat(15)}200`,
        tlsVerify: false,
      },
      6,
    );
    expect(longest.name.length).toBeLessThanOrEqual(255);
    expect(longest.name).toMatch(/^authadmin:https:\/a+.*#[0-9a-f]{12}$/);
  });

  it("brackets IPv6 in HTTP(S) URLs under a separate monitor", () => {
    const v6 = monitorFor(
      { type: "https", path: "/up", expectedStatus: "200", tlsVerify: true },
      6,
    );
    expect(readable(v6.name)).toBe("authadmin:https:/up:200:verify:v6");
    expect(JSON.parse(v6.json)).toEqual({
      type: "http",
      url: "https://[${content}]/up",
      expected_status: "200",
      tls_verify: true,
    });
    expect(
      readable(monitorFor({ type: "http", path: "/", expectedStatus: "200" }, "name").name),
    ).toBe("authadmin:http:/:200");
  });
});

describe("routingFor", () => {
  const rr = { method: "round-robin", persistence: false } as const;

  it("uses round-robin over the top weight tier for global availability and round robin", () => {
    for (const method of ["global-availability", "round-robin"] as const) {
      expect(routingFor({ method, persistence: false }, "address")).toEqual({
        name: "authadmin:failover",
        json: '{"type":"round-robin"}',
      });
    }
  });

  it("uses weighted-random with one answer for ratio", () => {
    expect(routingFor({ method: "ratio", persistence: false }, "address")).toEqual({
      name: "authadmin:weighted",
      json: '{"type":"weighted-random","max_answers":1}',
    });
  });

  it("maps persistence to sticky-hash with one answer", () => {
    expect(routingFor({ method: "round-robin", persistence: true }, "address")).toEqual({
      name: "authadmin:sticky",
      json: '{"type":"sticky-hash","max_answers":1}',
    });
  });

  it("gives CNAME records a single-answer policy for every method", () => {
    expect(routingFor(rr, "cname")).toEqual({
      name: "authadmin:failover-single",
      json: '{"type":"round-robin","max_answers":1}',
    });
    expect(routingFor({ method: "global-availability", persistence: false }, "cname").name).toBe(
      "authadmin:failover-single",
    );
    expect(routingFor({ method: "ratio", persistence: false }, "cname").name).toBe(
      "authadmin:weighted",
    );
    expect(routingFor({ method: "round-robin", persistence: true }, "cname").name).toBe(
      "authadmin:sticky",
    );
  });

  it("never defines two objects with identical JSON", () => {
    const jsons = Object.values(ROUTINGS).map((r) => r.json);
    expect(new Set(jsons).size).toBe(jsons.length);
  });
});

describe("planMemberRows", () => {
  const members: GslbMember[] = [
    { content: "192.0.2.10", region: "site-a", weight: 10 },
    { content: "2001:db8::20", region: "site-b", weight: 5 },
    { content: "198.51.100.30", region: null, weight: 1 },
  ];
  const input = {
    target: recordTarget("www.example.com.", ZONE),
    kind: "address" as const,
    method: "ratio" as const,
    persistence: false,
    monitor: { type: "http" as const, path: "/health", expectedStatus: "200-399" },
    ttl: 30,
    members,
  };

  it("duplicates regional members into Public and keeps All-clients members in Public only", () => {
    const rows = planMemberRows(input);
    expect(rows.map((r) => [r.name_type, r.view, r.content, r.weight])).toEqual([
      ["A", "authadmin:site-a", "192.0.2.10", 10],
      ["A", "Public", "192.0.2.10", 10],
      ["AAAA", "authadmin:site-b", "2001:db8::20", 5],
      ["AAAA", "Public", "2001:db8::20", 5],
      ["A", "Public", "198.51.100.30", 1],
    ]);
    expect(
      rows.every((r) => r.domain === "gslb.example.com" && r.name === "www" && r.ttl === 30),
    ).toBe(true);
    expect(rows.every((r) => r.policy === "authadmin:weighted" && r.disabled === 0)).toBe(true);
    expect(readable(rows[2]!.monitor)).toBe("authadmin:http:/health:200-399:v6");
  });

  it("lists one monitor per content family", () => {
    expect(monitorsForMembers(input).map((m) => readable(m.name))).toEqual([
      "authadmin:http:/health:200-399",
      "authadmin:http:/health:200-399:v6",
    ]);
  });

  it("writes CNAME members without the trailing dot under the single-answer policy", () => {
    const rows = planMemberRows({
      ...input,
      method: "global-availability",
      target: recordTarget("app.example.com.", ZONE),
      kind: "cname",
      members: [{ content: "edge-a.example.net.", region: "site-a", weight: 10 }],
    });
    expect(rows.map((r) => [r.name_type, r.view, r.content, r.policy])).toEqual([
      ["CNAME", "authadmin:site-a", "edge-a.example.net", "authadmin:failover-single"],
      ["CNAME", "Public", "edge-a.example.net", "authadmin:failover-single"],
    ]);
  });
});

describe("planMemberRows for CNAME names (one record per view)", () => {
  const cname = {
    target: recordTarget("app.example.com.", ZONE),
    kind: "cname" as const,
    method: "global-availability" as const,
    persistence: false,
    monitor: { type: "https" as const, path: "/", expectedStatus: "200", tlsVerify: true },
    ttl: 30,
  };

  it("gives each region its target and Public only the first target by priority", () => {
    const rows = planMemberRows({
      ...cname,
      members: [
        { content: "edge-a.example.net.", region: "site-a", weight: 0 },
        { content: "edge-b.example.net.", region: "site-b", weight: 0 },
      ],
    });
    expect(rows.map((r) => [r.view, r.content, r.weight])).toEqual([
      ["authadmin:site-a", "edge-a.example.net", 20],
      ["Public", "edge-a.example.net", 20],
      ["authadmin:site-b", "edge-b.example.net", 10],
    ]);
    const perView = new Set(rows.map((r) => r.view));
    expect(perView.size).toBe(rows.length);
  });

  it("uses a first target without a region as the Public fallback only", () => {
    const rows = planMemberRows({
      ...cname,
      members: [
        { content: "global.example.net.", region: null, weight: 0 },
        { content: "edge-a.example.net.", region: "site-a", weight: 0 },
      ],
    });
    expect(rows.map((r) => [r.view, r.content])).toEqual([
      ["Public", "global.example.net"],
      ["authadmin:site-a", "edge-a.example.net"],
    ]);
  });
});

describe("diffRows", () => {
  const base = {
    domain: "gslb.example.com",
    name: "www",
    name_type: "A",
    ttl: 30,
    policy: "authadmin:failover",
    monitor: "authadmin:icmp",
    weight: 10,
    disabled: 0,
  };
  const remote = (
    recid: number,
    view: string,
    content: string,
    extra: Partial<RemoteRow> = {},
  ): RemoteRow => ({
    recid,
    name_type: "A",
    view,
    content,
    ttl: 30,
    policy: "authadmin:failover",
    monitor: "authadmin:icmp",
    weight: 10,
    disabled: 0,
    ...extra,
  });

  it("keeps unchanged rows, updates changed ones, inserts new ones and removes the rest", () => {
    const diff = diffRows(
      [
        remote(1, "Public", "192.0.2.1"),
        remote(2, "Public", "192.0.2.2", { weight: 1 }),
        remote(3, "Public", "192.0.2.3"),
      ],
      [
        { ...base, view: "Public", content: "192.0.2.1" },
        { ...base, view: "Public", content: "192.0.2.2" },
        { ...base, view: "Public", content: "192.0.2.4" },
      ],
    );
    expect(diff.update.map((u) => u.recid)).toEqual([2]);
    expect(diff.insert.map((r) => r.content)).toEqual(["192.0.2.4"]);
    expect(diff.remove).toEqual([3]);
  });

  it("matches CNAME rows by view so a new target is an in-place update", () => {
    const cnameRow = (recid: number, view: string, content: string): RemoteRow => ({
      ...remote(recid, view, content),
      name_type: "CNAME",
    });
    const desired = (view: string, content: string) => ({
      ...base,
      name_type: "CNAME",
      view,
      content,
    });
    const diff = diffRows(
      [cnameRow(1, "Public", "old.example.net"), cnameRow(2, "authadmin:site-a", "a.example.net")],
      [desired("Public", "new.example.net"), desired("authadmin:site-a", "a.example.net")],
      "cname",
    );
    expect(diff).toEqual({
      update: [{ recid: 1, row: desired("Public", "new.example.net") }],
      insert: [],
      remove: [],
    });
  });

  it("removes duplicate rows of one key instead of leaving them behind", () => {
    const diff = diffRows(
      [remote(1, "Public", "192.0.2.1"), remote(2, "Public", "192.0.2.1")],
      [{ ...base, view: "Public", content: "192.0.2.1" }],
    );
    expect(diff).toEqual({ update: [], insert: [], remove: [2] });
  });
});

describe("planNameserverRows", () => {
  it("serves an in-bailiwick nameserver's own A/AAAA from Public with no health check", () => {
    const plan = planNameserverRows({
      subzone: "gslb.example.com.",
      nameserverHost: "NS1.gslb.example.com",
      nameserverAddresses: ["192.0.2.53", "2001:DB8::53"],
    });
    expect(plan?.label).toBe("ns1");
    expect(plan?.rows.map((r) => [r.domain, r.name, r.name_type, r.content, r.view])).toEqual([
      ["gslb.example.com", "ns1", "A", "192.0.2.53", "Public"],
      ["gslb.example.com", "ns1", "AAAA", "2001:db8::53", "Public"],
    ]);
    expect(plan?.rows.every((r) => r.monitor === "authadmin:none" && r.ttl === 3600)).toBe(true);
  });

  it("returns nothing for an out-of-bailiwick nameserver and @ for the apex itself", () => {
    expect(
      planNameserverRows({
        subzone: "gslb.example.com.",
        nameserverHost: "ns1.gslb.example.org.",
        nameserverAddresses: ["192.0.2.53"],
      }),
    ).toBeNull();
    expect(
      planNameserverRows({
        subzone: "gslb.example.com.",
        nameserverHost: "gslb.example.com.",
        nameserverAddresses: ["192.0.2.53"],
      })?.label,
    ).toBe("@");
  });
});

describe("planParentRollback", () => {
  it("removes the CNAME and restores the captured address RRsets exactly", () => {
    expect(
      planParentRollback({
        name: "WWW.example.com",
        snapshot: [
          {
            name: "www.example.com.",
            type: "A",
            ttl: 300,
            records: [{ content: "192.0.2.10" }, { content: "192.0.2.11", disabled: true }],
            comments: [{ content: "keep", account: "ops" }],
          },
        ],
      }),
    ).toEqual([
      { kind: "delete", name: "www.example.com.", type: "CNAME" },
      {
        kind: "upsert",
        name: "www.example.com.",
        type: "A",
        ttl: 300,
        records: [
          { content: "192.0.2.10", disabled: false },
          { content: "192.0.2.11", disabled: true },
        ],
        comments: [{ content: "keep", account: "ops" }],
      },
    ]);
  });

  it("overwrites the CNAME in place when the original was a CNAME", () => {
    const changes = planParentRollback({
      name: "app.example.com.",
      snapshot: [
        {
          name: "app.example.com.",
          type: "CNAME",
          ttl: 60,
          records: [{ content: "edge.example.net." }],
          comments: [],
        },
      ],
    });
    expect(changes.map((c) => `${c.kind} ${c.type}`)).toEqual(["upsert CNAME"]);
  });
});

describe("backendNameserverEditBlocker", () => {
  const before = { nameserverHost: "ns1.gslb.example.com.", nameserverAddresses: ["192.0.2.53"] };

  it("refuses a host or address change while zones use the backend, naming them", () => {
    const zoneNames = ["example.com.", "example.org."];
    expect(
      backendNameserverEditBlocker({
        before,
        after: { nameserverHost: "ns2.gslb.example.com." },
        zoneNames,
      }),
    ).toContain("example.com., example.org.");
    expect(
      backendNameserverEditBlocker({
        before,
        after: { nameserverAddresses: ["192.0.2.54"] },
        zoneNames,
      }),
    ).not.toBeNull();
    expect(
      backendNameserverEditBlocker({ before, after: { nameserverHost: null }, zoneNames }),
    ).not.toBeNull();
  });

  it("allows resending the same values (any case / dot / order) and any change when unused", () => {
    expect(
      backendNameserverEditBlocker({
        before: { ...before, nameserverAddresses: ["192.0.2.53", "2001:db8::53"] },
        after: {
          nameserverHost: "NS1.gslb.example.com",
          nameserverAddresses: ["2001:DB8:0::53", "192.0.2.53"],
        },
        zoneNames: ["example.com."],
      }),
    ).toBeNull();
    expect(
      backendNameserverEditBlocker({
        before,
        after: { nameserverHost: "ns9.example.net." },
        zoneNames: [],
      }),
    ).toBeNull();
  });
});

describe("pdnsDeleteGslbBlocker", () => {
  it("names every zone with a GSLB setup and says to remove it first", () => {
    expect(pdnsDeleteGslbBlocker("cluster", [])).toBeNull();
    const message = pdnsDeleteGslbBlocker("server", [
      { zoneName: "example.com.", records: 2 },
      { zoneName: "example.org.", records: 0 },
    ]);
    expect(message).toContain("This server still has GSLB set up");
    expect(message).toContain("example.com. (2 GSLB records)");
    expect(message).toContain("example.org. (GSLB setup only)");
    expect(message).toContain("Remove GSLB setup");
  });
});

describe("subzone apex + serial", () => {
  it("plans SOA and NS rows for gslb.<zone>", () => {
    const rows = planSubzoneApexRows({
      zoneName: ZONE,
      subzone: "gslb.example.com.",
      nameserverHost: "ns1.gslb.example.com.",
      serial: 2026101401,
    });
    expect(rows.map((r) => [r.name, r.name_type, r.content, r.view, r.monitor])).toEqual([
      [
        "@",
        "SOA",
        "ns1.gslb.example.com. hostmaster.example.com. 2026101401 3600 600 86400 30",
        "Public",
        "authadmin:none",
      ],
      ["@", "NS", "ns1.gslb.example.com", "Public", "authadmin:none"],
    ]);
    expect(initialSerial(new Date("2026-10-14T12:00:00Z"))).toBe(2026101401);
  });
});

describe("planDelegation", () => {
  const args = {
    subzone: "gslb.example.com.",
    nameserverHost: "ns1.gslb.example.com.",
    nameserverAddresses: ["192.0.2.53", "2001:db8::53"],
  };

  it("adds NS plus in-bailiwick glue", () => {
    const plan = planDelegation({ ...args, rrsets: [] });
    expect(plan).toEqual({
      ok: true,
      changes: [
        {
          kind: "upsert",
          name: "gslb.example.com.",
          type: "NS",
          ttl: 3600,
          records: [{ content: "ns1.gslb.example.com.", disabled: false }],
        },
        {
          kind: "upsert",
          name: "ns1.gslb.example.com.",
          type: "A",
          ttl: 3600,
          records: [{ content: "192.0.2.53", disabled: false }],
        },
        {
          kind: "upsert",
          name: "ns1.gslb.example.com.",
          type: "AAAA",
          ttl: 3600,
          records: [{ content: "2001:db8::53", disabled: false }],
        },
      ],
    });
  });

  it("skips glue for an out-of-bailiwick nameserver", () => {
    const plan = planDelegation({ ...args, nameserverHost: "ns.gslb.example.net.", rrsets: [] });
    expect(plan.ok && plan.changes.map((c) => c.type)).toEqual(["NS"]);
  });

  it("is idempotent", () => {
    const existing = [
      rr("gslb.example.com.", "NS", ["ns1.gslb.example.com."]),
      rr("ns1.gslb.example.com.", "A", ["192.0.2.53"]),
      rr("ns1.gslb.example.com.", "AAAA", ["2001:db8::53"]),
    ];
    expect(planDelegation({ ...args, rrsets: existing })).toEqual({ ok: true, changes: [] });
  });

  it("refuses a foreign NS, differing glue, or other records under the subzone", () => {
    expect(
      planDelegation({ ...args, rrsets: [rr("gslb.example.com.", "NS", ["other.example.net."])] })
        .ok,
    ).toBe(false);
    expect(
      planDelegation({ ...args, rrsets: [rr("ns1.gslb.example.com.", "A", ["192.0.2.99"])] }).ok,
    ).toBe(false);
    expect(
      planDelegation({ ...args, rrsets: [rr("x.gslb.example.com.", "TXT", ['"y"'])] }).ok,
    ).toBe(false);
  });

  it("labels the delegation RRsets", () => {
    expect(delegationRRsetKeys("gslb.example.com.", "ns1.gslb.example.com.")).toEqual([
      "gslb.example.com.|NS",
      "ns1.gslb.example.com.|A",
      "ns1.gslb.example.com.|AAAA",
    ]);
    expect(delegationRRsetKeys("gslb.example.com.", "ns.elsewhere.net.")).toEqual([
      "gslb.example.com.|NS",
    ]);
  });
});

describe("planParentEnable", () => {
  it("deletes A/AAAA before adding the CNAME and snapshots them", () => {
    const live: ZoneRRset[] = [
      {
        ...rr("www.example.com.", "A", ["192.0.2.1"], 300),
        comments: [{ content: "web", account: "ops" }],
      },
      rr("www.example.com.", "AAAA", ["2001:db8::1"], 600),
    ];
    const plan = planParentEnable({
      name: "www.example.com.",
      target: "www.gslb.example.com.",
      liveAtName: live,
    });
    expect(plan.changes).toEqual([
      { kind: "delete", name: "www.example.com.", type: "A" },
      { kind: "delete", name: "www.example.com.", type: "AAAA" },
      {
        kind: "upsert",
        name: "www.example.com.",
        type: "CNAME",
        ttl: 600,
        records: [{ content: "www.gslb.example.com.", disabled: false }],
      },
    ]);
    expect(plan.types).toEqual(["A", "AAAA"]);
    expect(plan.snapshot[0]).toEqual({
      name: "www.example.com.",
      type: "A",
      ttl: 300,
      records: [{ content: "192.0.2.1" }],
      comments: [{ content: "web", account: "ops" }],
    });
  });

  it("replaces a CNAME in place", () => {
    const plan = planParentEnable({
      name: "app.example.com.",
      target: "app.gslb.example.com.",
      liveAtName: [rr("app.example.com.", "CNAME", ["lb.example.net."], 3600)],
    });
    expect(plan.changes).toEqual([
      {
        kind: "upsert",
        name: "app.example.com.",
        type: "CNAME",
        ttl: 3600,
        records: [{ content: "app.gslb.example.com.", disabled: false }],
      },
    ]);
  });
});

describe("planParentRestore", () => {
  const gslbCname = [rr("www.example.com.", "CNAME", ["www.gslb.example.com."])];
  const snapshot = [
    {
      name: "www.example.com.",
      type: "A",
      ttl: 300,
      records: [{ content: "192.0.2.1" }],
      comments: [{ content: "web" }],
    },
  ];

  it("restores members' current addresses (members win over the snapshot)", () => {
    const plan = planParentRestore({
      name: "www.example.com.",
      target: "www.gslb.example.com.",
      liveAtName: gslbCname,
      kind: "address",
      members: [
        { content: "192.0.2.7", region: "a", weight: 10 },
        { content: "2001:db8::7", region: null, weight: 10 },
        { content: "192.0.2.7", region: null, weight: 1 },
      ],
      snapshot,
    });
    expect(plan).toEqual({
      ok: true,
      changes: [
        { kind: "delete", name: "www.example.com.", type: "CNAME" },
        {
          kind: "upsert",
          name: "www.example.com.",
          type: "A",
          ttl: 300,
          records: [{ content: "192.0.2.7", disabled: false }],
          comments: [{ content: "web" }],
        },
        {
          kind: "upsert",
          name: "www.example.com.",
          type: "AAAA",
          ttl: 300,
          records: [{ content: "2001:db8::7", disabled: false }],
          comments: [],
        },
      ],
    });
  });

  it("restores a CNAME record from its first member", () => {
    const plan = planParentRestore({
      name: "www.example.com.",
      target: "www.gslb.example.com.",
      liveAtName: gslbCname,
      kind: "cname",
      members: [{ content: "edge-b.example.net.", region: null, weight: 1 }],
      snapshot: [
        {
          name: "www.example.com.",
          type: "CNAME",
          ttl: 3600,
          records: [{ content: "edge-a.example.net." }],
          comments: [],
        },
      ],
    });
    expect(plan.ok && plan.changes).toEqual([
      {
        kind: "upsert",
        name: "www.example.com.",
        type: "CNAME",
        ttl: 3600,
        records: [{ content: "edge-b.example.net.", disabled: false }],
        comments: [],
      },
    ]);
  });

  it("refuses when the record was changed outside GSLB", () => {
    for (const live of [
      [rr("www.example.com.", "CNAME", ["elsewhere.example.net."])],
      [rr("www.example.com.", "A", ["192.0.2.1"])],
      [],
    ]) {
      const plan = planParentRestore({
        name: "www.example.com.",
        target: "www.gslb.example.com.",
        liveAtName: live,
        kind: "address",
        members: [{ content: "192.0.2.1", region: null, weight: 1 }],
        snapshot,
      });
      expect(plan.ok).toBe(false);
      expect(!plan.ok && plan.reason).toMatch(/changed outside GSLB/);
    }
    expect(parentPointsAtGslb(gslbCname, "www.example.com.", "www.gslb.example.com.")).toBe(true);
  });
});

describe("zoneGslbHealth", () => {
  const records = [
    {
      target: recordTarget("www.example.com.", ZONE),
      members: [
        { content: "192.0.2.1", region: null, weight: 10 },
        { content: "192.0.2.2", region: null, weight: 10 },
      ],
    },
    {
      target: recordTarget("app.example.com.", ZONE),
      members: [{ content: "edge.example.net.", region: null, weight: 10 }],
    },
    {
      target: recordTarget("api.example.com.", ZONE),
      members: [
        { content: "192.0.2.1", region: null, weight: 10 },
        { content: "192.0.2.9", region: null, weight: 10 },
      ],
    },
  ];

  it("counts records with any member Off and the distinct servers down", () => {
    const states = new Map<string, "On" | "Off">([
      ["gslb.example.com|www|192.0.2.1", "On"],
      ["gslb.example.com|www|192.0.2.2", "Off"],
      ["gslb.example.com|app|edge.example.net", "On"],
      ["gslb.example.com|api|192.0.2.9", "Off"],
    ]);
    expect(zoneGslbHealth(records, states)).toEqual({
      total: 3,
      down: 2,
      serversDown: 2,
      unavailable: false,
    });
  });

  it("reports all up, and treats a missing status row as not down", () => {
    expect(zoneGslbHealth(records, new Map())).toEqual({
      total: 3,
      down: 0,
      serversDown: 0,
      unavailable: false,
    });
  });

  it("marks the zone unavailable when PowerGSLB couldn't be read", () => {
    expect(zoneGslbHealth(records, null)).toMatchObject({ total: 3, unavailable: true });
  });
});

describe("planDelegationRemoval", () => {
  const delegation = [
    rr("gslb.example.com.", "NS", ["ns1.gslb.example.com."]),
    rr("ns1.gslb.example.com.", "A", ["192.0.2.53"]),
    rr("ns1.gslb.example.com.", "AAAA", ["2001:db8::53"]),
  ];

  it("removes the NS and the in-bailiwick glue", () => {
    expect(
      planDelegationRemoval({
        subzone: "gslb.example.com.",
        nameserverHost: "ns1.gslb.example.com.",
        rrsets: delegation,
      }),
    ).toEqual([
      { kind: "delete", name: "gslb.example.com.", type: "NS" },
      { kind: "delete", name: "ns1.gslb.example.com.", type: "A" },
      { kind: "delete", name: "ns1.gslb.example.com.", type: "AAAA" },
    ]);
  });

  it("keeps the glue while another delegation in the zone still names that nameserver", () => {
    const shared = [...delegation, rr("other.example.com.", "NS", ["ns1.gslb.example.com."])];
    expect(
      planDelegationRemoval({
        subzone: "gslb.example.com.",
        nameserverHost: "ns1.gslb.example.com.",
        rrsets: shared,
      }),
    ).toEqual([{ kind: "delete", name: "gslb.example.com.", type: "NS" }]);
  });

  it("is a no-op when the delegation is already gone, and never touches out-of-bailiwick hosts", () => {
    expect(
      planDelegationRemoval({
        subzone: "gslb.example.com.",
        nameserverHost: "ns1.gslb.example.com.",
        rrsets: [],
      }),
    ).toEqual([]);
    expect(
      planDelegationRemoval({
        subzone: "gslb.example.com.",
        nameserverHost: "ns.elsewhere.net.",
        rrsets: [
          rr("gslb.example.com.", "NS", ["ns.elsewhere.net."]),
          rr("ns.elsewhere.net.", "A", ["192.0.2.1"]),
        ],
      }),
    ).toEqual([{ kind: "delete", name: "gslb.example.com.", type: "NS" }]);
  });
});

describe("computeOwnedRRsets", () => {
  it("locks managed names and the delegation while the app rows exist", () => {
    const owned = computeOwnedRRsets({
      managedNames: ["www.example.com."],
      zoneDelegation: { subzone: "gslb.example.com.", nameserverHost: "ns1.gslb.example.com." },
    });
    expect([...owned.names]).toEqual(["www.example.com."]);
    expect([...owned.delegationKeys]).toEqual([
      "gslb.example.com.|NS",
      "ns1.gslb.example.com.|A",
      "ns1.gslb.example.com.|AAAA",
    ]);
  });

  it("releases every lock once the records and the zone setup row are gone", () => {
    const owned = computeOwnedRRsets({ managedNames: [], zoneDelegation: null });
    expect(owned.names.size).toBe(0);
    expect(owned.delegationKeys.size).toBe(0);
  });
});

describe("backendDeleteBlockers", () => {
  it("names each blocker and where to remove it", () => {
    const message = backendDeleteBlockers({
      regions: ["Site A", "Site B"],
      zones: [
        { zoneName: "example.com.", records: 2 },
        { zoneName: "example.org.", records: 0 },
      ],
    });
    expect(message).toContain("regions Site A, Site B - delete them in the Regions section");
    expect(message).toContain("example.com. (2 GSLB records)");
    expect(message).toContain("example.org. (GSLB setup only)");
    expect(message).toContain('"Remove GSLB setup"');
  });

  it("returns null when nothing blocks", () => {
    expect(backendDeleteBlockers({ regions: [], zones: [] })).toBeNull();
  });
});

describe("unassignedRegionWarning", () => {
  it("warns only when regions exist and some members have none", () => {
    expect(unassignedRegionWarning(0, 2)).toBeNull();
    expect(unassignedRegionWarning(3, 0)).toBeNull();
    expect(unassignedRegionWarning(1, 2)).toBe(
      "1 server has no region, so it serves all clients and won't give users a nearby server. Continue?",
    );
    expect(unassignedRegionWarning(2, 1)).toBe(
      "2 servers have no region, so they serve all clients and won't give users a nearby server. Continue?",
    );
  });
});

describe("gslbZoneChipLabel", () => {
  it("words healthy, down and unknown states with correct plurals", () => {
    expect(gslbZoneChipLabel({ total: 3, down: 0, serversDown: 0, unavailable: false })).toBe(
      "3 records · all up",
    );
    expect(gslbZoneChipLabel({ total: 1, down: 0, serversDown: 0, unavailable: false })).toBe(
      "1 record · all up",
    );
    expect(gslbZoneChipLabel({ total: 4, down: 1, serversDown: 2, unavailable: false })).toBe(
      "1 record · 2 servers down",
    );
    expect(gslbZoneChipLabel({ total: 4, down: 2, serversDown: 1, unavailable: false })).toBe(
      "2 records · 1 server down",
    );
    expect(gslbZoneChipLabel({ total: 4, down: 0, serversDown: 0, unavailable: true })).toBe(
      "status unavailable",
    );
  });
});

describe("stripGslbForClone", () => {
  const rrsets: ZoneRRset[] = [
    rr(ZONE, "SOA", ["ns. h. 1 2 3 4 5"]),
    rr("www.example.com.", "CNAME", ["www.gslb.example.com."], 300),
    rr("app.example.com.", "CNAME", ["elsewhere.example.net."], 60),
    rr("mail.example.com.", "A", ["192.0.2.25"]),
    rr("gslb.example.com.", "NS", ["ns1.gslb.example.com."]),
    rr("ns1.gslb.example.com.", "A", ["192.0.2.53"]),
  ];

  it("turns managed names into plain records and drops the delegation", () => {
    const result = stripGslbForClone({
      zoneName: ZONE,
      rrsets,
      records: [
        {
          name: "www.example.com.",
          kind: "address",
          members: [
            { content: "192.0.2.10", region: "a", weight: 10 },
            { content: "2001:db8::10", region: null, weight: 10 },
          ],
          snapshot: [{ name: "www.example.com.", type: "A", ttl: 300, records: [], comments: [] }],
        },
        // Changed outside GSLB: copied as it is.
        { name: "app.example.com.", kind: "cname", members: [], snapshot: [] },
      ],
      subzone: "gslb.example.com.",
      delegationKeys: ["gslb.example.com.|NS", "ns1.gslb.example.com.|A"],
    });
    expect(result.plainNames).toBe(1);
    expect(
      result.rrsets.map((r) => `${r.name} ${r.type} ${r.records.map((x) => x.content).join(",")}`),
    ).toEqual([
      `${ZONE} SOA ns. h. 1 2 3 4 5`,
      "app.example.com. CNAME elsewhere.example.net.",
      "mail.example.com. A 192.0.2.25",
      "www.example.com. A 192.0.2.10",
      "www.example.com. AAAA 2001:db8::10",
    ]);
  });

  it("leaves a zone without GSLB untouched", () => {
    const plain = [rr("mail.example.com.", "A", ["192.0.2.25"])];
    expect(
      stripGslbForClone({
        zoneName: ZONE,
        rrsets: plain,
        records: [],
        subzone: null,
        delegationKeys: [],
      }),
    ).toEqual({ rrsets: plain, plainNames: 0 });
  });
});

describe("planMemberRows by method", () => {
  const members: GslbMember[] = [
    { content: "192.0.2.1", region: "a", weight: 7 },
    { content: "192.0.2.2", region: "b", weight: 99 },
    { content: "192.0.2.3", region: null, weight: 1 },
  ];
  const base = {
    target: recordTarget("www.example.com.", ZONE),
    kind: "address" as const,
    monitor: { type: "icmp" as const },
    ttl: 30,
    members,
  };
  const weights = (rows: ReturnType<typeof planMemberRows>) =>
    rows.map((r) => `${r.view}:${r.content}:${r.weight}`);

  it("global availability: weights follow list order, identical in region and Public rows", () => {
    const rows = planMemberRows({ ...base, method: "global-availability", persistence: false });
    expect(weights(rows)).toEqual([
      "authadmin:a:192.0.2.1:30",
      "Public:192.0.2.1:30",
      "authadmin:b:192.0.2.2:20",
      "Public:192.0.2.2:20",
      "Public:192.0.2.3:10",
    ]);
    expect(new Set(rows.map((r) => r.policy))).toEqual(new Set(["authadmin:failover"]));
  });

  it("round robin: all weights equal under round-robin", () => {
    const rows = planMemberRows({ ...base, method: "round-robin", persistence: false });
    expect(new Set(rows.map((r) => r.weight))).toEqual(new Set([10]));
    expect(rows[0]!.policy).toBe("authadmin:failover");
  });

  it("round robin with persistence: sticky-hash", () => {
    const rows = planMemberRows({ ...base, method: "round-robin", persistence: true });
    expect(new Set(rows.map((r) => r.policy))).toEqual(new Set(["authadmin:sticky"]));
  });

  it("ratio: the given ratios under weighted-random", () => {
    const rows = planMemberRows({ ...base, method: "ratio", persistence: false });
    expect(weights(rows)).toEqual([
      "authadmin:a:192.0.2.1:7",
      "Public:192.0.2.1:7",
      "authadmin:b:192.0.2.2:99",
      "Public:192.0.2.2:99",
      "Public:192.0.2.3:1",
    ]);
    expect(rows[0]!.policy).toBe("authadmin:weighted");
  });

  it("CNAME names keep a single-answer policy under every method", () => {
    const cname = {
      ...base,
      target: recordTarget("app.example.com.", ZONE),
      kind: "cname" as const,
      members: [{ content: "edge.example.net.", region: null, weight: 10 }],
    };
    const policies = (
      method: "global-availability" | "round-robin" | "ratio",
      persistence = false,
    ) => planMemberRows({ ...cname, method, persistence })[0]!.policy;
    expect(policies("global-availability")).toBe("authadmin:failover-single");
    expect(policies("round-robin")).toBe("authadmin:failover-single");
    expect(policies("ratio")).toBe("authadmin:weighted");
    expect(policies("round-robin", true)).toBe("authadmin:sticky");
  });

  it("changing the method rewrites weights/policy in place without emptying the name", () => {
    const toRemote = (rows: ReturnType<typeof planMemberRows>): RemoteRow[] =>
      rows.map((r, i) => ({
        recid: i + 1,
        name_type: r.name_type,
        view: r.view,
        content: r.content,
        ttl: r.ttl,
        policy: r.policy,
        monitor: r.monitor,
        weight: r.weight,
        disabled: r.disabled,
      }));
    const before = toRemote(planMemberRows({ ...base, method: "round-robin", persistence: false }));
    const diff = diffRows(before, planMemberRows({ ...base, method: "ratio", persistence: false }));
    // Same members, so every row is updated in place: nothing inserted or removed.
    expect(diff.insert).toEqual([]);
    expect(diff.remove).toEqual([]);
    expect(diff.update).toHaveLength(before.length);
    expect(new Set(diff.update.map((u) => u.row.policy))).toEqual(new Set(["authadmin:weighted"]));
  });
});

describe("load-balancing methods", () => {
  const three = [
    { content: "a", weight: 5 },
    { content: "b", weight: 5 },
    { content: "c", weight: 5 },
  ];

  it("derives distinct descending weights from order, within the validator cap", () => {
    expect(deriveWeights("global-availability", three).map((m) => m.weight)).toEqual([30, 20, 10]);
    const max = Array.from({ length: 32 }, (_, i) => ({ content: String(i), weight: 0 }));
    const weights = deriveWeights("global-availability", max).map((m) => m.weight);
    expect(weights[0]).toBe(320);
    expect(weights.at(-1)).toBe(10);
    expect(new Set(weights).size).toBe(32);
    expect(Math.max(...weights)).toBeLessThanOrEqual(1000);
  });

  it("gives round robin equal weights and passes ratios through", () => {
    expect(
      deriveWeights("round-robin", [
        { content: "a", weight: 3 },
        { content: "b", weight: 9 },
      ]).map((m) => m.weight),
    ).toEqual([10, 10]);
    expect(
      deriveWeights("ratio", [
        { content: "a", weight: 3 },
        { content: "b", weight: 9 },
      ]).map((m) => m.weight),
    ).toEqual([3, 9]);
  });

  it("allows persistence only with round robin, and a ratio needs a non-zero member", () => {
    expect(balancingError({ method: "round-robin", persistence: true }, three)).toBeNull();
    expect(balancingError({ method: "ratio", persistence: true }, three)).toMatch(
      /only works with the Round robin/,
    );
    expect(balancingError({ method: "global-availability", persistence: true }, three)).toMatch(
      /Round robin/,
    );
    expect(balancingError({ method: "ratio", persistence: false }, [{ weight: 0 }])).toMatch(
      /ratio above 0/,
    );
    expect(balancingError({ method: "ratio", persistence: false }, three)).toBeNull();
  });

  it("round-trips current modes through encode/decode", () => {
    for (const b of [
      { method: "global-availability", persistence: false },
      { method: "round-robin", persistence: false },
      { method: "round-robin", persistence: true },
      { method: "ratio", persistence: false },
    ] as const) {
      const decoded = decodeMode(encodeMode(b), three);
      expect({ method: decoded.method, persistence: decoded.persistence }).toEqual(b);
      expect(decoded.members).toEqual(three);
    }
  });

  it("reads legacy modes: failover by weights, distribute as ratio", () => {
    expect(decodeMode("failover", three)).toMatchObject({
      method: "round-robin",
      persistence: false,
    });
    const unequal = [
      { content: "low", weight: 1 },
      { content: "high", weight: 50 },
      { content: "mid", weight: 10 },
    ];
    const ga = decodeMode("failover", unequal);
    expect(ga.method).toBe("global-availability");
    expect(ga.members.map((m) => m.content)).toEqual(["high", "mid", "low"]);
    expect(decodeMode("distribute", unequal)).toMatchObject({
      method: "ratio",
      persistence: false,
    });
    expect(decodeMode("distribute", unequal).members).toEqual(unequal);
  });

  it("labels methods, noting persistence", () => {
    expect(methodLabel({ method: "global-availability", persistence: false })).toBe(
      "Global availability",
    );
    expect(methodLabel({ method: "round-robin", persistence: true })).toBe(
      "Round robin · persistent",
    );
  });
});
