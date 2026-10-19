/**
 * lib/validators/gslb-records.test.ts
 *
 * Request schemas + member validation for the per-record GSLB routes.
 */

import { describe, expect, it } from "vitest";
import {
  enableGslbRecordSchema,
  gslbMonitorSchema,
  updateGslbRecordSchema,
  validateGslbMembers,
} from "./gslb-records";

const BASE = {
  name: "www",
  method: "round-robin",
  monitor: { type: "http", path: "/health", expectedStatus: "200-399" },
  ttl: 30,
  members: [{ content: "192.0.2.10", region: null, weight: 10 }],
};

describe("enable / update schemas", () => {
  it("accepts a minimal enable with ADR-0010 hashes", () => {
    const parsed = enableGslbRecordSchema.parse({
      ...BASE,
      expected: [{ type: "A", hash: "0123456789abcdef" }],
    });
    expect(parsed.members).toHaveLength(1);
  });

  it("ignores a stale `source`/`poolId` from an old client", () => {
    const parsed = enableGslbRecordSchema.parse({
      ...BASE,
      source: "pool",
      poolId: "p1",
      expected: [],
    });
    expect(parsed).not.toHaveProperty("poolId");
  });

  it("bounds TTL, weights and member count", () => {
    expect(updateGslbRecordSchema.safeParse({ ...BASE, ttl: 4 }).success).toBe(false);
    expect(updateGslbRecordSchema.safeParse({ ...BASE, ttl: 86_401 }).success).toBe(false);
    expect(
      updateGslbRecordSchema.safeParse({
        ...BASE,
        members: [{ content: "192.0.2.1", region: null, weight: 1001 }],
      }).success,
    ).toBe(false);
    expect(
      updateGslbRecordSchema.safeParse({
        ...BASE,
        members: [{ content: "192.0.2.1", region: null, weight: 1.5 }],
      }).success,
    ).toBe(false);
    const many = Array.from({ length: 33 }, (_, i) => ({
      content: `192.0.2.${i}`,
      region: null,
      weight: 1,
    }));
    expect(updateGslbRecordSchema.safeParse({ ...BASE, members: many }).success).toBe(false);
    expect(updateGslbRecordSchema.safeParse({ ...BASE, members: [] }).success).toBe(false);
  });

  it("accepts persistence only with round robin", () => {
    expect(updateGslbRecordSchema.safeParse({ ...BASE, persistence: true }).success).toBe(true);
    for (const method of ["global-availability", "ratio"]) {
      const result = updateGslbRecordSchema.safeParse({ ...BASE, method, persistence: true });
      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues[0]?.message).toMatch(/Round robin/);
    }
  });

  it("defaults persistence off and rejects unknown or legacy methods", () => {
    expect(updateGslbRecordSchema.parse(BASE).persistence).toBe(false);
    expect(updateGslbRecordSchema.safeParse({ ...BASE, method: "failover" }).success).toBe(false);
  });

  it("requires a non-zero ratio for the ratio method", () => {
    const members = [{ content: "192.0.2.1", region: null, weight: 0 }];
    expect(updateGslbRecordSchema.safeParse({ ...BASE, method: "ratio", members }).success).toBe(
      false,
    );
    expect(
      updateGslbRecordSchema.safeParse({ ...BASE, method: "round-robin", members }).success,
    ).toBe(true);
  });

  it("requires the expected hashes on enable", () => {
    expect(enableGslbRecordSchema.safeParse(BASE).success).toBe(false);
  });
});

describe("gslbMonitorSchema", () => {
  it.each([
    { type: "icmp" },
    { type: "tcp", port: 443 },
    { type: "tls", port: 443, tlsVerify: false },
    { type: "https", path: "/up", expectedStatus: "200,204,300-308", tlsVerify: true },
  ])("accepts %j", (monitor) => {
    expect(gslbMonitorSchema.safeParse(monitor).success).toBe(true);
  });

  it.each([
    { type: "tcp", port: 0 },
    { type: "http", path: "health", expectedStatus: "200" },
    { type: "http", path: "/a b", expectedStatus: "200" },
    { type: "http", path: "/", expectedStatus: "2xx" },
    { type: "exec", args: ["/bin/true"] },
  ])("rejects %j", (monitor) => {
    expect(gslbMonitorSchema.safeParse(monitor).success).toBe(false);
  });
});

describe("validateGslbMembers", () => {
  const subzone = "gslb.example.com.";

  it("canonicalizes addresses and accepts A + AAAA together", () => {
    expect(
      validateGslbMembers(
        "address",
        [
          { content: "192.0.2.10", region: "site-a", weight: 10 },
          { content: "2001:DB8::0:1", region: null, weight: 10 },
        ],
        subzone,
      ),
    ).toEqual({
      ok: true,
      members: [
        { content: "192.0.2.10", region: "site-a", weight: 10 },
        { content: "2001:db8::1", region: null, weight: 10 },
      ],
    });
  });

  it("rejects contents that don't match the kind, duplicates, and loops into the subzone", () => {
    const result = validateGslbMembers(
      "address",
      [
        { content: "app.example.com", region: null, weight: 1 },
        { content: "192.0.2.1", region: null, weight: 1 },
        { content: "192.0.2.01", region: null, weight: 1 },
        { content: "192.0.2.1", region: "a", weight: 1 },
      ],
      subzone,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toHaveLength(3);

    const cname = validateGslbMembers(
      "cname",
      [{ content: "www.gslb.example.com", region: null, weight: 1 }],
      subzone,
    );
    expect(!cname.ok && cname.errors[0]).toMatch(/can't point back/);
  });
});
