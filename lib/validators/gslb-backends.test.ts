/**
 * lib/validators/gslb-backends.test.ts
 *
 * Unit tests for the PowerGSLB backend Zod schemas.
 */

import { describe, expect, it } from "vitest";
import { createGslbBackendSchema, updateGslbBackendSchema } from "./gslb-backends";

const MINIMAL_CREATE = {
  slug: "gslb-site-a",
  name: "Site A",
  baseUrl: "https://powergslb.example.com",
  username: "authadmin",
  password: "s3cret",
};

describe("createGslbBackendSchema", () => {
  it("parses a minimal payload and defaults enabled to true", () => {
    const result = createGslbBackendSchema.parse(MINIMAL_CREATE);
    expect(result.enabled).toBe(true);
    expect(result.baseUrl).toBe("https://powergslb.example.com");
  });

  it.each(["Bad_Slug", "-leading", "trailing-", ""])("rejects slug %j", (slug) => {
    expect(createGslbBackendSchema.safeParse({ ...MINIMAL_CREATE, slug }).success).toBe(false);
  });

  it("strips a trailing slash from the base URL", () => {
    const result = createGslbBackendSchema.parse({
      ...MINIMAL_CREATE,
      baseUrl: "https://powergslb:8443/",
    });
    expect(result.baseUrl).toBe("https://powergslb:8443");
  });

  it.each([
    "https://powergslb/admin/",
    "https://powergslb/admin/w2ui",
    "https://powergslb/?x=1",
    "https://user:pw@powergslb",
    "ftp://powergslb",
    "powergslb",
  ])("rejects base URL %j", (baseUrl) => {
    expect(createGslbBackendSchema.safeParse({ ...MINIMAL_CREATE, baseUrl }).success).toBe(false);
  });

  it("requires a non-empty username without a colon", () => {
    expect(createGslbBackendSchema.safeParse({ ...MINIMAL_CREATE, username: " " }).success).toBe(
      false,
    );
    expect(createGslbBackendSchema.safeParse({ ...MINIMAL_CREATE, username: "a:b" }).success).toBe(
      false,
    );
  });

  it("requires a password", () => {
    const { password: _omit, ...withoutPassword } = MINIMAL_CREATE;
    expect(createGslbBackendSchema.safeParse(withoutPassword).success).toBe(false);
    expect(createGslbBackendSchema.safeParse({ ...MINIMAL_CREATE, password: "" }).success).toBe(
      false,
    );
  });

  it("keeps password whitespace verbatim", () => {
    const result = createGslbBackendSchema.parse({ ...MINIMAL_CREATE, password: " pw " });
    expect(result.password).toBe(" pw ");
  });

  it("normalizes the nameserver host to a lower-case FQDN with a trailing dot", () => {
    const result = createGslbBackendSchema.parse({
      ...MINIMAL_CREATE,
      nameserverHost: "NS1.Gslb.Example.com",
    });
    expect(result.nameserverHost).toBe("ns1.gslb.example.com.");
  });

  it("treats a blank nameserver host as unset", () => {
    const result = createGslbBackendSchema.parse({ ...MINIMAL_CREATE, nameserverHost: "  " });
    expect(result.nameserverHost).toBeNull();
  });

  it.each(["localhost", "bad host.example.com", "-x.example.com"])(
    "rejects nameserver host %j",
    (nameserverHost) => {
      expect(createGslbBackendSchema.safeParse({ ...MINIMAL_CREATE, nameserverHost }).success).toBe(
        false,
      );
    },
  );

  it("accepts IPv4 and IPv6 nameserver addresses and drops duplicates", () => {
    const result = createGslbBackendSchema.parse({
      ...MINIMAL_CREATE,
      nameserverAddresses: ["192.0.2.53", "2001:db8::53", "192.0.2.53"],
    });
    expect(result.nameserverAddresses).toEqual(["192.0.2.53", "2001:db8::53"]);
  });

  it("rejects a non-IP nameserver address", () => {
    expect(
      createGslbBackendSchema.safeParse({
        ...MINIMAL_CREATE,
        nameserverAddresses: ["ns1.example.com"],
      }).success,
    ).toBe(false);
  });

  it("maps an empty address list to null", () => {
    const result = createGslbBackendSchema.parse({ ...MINIMAL_CREATE, nameserverAddresses: [] });
    expect(result.nameserverAddresses).toBeNull();
  });
});

describe("updateGslbBackendSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateGslbBackendSchema.parse({})).toEqual({});
  });

  it("treats a blank password as keep-existing", () => {
    expect(updateGslbBackendSchema.parse({ password: "" }).password).toBeUndefined();
  });

  it("passes a new password through for rotation", () => {
    expect(updateGslbBackendSchema.parse({ password: "rotated" }).password).toBe("rotated");
  });

  it("allows clearing nameserver fields with null", () => {
    const result = updateGslbBackendSchema.parse({
      nameserverHost: null,
      nameserverAddresses: null,
    });
    expect(result.nameserverHost).toBeNull();
    expect(result.nameserverAddresses).toBeNull();
  });

  it("validates a changed base URL the same way as create", () => {
    expect(updateGslbBackendSchema.safeParse({ baseUrl: "https://x/admin" }).success).toBe(false);
  });
});
