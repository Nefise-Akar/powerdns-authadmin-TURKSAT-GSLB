/**
 * lib/gslb/objects.test.ts
 *
 * The zone page's status read: only its own domain, keyed so `statusKey`
 * finds members exactly as it does in the backend-wide read.
 */

import { describe, expect, it, vi } from "vitest";
import type { GslbClient } from "./client";
import { readDomainStatus } from "./objects";
import { recordTarget, statusKey } from "./record-plan";

describe("readDomainStatus", () => {
  it("asks for one domain, filters again, and keys rows like statusKey", async () => {
    const getRecords = vi.fn(() =>
      Promise.resolve({
        // A search PowerGSLB couldn't apply returns every row - filtered here.
        records: [
          {
            recid: 1,
            domain: "gslb.example.com",
            name: "www",
            content: "192.0.2.10",
            status: "Off",
          },
          {
            recid: 2,
            domain: "gslb.example.com",
            name: "www",
            content: "192.0.2.10",
            status: "On",
          },
          {
            recid: 3,
            domain: "gslb.example.com",
            name: "www",
            content: "192.0.2.20",
            status: "Off",
          },
          { recid: 4, domain: "gslb.other.org", name: "www", content: "192.0.2.30", status: "On" },
        ],
        total: 4,
      }),
    );
    const client = { getRecords } as unknown as GslbClient;
    const states = await readDomainStatus(client, "gslb.example.com");

    expect(getRecords).toHaveBeenCalledWith("status", {
      search: [{ field: "domain", operator: "is", value: "gslb.example.com" }],
    });
    const target = recordTarget("www.example.com.", "example.com.");
    expect(states.get(statusKey(target, "192.0.2.10"))).toBe("On");
    expect(states.get(statusKey(target, "192.0.2.20"))).toBe("Off");
    expect(states.size).toBe(2);
  });
});
