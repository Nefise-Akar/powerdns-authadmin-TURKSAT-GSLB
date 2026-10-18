/**
 * lib/validators/gslb-region-rules.test.ts
 *
 * GSLB region rule tokens: accepted shapes, normalization, match-all refusal.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalRule,
  MAX_GSLB_RULE_LENGTH,
  normalizeRuleToken,
  normalizeRuleTokens,
  regionForAddress,
} from "./gslb-region-rules";

function token(raw: string): string {
  const result = normalizeRuleToken(raw);
  if (!result.ok) throw new Error(result.error);
  return result.token;
}

function rejects(raw: string): string {
  const result = normalizeRuleToken(raw);
  if (result.ok) throw new Error(`accepted ${raw} as ${result.token}`);
  return result.error;
}

describe("normalizeRuleToken - CIDR", () => {
  it.each([
    ["10.0.0.0/8", "10.0.0.0/8"],
    [" 192.168.10.0/24 ", "192.168.10.0/24"],
    ["10.1.2.3/8", "10.0.0.0/8"],
    ["172.16.5.4/12", "172.16.0.0/12"],
    ["203.0.113.7", "203.0.113.7/32"],
    ["2001:DB8::1/32", "2001:db8::/32"],
    ["2001:0db8:0000:0000:0000:0000:0000:0001/128", "2001:db8::1/128"],
    ["2001:db8:0:0:1:0:0:1/64", "2001:db8::/64"],
    ["2001:db8::", "2001:db8::/128"],
    ["fe80::1:0:0:0:1/128", "fe80:0:0:1::1/128"],
    ["::ffff:192.0.2.1/128", "::ffff:c000:201/128"],
    ["2001:db8:1:0:0:0:0:0/48", "2001:db8:1::/48"],
  ])("normalizes %s to %s", (raw, expected) => {
    expect(token(raw)).toBe(expected);
  });

  it.each([
    "10.0.0.0/33",
    "10.0.0.256/8",
    "10.0.0/8",
    "010.0.0.0/8",
    "10.0.0.0/",
    "10.0.0.0/8/9",
    "2001:db8::/129",
    "2001:db8:::1/64",
    "2001:db8::1::2",
    "12345::/16",
    "1:2:3:4:5:6:7:8:9/64",
    "example.com",
    "",
  ])("rejects %j", (raw) => {
    expect(rejects(raw)).toBeTruthy();
  });

  it.each(["0.0.0.0/0", "::/0", "10.0.0.0/0", "2001:db8::/0"])(
    "rejects the match-all %s with an explanation",
    (raw) => {
      expect(rejects(raw)).toMatch(/matches every client/);
    },
  );
});

describe("normalizeRuleToken - geo", () => {
  it.each([
    ["country:de", "country:DE"],
    ["COUNTRY:tr", "country:TR"],
    ["country:XK", "country:XK"],
    ["continent:eu", "continent:EU"],
    ["Continent:AN", "continent:AN"],
  ])("normalizes %s to %s", (raw, expected) => {
    expect(token(raw)).toBe(expected);
  });

  it.each(["country:ZZ", "country:DEU", "country:", "continent:XX", "continent:EUR"])(
    "rejects %s",
    (raw) => {
      expect(rejects(raw)).toBeTruthy();
    },
  );

  it("treats an unknown prefix as an invalid rule, not as geo", () => {
    expect(rejects("region:EU")).toMatch(/not a valid rule/);
  });
});

describe("normalizeRuleTokens", () => {
  it("drops blank lines and duplicates after normalization, keeping order", () => {
    expect(
      normalizeRuleTokens(["10.1.2.3/8", "", "country:de", "10.0.0.0/8", "country:DE"]),
    ).toEqual({ ok: true, tokens: ["10.0.0.0/8", "country:DE"] });
  });

  it("requires at least one token", () => {
    expect(normalizeRuleTokens([" ", ""])).toEqual({
      ok: false,
      errors: ["Add at least one rule."],
    });
  });

  it("reports every bad token at once", () => {
    const result = normalizeRuleTokens(["bad", "10.0.0.0/8", "country:ZZ"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toHaveLength(2);
  });

  it("enforces PowerGSLB's rule length", () => {
    const many = Array.from({ length: 30 }, (_, i) => `10.${i}.0.0/16`);
    const result = normalizeRuleTokens(many);
    expect(many.join(" ").length).toBeGreaterThan(MAX_GSLB_RULE_LENGTH);
    expect(result.ok).toBe(false);
  });
});

describe("canonicalRule", () => {
  it("ignores spacing and case", () => {
    expect(canonicalRule("  10.0.0.0/8   country:de ")).toBe(
      canonicalRule("10.0.0.0/8 COUNTRY:DE"),
    );
  });
});

describe("regionForAddress", () => {
  const regions = [
    { slug: "campus", rules: ["10.20.0.0/16", "country:TR"] },
    { slug: "office", rules: ["10.20.5.0/24"] },
    { slug: "site-b", rules: ["192.0.2.0/24", "2001:db8:b::/48"] },
    { slug: "geo-only", rules: ["continent:EU"] },
  ];

  it("matches IPv4 by containment", () => {
    expect(regionForAddress("10.20.1.9", regions)).toBe("campus");
    expect(regionForAddress(" 192.0.2.77 ", regions)).toBe("site-b");
  });

  it("prefers the longest prefix when ranges overlap", () => {
    expect(regionForAddress("10.20.5.40", regions)).toBe("office");
  });

  it("matches IPv6 and never crosses address families", () => {
    expect(regionForAddress("2001:db8:b::10", regions)).toBe("site-b");
    expect(regionForAddress("2001:db8:c::10", regions)).toBeNull();
    expect(regionForAddress("::ffff:10.20.1.9", regions)).toBeNull();
  });

  it("returns null for no match, geo-only regions, or a non-IP", () => {
    expect(regionForAddress("203.0.113.5", regions)).toBeNull();
    expect(regionForAddress("app.example.com", regions)).toBeNull();
    expect(regionForAddress("", [])).toBeNull();
  });

  it("keeps the earlier region on equal prefixes", () => {
    expect(
      regionForAddress("198.51.100.1", [
        { slug: "first", rules: ["198.51.100.0/24"] },
        { slug: "second", rules: ["198.51.100.0/24"] },
      ]),
    ).toBe("first");
  });
});
