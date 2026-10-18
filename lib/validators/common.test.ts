/**
 * lib/validators/common.test.ts
 *
 * Slug suggestion from display names.
 */

import { describe, expect, it } from "vitest";
import { slugify, SLUG_PATTERN } from "./common";

describe("slugify", () => {
  it.each([
    ["İstanbul Şube", "istanbul-sube"],
    ["Çağlayan Ölçüm Ünitesi", "caglayan-olcum-unitesi"],
    ["ığdır", "igdir"],
    ["Site A (primary)", "site-a-primary"],
    ["  --Zürich / Genève--  ", "zurich-geneve"],
    ["Ankara DC 2", "ankara-dc-2"],
  ])("%j → %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
    expect(SLUG_PATTERN.test(slug)).toBe(true);
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(slugify("***")).toBe("");
  });

  it("caps the length without leaving a trailing dash", () => {
    const slug = slugify(`${"a".repeat(63)} b`);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });
});
