/**
 * tests/integration/rbac/zone-scoped-new-features.test.ts
 *
 * The 1.10 features (global search, the Add record wizard's zone search and
 * existence check, zone sync, notifications, Zone Monitoring, Reverse DNS)
 * honour a role scoped to `zone:<name>` (ADR-0025): the scoped zone is in,
 * every other zone is out, and the fleet-wide pages stay behind their global
 * permission.
 *
 * The scope is planted the way IdP group sync plants it, as in
 * zone-scoped-roles.test.ts.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createAndLogin, loginAsBootstrap, uniqueEmail } from "../helpers/auth";
import { dbQuery } from "../helpers/db";
import { resetState } from "../helpers/reset";
import { type TestHttp } from "../helpers/http";

const NS = ["ns1.example.com.", "ns2.example.com."] as const;

const ZONE_EDITOR = [
  "zone.read",
  "record.read",
  "record.create",
  "record.update",
  "record.delete",
] as const;

function randomZone(prefix: string): string {
  const tag = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${tag}.example.com.`;
}

async function createZone(admin: TestHttp, name: string): Promise<void> {
  await admin.sendJson("POST", "/api/admin/pdns/zones", {
    serverSlug: "standalone",
    name,
    kind: "Master",
    nameservers: NS,
  });
}

async function plantZoneScope(
  userId: string,
  scopeId: string,
  permissions: readonly string[],
): Promise<void> {
  await dbQuery("UPDATE sessions SET derived_permissions = $2::jsonb WHERE user_id = $1", [
    userId,
    JSON.stringify([{ scopeType: "zone", scopeId, permissions }]),
  ]);
}

const zoneUrl = (zone: string, tail: string): string =>
  `/api/admin/pdns/zones/${encodeURIComponent(zone)}/${tail}`;

describe("1.10 features honour zone-scoped roles", () => {
  beforeEach(async () => {
    await resetState();
  });

  it("scopes search, the record wizard, sync and notifications to the scoped zone", async () => {
    const admin = await loginAsBootstrap();
    const scoped = randomZone("zs-new");
    const other = randomZone("zs-other");
    await createZone(admin, scoped);
    await createZone(admin, other);

    const { user, client } = await createAndLogin(admin, {
      email: uniqueEmail("zone-scoped-new"),
      name: "Zone-scoped operator",
      password: "zone-scoped-new-pw-1234",
    });
    await plantZoneScope(user.id, scoped, ZONE_EDITOR);

    // Wizard zone picker: the scoped zone, writable; never the other one.
    const picker = await client.call("/api/admin/pdns/zones/search?q=zs-", { method: "GET" });
    expect(picker.status).toBe(200);
    const pickerBody = (await picker.json()) as {
      zones: Array<{ name: string; canCreate: boolean }>;
    };
    expect(pickerBody.zones.map((z) => z.name)).toEqual([scoped]);
    expect(pickerBody.zones[0]!.canCreate).toBe(true);

    // Wizard existence check and the zone sync panel.
    expect(
      (await client.call(`${zoneUrl(scoped, "records")}?name=www&serverSlug=standalone`)).status,
    ).toBe(200);
    expect(
      (await client.call(`${zoneUrl(other, "records")}?name=www&serverSlug=standalone`)).status,
    ).toBe(403);
    expect((await client.call(`${zoneUrl(scoped, "sync")}?serverSlug=standalone`)).status).toBe(
      200,
    );
    expect((await client.call(`${zoneUrl(other, "sync")}?serverSlug=standalone`)).status).toBe(403);

    // Global search: poll until the index swap includes both new zones, then
    // the scoped user sees only theirs.
    const label = (zone: string) => zone.replace(/\.example\.com\.$/, "");
    let adminSeesBoth = false;
    for (let attempt = 0; attempt < 60 && !adminSeesBoth; attempt++) {
      const res = await admin.call(`/api/search?q=zs-&scope=zones&limit=25`, { method: "GET" });
      const body = (await res.json()) as { groups: Array<{ items: Array<{ title: string }> }> };
      const titles = body.groups.flatMap((g) => g.items.map((i) => i.title));
      adminSeesBoth = titles.includes(label(scoped)) && titles.includes(label(other));
      if (!adminSeesBoth) await new Promise((r) => setTimeout(r, 500));
    }
    expect(adminSeesBoth).toBe(true);
    const mine = await client.call(`/api/search?q=zs-&scope=zones&limit=25`, { method: "GET" });
    expect(mine.status).toBe(200);
    const mineBody = (await mine.json()) as {
      groups: Array<{ items: Array<{ title: string }> }>;
    };
    const mineTitles = mineBody.groups.flatMap((g) => g.items.map((i) => i.title));
    expect(mineTitles).toContain(label(scoped));
    expect(mineTitles).not.toContain(label(other));

    // Notifications: only findings about the scoped zone, never backend health.
    const notes = await client.call("/api/admin/notifications?status=all", { method: "GET" });
    expect(notes.status).toBe(200);
    const notesBody = (await notes.json()) as {
      notifications: Array<{ source: string; zone: string | null }>;
    };
    for (const n of notesBody.notifications) {
      expect(n.source).toBe("zone");
      expect(n.zone).toBe(scoped);
    }
  }, 60_000);

  it("keeps the fleet-wide pages behind their global permission", async () => {
    const admin = await loginAsBootstrap();
    const scoped = randomZone("zs-fleet");
    await createZone(admin, scoped);
    const { user, client } = await createAndLogin(admin, {
      email: uniqueEmail("zone-scoped-fleet"),
      name: "Zone-scoped fleet reader",
      password: "zone-scoped-fleet-pw-1234",
    });
    await plantZoneScope(user.id, scoped, ZONE_EDITOR);

    expect((await client.call("/api/admin/monitoring/zones", { method: "GET" })).status).toBe(403);
    expect((await client.call("/api/admin/pdns/auto-ptr/report", { method: "GET" })).status).toBe(
      403,
    );
  }, 30_000);
});
