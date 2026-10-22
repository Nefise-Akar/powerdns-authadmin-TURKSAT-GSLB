/**
 * lib/db/migrate-sqlite.test.ts
 *
 * Regression test for the SQLite upgrade data loss: a database created at the
 * 1.0.x schema (migrations 0000-0002) holding a backend, a zone grant, metric
 * samples, daemon statistics and request-log rows is upgraded through the full
 * current journal. Migration 0003 rebuilds `pdns_servers` (drop + rename);
 * with foreign-key enforcement left on inside drizzle's transaction, SQLite's
 * implicit DELETE on `DROP TABLE` cascaded into every child table. The rows
 * must survive and the database must pass `PRAGMA foreign_key_check`.
 *
 * Runs against the real better-sqlite3 binding and the committed
 * `drizzle-sqlite/` journal, so it also guards every future recreate
 * migration drizzle-kit emits.
 *
 * The second suite covers the 1.11.0 merge: upstream's 0008 sits before this
 * fork's GSLB migrations (0009-0015), which keep their original journal
 * `when`. Databases that applied them as 0008-0014, databases on plain
 * upstream and fresh databases must all end up with the full schema.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MIGRATIONS_DIR_SQLITE, migrateSqliteDatabase } from "./migrate-sqlite";

/** Journal index of the last migration the fixture database is built at. */
const FIXTURE_LAST_IDX = 2;

interface Journal {
  entries: Array<{ idx: number; tag: string; when: number; version: string; breakpoints: boolean }>;
  [key: string]: unknown;
}

/**
 * Copy the first `FIXTURE_LAST_IDX + 1` migrations into a scratch folder with a
 * truncated journal, so the migrator can bring an empty file to exactly the
 * pre-0003 schema.
 */
function writeTruncatedMigrations(dir: string): string {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR_SQLITE, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const kept = journal.entries.filter((e) => e.idx <= FIXTURE_LAST_IDX);
  mkdirSync(join(dir, "meta"), { recursive: true });
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: kept }, null, 2),
  );
  for (const entry of kept) {
    writeFileSync(
      join(dir, `${entry.tag}.sql`),
      readFileSync(join(MIGRATIONS_DIR_SQLITE, `${entry.tag}.sql`), "utf8"),
    );
  }
  return dir;
}

/** Write the committed migrations whose tags pass `keep`, in journal order. */
function writeMigrationSubset(dir: string, keep: (tag: string, idx: number) => boolean): string {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR_SQLITE, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const kept = journal.entries.filter((e) => keep(e.tag, e.idx));
  mkdirSync(join(dir, "meta"), { recursive: true });
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: kept }, null, 2),
  );
  for (const entry of kept) {
    writeFileSync(
      join(dir, `${entry.tag}.sql`),
      readFileSync(join(MIGRATIONS_DIR_SQLITE, `${entry.tag}.sql`), "utf8"),
    );
  }
  return dir;
}

const UPSTREAM_0008 = "0008_monitor_accept_single_ns";
const isForkGslb = (idx: number) => idx >= 9 && idx <= 15;

function columns(handle: Database.Database, table: string): string[] {
  return (handle.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

function ledgerWhens(handle: Database.Database): number[] {
  return (
    handle.prepare("SELECT created_at FROM __drizzle_migrations").all() as Array<{
      created_at: number;
    }>
  )
    .map((r) => Number(r.created_at))
    .sort((a, b) => a - b);
}

function journalWhens(): number[] {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR_SQLITE, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  return journal.entries.map((e) => e.when).sort((a, b) => a - b);
}

function expectFullSchema(dbPath: string): void {
  const handle = new Database(dbPath);
  try {
    expect(columns(handle, "pdns_servers")).toContain("monitor_accept_single_ns");
    for (const table of ["gslb_backends", "gslb_regions", "gslb_zones", "gslb_records"]) {
      expect(columns(handle, table).length).toBeGreaterThan(0);
    }
    // 0013 and 0015 drop these again.
    expect(columns(handle, "zone_pairs")).toEqual([]);
    expect(columns(handle, "gslb_pools")).toEqual([]);
    expect(ledgerWhens(handle)).toEqual(journalWhens());
    expect(handle.pragma("foreign_key_check")).toEqual([]);
  } finally {
    handle.close();
  }
}

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SERVER_ID = "00000000-0000-4000-8000-000000000002";
const GRANT_ID = "00000000-0000-4000-8000-000000000003";

function seedFixture(dbPath: string): void {
  const handle = new Database(dbPath);
  try {
    handle.pragma("foreign_keys = ON");
    const now = Date.now();
    handle
      .prepare(
        `INSERT INTO users (id, email, password_hash_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(USER_ID, "alice@example.com", now, now, now);
    handle
      .prepare(
        `INSERT INTO pdns_servers (id, slug, name, base_url, api_key_encrypted, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(SERVER_ID, "primary", "Primary", "http://pdns:8081/api/v1", "enc:key", now, now);
    handle
      .prepare(
        `INSERT INTO zone_grants (id, user_id, server_id, zone_name, permissions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(GRANT_ID, USER_ID, SERVER_ID, "example.com.", '["zone.read"]', now, now);
    const sample = handle.prepare(
      `INSERT INTO metric_samples (server_id, sampled_at, zone_count, latency_p50_ms) VALUES (?, ?, ?, ?)`,
    );
    for (let i = 0; i < 5; i += 1) sample.run(SERVER_ID, now - i * 60_000, 10 + i, 12.5);
    const stat = handle.prepare(
      `INSERT INTO pdns_server_stats (ts, server_id, name, value) VALUES (?, ?, ?, ?)`,
    );
    for (let i = 0; i < 3; i += 1) stat.run(now - i * 60_000, SERVER_ID, "udp-queries", 100 + i);
    handle
      .prepare(
        `INSERT INTO pdns_requests (ts, request_id, server_id, server_slug, op, method, url, response_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 200)`,
      )
      .run(
        now,
        "req-1",
        SERVER_ID,
        "primary",
        "zones.list",
        "GET",
        "http://pdns:8081/api/v1/zones",
      );
  } finally {
    handle.close();
  }
}

function count(handle: Database.Database, sql: string): number {
  return (handle.prepare(sql).get() as { n: number }).n;
}

describe("migrateSqliteDatabase", () => {
  let scratch: string;
  let dbPath: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "pda-migrate-"));
    dbPath = join(scratch, "app.db");
    const truncated = writeTruncatedMigrations(join(scratch, "migrations-0002"));
    const outcome = migrateSqliteDatabase(dbPath, truncated);
    expect(outcome.totalApplied).toBe(FIXTURE_LAST_IDX + 1);
    seedFixture(dbPath);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("upgrades a 1.0.x database to HEAD without losing child rows of rebuilt tables", () => {
    const outcome = migrateSqliteDatabase(dbPath);
    expect(outcome.applied.length).toBeGreaterThan(0);
    expect(outcome.totalApplied).toBe(outcome.totalExpected);

    const handle = new Database(dbPath);
    try {
      expect(count(handle, "SELECT COUNT(*) AS n FROM pdns_servers")).toBe(1);
      expect(count(handle, "SELECT COUNT(*) AS n FROM zone_grants")).toBe(1);
      expect(count(handle, "SELECT COUNT(*) AS n FROM metric_samples")).toBe(5);
      expect(count(handle, "SELECT COUNT(*) AS n FROM pdns_server_stats")).toBe(3);
      expect(
        count(handle, "SELECT COUNT(*) AS n FROM pdns_requests WHERE server_id IS NOT NULL"),
      ).toBe(1);
      // The grant still points at the backend row that survived the rebuild.
      const grant = handle
        .prepare("SELECT server_id, user_id FROM zone_grants WHERE id = ?")
        .get(GRANT_ID) as { server_id: string; user_id: string };
      expect(grant).toEqual({ server_id: SERVER_ID, user_id: USER_ID });
      expect(handle.pragma("foreign_key_check")).toEqual([]);
    } finally {
      handle.close();
    }
  });

  it("is idempotent - a second run applies nothing and keeps the data", () => {
    migrateSqliteDatabase(dbPath);
    const again = migrateSqliteDatabase(dbPath);
    expect(again.applied).toEqual([]);

    const handle = new Database(dbPath);
    try {
      expect(count(handle, "SELECT COUNT(*) AS n FROM zone_grants")).toBe(1);
    } finally {
      handle.close();
    }
  });
});

describe("migrateSqliteDatabase - upstream 0008 before the GSLB migrations", () => {
  let scratch: string;
  let dbPath: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "pda-migrate-order-"));
    dbPath = join(scratch, "app.db");
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("(a) a database that applied the GSLB migrations as 0008-0014 gets only upstream 0008", () => {
    // Same ledger as a pre-merge install: every entry except upstream's 0008.
    const before = writeMigrationSubset(join(scratch, "pre-merge"), (tag) => tag !== UPSTREAM_0008);
    expect(migrateSqliteDatabase(dbPath, before).totalApplied).toBe(15);
    const now = Date.now();
    const seed = new Database(dbPath);
    seed
      .prepare(
        `INSERT INTO gslb_backends (id, slug, name, base_url, username, password_encrypted, created_at, updated_at)
         VALUES ('b1', 'gslb', 'GSLB', 'http://gslb:8080', 'u', 'enc:pw', ?, ?)`,
      )
      .run(now, now);
    seed.close();

    const outcome = migrateSqliteDatabase(dbPath);
    expect(outcome.applied).toEqual([UPSTREAM_0008]);
    expect(outcome.totalApplied).toBe(outcome.totalExpected);
    expectFullSchema(dbPath);
    const handle = new Database(dbPath);
    try {
      expect(count(handle, "SELECT COUNT(*) AS n FROM gslb_backends")).toBe(1);
    } finally {
      handle.close();
    }
    expect(migrateSqliteDatabase(dbPath).applied).toEqual([]);
  });

  it("(c) a fresh database gets every migration", () => {
    const outcome = migrateSqliteDatabase(dbPath);
    expect(outcome.totalApplied).toBe(outcome.totalExpected);
    expectFullSchema(dbPath);
  });

  it("(d) a database on plain upstream 1.11.0 gets the GSLB migrations drizzle would skip", () => {
    const upstream = writeMigrationSubset(
      join(scratch, "upstream"),
      (_tag, idx) => !isForkGslb(idx),
    );
    expect(migrateSqliteDatabase(dbPath, upstream).totalApplied).toBe(9);

    const outcome = migrateSqliteDatabase(dbPath);
    expect(outcome.applied).toEqual([
      "0009_gslb_backends",
      "0010_gslb_regions",
      "0011_gslb_zones_records",
      "0012_gslb_presets_zone_pairs",
      "0013_drop_zone_pairs",
      "0014_gslb_pools",
      "0015_remove_gslb_pools",
    ]);
    expectFullSchema(dbPath);
    expect(migrateSqliteDatabase(dbPath).applied).toEqual([]);
  });
});
