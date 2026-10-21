import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZONE_HORIZON,
  defaultZoneHorizonForName,
  ZONE_HORIZONS,
  isPrivateUseZoneName,
  isZoneHorizon,
  toZoneHorizon,
  zoneHorizonLabel,
} from "./zone-horizon";

describe("zone horizon vocabulary", () => {
  it("defaults to public - an unclassified zone must not be reclassified", () => {
    expect(DEFAULT_ZONE_HORIZON).toBe("public");
  });

  it("recognizes reserved private-use zone names", () => {
    expect(isPrivateUseZoneName("example.internal.")).toBe(true);
    expect(isPrivateUseZoneName("service.home.arpa")).toBe(true);
    expect(isPrivateUseZoneName("printer.local.")).toBe(true);
    expect(isPrivateUseZoneName("example.com.")).toBe(false);
    expect(defaultZoneHorizonForName("example.internal.")).toBe("internal");
    expect(defaultZoneHorizonForName("example.com.")).toBe("public");
  });

  it("matches the reserved name itself and any case or trailing dot, but not lookalikes", () => {
    expect(isPrivateUseZoneName("internal.")).toBe(true);
    expect(isPrivateUseZoneName("home.arpa")).toBe(true);
    expect(isPrivateUseZoneName("Corp.Example.INTERNAL")).toBe(true);
    expect(isPrivateUseZoneName("lab.test.")).toBe(true);
    // A label that merely ends in a reserved word is a public name.
    expect(isPrivateUseZoneName("notinternal.")).toBe(false);
    expect(isPrivateUseZoneName("mylocal.com.")).toBe(false);
    expect(isPrivateUseZoneName("internal.example.com.")).toBe(false);
    expect(isPrivateUseZoneName("arpa.")).toBe(false);
    expect(isPrivateUseZoneName("2.0.192.in-addr.arpa.")).toBe(false);
  });

  it("accepts only the known horizons", () => {
    expect(ZONE_HORIZONS).toEqual(["public", "internal"]);
    expect(isZoneHorizon("public")).toBe(true);
    expect(isZoneHorizon("internal")).toBe(true);
    expect(isZoneHorizon("INTERNAL")).toBe(false);
    expect(isZoneHorizon("dmz")).toBe(false);
    expect(isZoneHorizon(undefined)).toBe(false);
    expect(isZoneHorizon(null)).toBe(false);
    expect(isZoneHorizon(1)).toBe(false);
  });

  it("coerces anything unrecognized to the default rather than throwing", () => {
    expect(toZoneHorizon("internal")).toBe("internal");
    expect(toZoneHorizon("public")).toBe("public");
    expect(toZoneHorizon("nonsense")).toBe("public");
    expect(toZoneHorizon(null)).toBe("public");
  });

  it("labels both horizons", () => {
    expect(zoneHorizonLabel("internal")).toBe("internal");
    expect(zoneHorizonLabel("public")).toBe("public");
  });
});
