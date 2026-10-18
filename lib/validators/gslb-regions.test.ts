/**
 * lib/validators/gslb-regions.test.ts
 *
 * GSLB region form schemas.
 */

import { describe, expect, it } from "vitest";
import { createGslbRegionSchema, updateGslbRegionSchema } from "./gslb-regions";

const MINIMAL = { slug: "site-a", name: "Site A", rules: ["10.20.0.0/16"] };

describe("createGslbRegionSchema", () => {
  it("parses a minimal payload", () => {
    expect(createGslbRegionSchema.parse(MINIMAL)).toEqual({
      slug: "site-a",
      name: "Site A",
      rules: ["10.20.0.0/16"],
    });
  });

  it("returns the normalized, de-duplicated rules", () => {
    const result = createGslbRegionSchema.parse({
      ...MINIMAL,
      rules: ["10.20.1.1/16", "country:tr", "10.20.0.0/16"],
    });
    expect(result.rules).toEqual(["10.20.0.0/16", "country:TR"]);
  });

  it("puts every token error under `rules`", () => {
    const result = createGslbRegionSchema.safeParse({
      ...MINIMAL,
      rules: ["0.0.0.0/0", "country:ZZ"],
    });
    expect(result.success).toBe(false);
    const rulesErrors = !result.success ? result.error.flatten().fieldErrors.rules : undefined;
    expect(rulesErrors).toHaveLength(2);
  });

  it("requires at least one rule", () => {
    expect(createGslbRegionSchema.safeParse({ ...MINIMAL, rules: [] }).success).toBe(false);
  });

  it("rejects a bad slug", () => {
    expect(createGslbRegionSchema.safeParse({ ...MINIMAL, slug: "Site A" }).success).toBe(false);
  });

  it("maps a blank description to null", () => {
    expect(createGslbRegionSchema.parse({ ...MINIMAL, description: "  " }).description).toBeNull();
  });
});

describe("updateGslbRegionSchema", () => {
  it("accepts an empty patch and ignores a slug", () => {
    expect(updateGslbRegionSchema.parse({ slug: "renamed" })).toEqual({});
  });

  it("validates rules when present", () => {
    expect(updateGslbRegionSchema.safeParse({ rules: ["::/0"] }).success).toBe(false);
    expect(updateGslbRegionSchema.parse({ rules: ["continent:eu"] }).rules).toEqual([
      "continent:EU",
    ]);
  });
});
