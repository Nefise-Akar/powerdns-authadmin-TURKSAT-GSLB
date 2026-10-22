/**
 * scripts/migrate.ts
 *
 * Programmatic migration runner. Picks the driver + migrations directory
 * from `DATABASE_URL`:
 *
 *   - `postgres://...` / `postgresql://...` → drizzle-orm/node-postgres + drizzle/
 *   - `file:...` / `sqlite:...`             → drizzle-orm/better-sqlite3 + drizzle-sqlite/
 *
 * Used by:
 *   - `npm run db:migrate` - operator-driven invocation
 *   - The app container entrypoint at boot (ADR-0011) - same script, no
 *     special-casing needed
 *
 * For Postgres in multi-instance deployments, the migrate step takes a
 * `pg_advisory_lock` so only one pod actually applies migrations even if
 * several boot simultaneously. SQLite is single-writer so no lock is needed,
 * but it needs foreign-key enforcement OFF around drizzle's transaction - see
 * `lib/db/migrate-sqlite.ts` for why.
 *
 * Both dialects follow drizzle's pass with the out-of-order backfill
 * (`outOfOrderPending` in lib/db/migration-status.ts): journal entries drizzle's
 * high-water-mark migrator skips by design are applied in a second transaction.
 *
 * Logging is deliberately loud: a list of pending migrations before the
 * run, a list of applied migrations after, an explicit "0 pending - DB is
 * up to date" when there's nothing to do. A silent migrate hid a missing
 * column once; the louder shape lets `docker compose logs app | grep
 * migrate` answer "did the migration run?" without psql digging.
 */

import { dialectFromUrl } from "@/lib/db/_dialect";
import { logger } from "@/lib/logger";
import {
  diffByWhen,
  outOfOrderPending,
  readJournal,
  type JournalEntry,
} from "@/lib/db/migration-status";

const MIGRATIONS_DIR_PG = "./drizzle";
const MIGRATIONS_DIR_SQLITE = "./drizzle-sqlite";

function stripSqlitePrefix(url: string): string {
  let s = url;
  if (s.startsWith("sqlite:")) s = s.slice("sqlite:".length);
  else if (s.startsWith("file:")) s = s.slice("file:".length);
  if (s.startsWith("///")) return s.slice(2);
  if (s.startsWith("//")) return s.slice(2);
  return s;
}

/**
 * Advisory-lock key for the Postgres migration step. Stable int8; concurrent
 * migrate processes serialize on the same lock.
 */
const PG_MIGRATE_ADVISORY_KEY = "31745931495632974";

async function migratePostgres(databaseUrl: string): Promise<void> {
  const pg = (await import("pg")).default;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");

  const journal = readJournal(MIGRATIONS_DIR_PG);
  logger.info(
    {
      dir: MIGRATIONS_DIR_PG,
      total: journal.length,
      tags: journal.map((e) => e.tag),
    },
    "migrate.pg.journal",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [PG_MIGRATE_ADVISORY_KEY.toString()]);
      logger.info({ dir: MIGRATIONS_DIR_PG }, "migrate.pg.lock-acquired");

      // Snapshot the ledger BEFORE running so we can log the delta.
      const before = await readAppliedWhensPg(client);
      const beforeStatus = diffByWhen(journal, before);
      if (beforeStatus.pending.length === 0) {
        logger.info({ applied: before.size, total: journal.length }, "migrate.pg.up-to-date");
      } else {
        logger.info(
          { pending: beforeStatus.pending, count: beforeStatus.pending.length },
          "migrate.pg.pending",
        );
      }

      const db = drizzle(client);
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR_PG });
      const skipped = outOfOrderPending(journal, await readAppliedWhensPg(client));
      if (skipped.length > 0) await applyOutOfOrderPg(client, skipped);

      // Re-read to confirm Drizzle actually applied what we expected.
      const after = await readAppliedWhensPg(client);
      const justApplied = journal
        .filter((e) => after.has(e.when) && !before.has(e.when))
        .map((e) => e.tag);
      logger.info(
        {
          applied: justApplied,
          appliedCount: justApplied.length,
          totalApplied: journal.filter((e) => after.has(e.when)).length,
          totalExpected: journal.length,
        },
        "migrate.pg.complete",
      );

      const finalStatus = diffByWhen(journal, after);
      if (finalStatus.pending.length > 0) {
        // This should never happen - Drizzle's migrate is supposed to apply
        // everything pending. Loud warning so an operator notices.
        logger.error({ stillPending: finalStatus.pending }, "migrate.pg.incomplete");
        throw new Error(
          `Drizzle migrate returned but ${finalStatus.pending.length} migration(s) are still pending: ${finalStatus.pending.join(", ")}`,
        );
      }
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [PG_MIGRATE_ADVISORY_KEY.toString()]);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

interface PgQueryClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** The ledger's `created_at` values - drizzle stores each entry's journal `when` there. */
async function readAppliedWhensPg(client: PgQueryClient): Promise<Set<number>> {
  try {
    const result = await client.query("SELECT created_at FROM drizzle.__drizzle_migrations");
    return new Set(result.rows.map((r) => Number(r["created_at"])));
  } catch {
    return new Set();
  }
}

/**
 * Apply journal entries drizzle skipped, the way drizzle would: every
 * statement, then a ledger row with the entry's `when`, in one transaction.
 */
async function applyOutOfOrderPg(
  client: PgQueryClient,
  entries: readonly JournalEntry[],
): Promise<void> {
  const { readMigrationFiles } = await import("drizzle-orm/migrator");
  const files = new Map(
    readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR_PG }).map((m) => [m.folderMillis, m]),
  );
  logger.info({ tags: entries.map((e) => e.tag) }, "migrate.pg.out-of-order");
  await client.query("BEGIN");
  try {
    for (const entry of entries) {
      const file = files.get(entry.when);
      if (!file) throw new Error(`migrate.pg: no migration file for journal entry ${entry.tag}`);
      for (const statement of file.sql) await client.query(statement);
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)',
        [file.hash, entry.when],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function migrateSqlite(databaseUrl: string): Promise<void> {
  // The SQLite path lives in lib/ so the exact code the container boots
  // through is unit-tested against a real database (lib/db/migrate-sqlite.test.ts).
  const { migrateSqliteDatabase } = await import("@/lib/db/migrate-sqlite");
  migrateSqliteDatabase(stripSqlitePrefix(databaseUrl), MIGRATIONS_DIR_SQLITE);
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.error("migrate.failed: DATABASE_URL is not set");
    process.exit(1);
  }
  const dialect = dialectFromUrl(databaseUrl);
  logger.info({ dialect }, "migrate.start");
  if (dialect === "sqlite") {
    await migrateSqlite(databaseUrl);
  } else {
    await migratePostgres(databaseUrl);
  }
}

void main().catch((err: unknown) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "migrate.failed");
  process.exit(1);
});
