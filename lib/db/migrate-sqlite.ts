/**
 * lib/db/migrate-sqlite.ts
 *
 * The SQLite half of the migration runner (`scripts/migrate.ts` is the CLI
 * around it). Lives in `lib/` so the exact code path the container boots
 * through is unit-testable against a real on-disk database.
 *
 * Why foreign keys are switched OFF around `migrate()`: drizzle-kit emits
 * table rebuilds as `PRAGMA foreign_keys=OFF; CREATE __new; INSERT…SELECT;
 * DROP old; RENAME; PRAGMA foreign_keys=ON;`, and drizzle's synchronous
 * migrator runs every pending migration inside one `BEGIN … COMMIT`. SQLite
 * documents `PRAGMA foreign_keys` as a no-op inside a transaction, so the
 * in-migration OFF never takes effect. With enforcement still on, `DROP TABLE`
 * performs an implicit `DELETE FROM` that fires the children's `ON DELETE`
 * actions - release 1.1.0's `pdns_servers` rebuild silently emptied
 * `zone_grants`, `metric_samples` and `pdns_server_stats` and nulled
 * `pdns_requests.server_id`. The pragma therefore has to be set on the raw
 * connection BEFORE the migrator opens its transaction, and referential
 * integrity is verified explicitly afterwards (`PRAGMA foreign_key_check`),
 * which is exactly the procedure SQLite's own ALTER TABLE documentation
 * prescribes for table rebuilds.
 *
 * After drizzle's pass, journal entries it skips by design - out of `when`
 * order and below the ledger's high-water mark - are applied in a second
 * transaction (`outOfOrderPending` in ./migration-status explains when that
 * happens).
 */

import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { logger } from "@/lib/logger";
import { diffByWhen, outOfOrderPending, readJournal, type JournalEntry } from "./migration-status";

export const MIGRATIONS_DIR_SQLITE = "./drizzle-sqlite";

export interface SqliteMigrationOutcome {
  /** Journal tags applied by this run (empty when the DB was up to date). */
  applied: string[];
  totalApplied: number;
  totalExpected: number;
}

/**
 * Apply every pending migration from `migrationsDir` to the SQLite database at
 * `filePath`. Loud logging, mirroring the Postgres path: pending list before,
 * applied list after, and an error if anything is still pending.
 *
 * @throws {Error} when a migration fails, when `PRAGMA foreign_key_check`
 *   reports violations after the run (the transaction has already committed by
 *   then - the error is so the operator sees it rather than a silently broken
 *   database), or when drizzle returns with migrations still pending.
 */
export function migrateSqliteDatabase(
  filePath: string,
  migrationsDir: string = MIGRATIONS_DIR_SQLITE,
): SqliteMigrationOutcome {
  const journal = readJournal(migrationsDir);
  logger.info(
    { dir: migrationsDir, total: journal.length, tags: journal.map((e) => e.tag) },
    "migrate.sqlite.journal",
  );

  const handle = new Database(filePath);
  try {
    handle.pragma("journal_mode = WAL");
    handle.pragma("busy_timeout = 5000");

    const before = readAppliedWhensSqlite(handle);
    const beforeStatus = diffByWhen(journal, before);
    if (beforeStatus.pending.length === 0) {
      logger.info(
        { applied: before.size, total: journal.length, file: filePath },
        "migrate.sqlite.up-to-date",
      );
    } else {
      logger.info(
        { pending: beforeStatus.pending, count: beforeStatus.pending.length, file: filePath },
        "migrate.sqlite.pending",
      );
    }

    // Must be issued outside drizzle's BEGIN - see the module comment.
    handle.pragma("foreign_keys = OFF");
    try {
      migrate(drizzle(handle), { migrationsFolder: migrationsDir });
      const skipped = outOfOrderPending(journal, readAppliedWhensSqlite(handle));
      if (skipped.length > 0) applyOutOfOrder(handle, migrationsDir, skipped);
    } finally {
      // Re-enable regardless of outcome so a failed run can't leave the
      // connection (reused by a caller) without enforcement.
      handle.pragma("foreign_keys = ON");
    }

    const violations = handle.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      logger.error(
        { violations: violations.slice(0, 20), count: violations.length },
        "migrate.sqlite.foreign-key-violations",
      );
      throw new Error(
        `migrate.sqlite: ${violations.length} foreign-key violation(s) after migrate - the database needs manual repair before the app can run on it.`,
      );
    }

    const after = readAppliedWhensSqlite(handle);
    const justApplied = journal
      .filter((e) => after.has(e.when) && !before.has(e.when))
      .map((e) => e.tag);
    const afterCount = journal.filter((e) => after.has(e.when)).length;
    logger.info(
      {
        applied: justApplied,
        appliedCount: justApplied.length,
        totalApplied: afterCount,
        totalExpected: journal.length,
        file: filePath,
      },
      "migrate.sqlite.complete",
    );

    const finalStatus = diffByWhen(journal, after);
    if (finalStatus.pending.length > 0) {
      logger.error({ stillPending: finalStatus.pending }, "migrate.sqlite.incomplete");
      throw new Error(
        `Drizzle migrate returned but ${finalStatus.pending.length} migration(s) are still pending: ${finalStatus.pending.join(", ")}`,
      );
    }

    return { applied: justApplied, totalApplied: afterCount, totalExpected: journal.length };
  } finally {
    handle.close();
  }
}

/**
 * Apply journal entries drizzle skipped, the way drizzle would: every
 * statement, then a ledger row with the entry's `when`, all in one
 * transaction so a failure leaves the ledger untouched.
 */
function applyOutOfOrder(
  handle: Database.Database,
  migrationsDir: string,
  entries: readonly JournalEntry[],
): void {
  const files = new Map(
    readMigrationFiles({ migrationsFolder: migrationsDir }).map((m) => [m.folderMillis, m]),
  );
  logger.info({ tags: entries.map((e) => e.tag) }, "migrate.sqlite.out-of-order");
  const record = handle.prepare(
    'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)',
  );
  handle.transaction(() => {
    for (const entry of entries) {
      const file = files.get(entry.when);
      if (!file)
        throw new Error(`migrate.sqlite: no migration file for journal entry ${entry.tag}`);
      for (const statement of file.sql) handle.exec(statement);
      record.run(file.hash, entry.when);
    }
  })();
}

/** The ledger's `created_at` values - drizzle stores each entry's journal `when` there. */
function readAppliedWhensSqlite(handle: Database.Database): Set<number> {
  try {
    const rows = handle.prepare("SELECT created_at FROM __drizzle_migrations").all() as Array<{
      created_at: unknown;
    }>;
    return new Set(rows.map((r) => Number(r.created_at)));
  } catch {
    // The migrations table doesn't exist yet - a fresh database.
    return new Set();
  }
}
