/**
 * lib/db/migration-status.test.ts
 *
 * The journal/ledger diff and the out-of-order detection the migration runner
 * relies on to apply journal entries drizzle's high-water-mark migrator skips.
 */

import { describe, expect, it } from "vitest";
import { diffByWhen, outOfOrderPending, type JournalEntry } from "./migration-status";

const e = (idx: number, tag: string, when: number): JournalEntry => ({ idx, tag, when });

// Upstream 0007 + 0008, then fork migrations generated before upstream's 0008
// and kept at their original `when`.
const journal = [
  e(7, "0007_up", 700),
  e(8, "0008_up", 900),
  e(9, "0009_fork", 800),
  e(10, "0010_fork", 850),
];

describe("outOfOrderPending", () => {
  it("returns the fork entries for a database coming from plain upstream", () => {
    expect(outOfOrderPending(journal, new Set([700, 900])).map((x) => x.tag)).toEqual([
      "0009_fork",
      "0010_fork",
    ]);
  });

  it("returns nothing once every entry is recorded", () => {
    expect(outOfOrderPending(journal, new Set([700, 800, 850, 900]))).toEqual([]);
  });

  it("returns nothing for a fresh database (drizzle applies everything in order)", () => {
    expect(outOfOrderPending(journal, new Set())).toEqual([]);
  });

  it("leaves entries above the high-water mark to drizzle", () => {
    // Ledger stops at 0007: drizzle itself applies 0008, 0009 and 0010.
    expect(outOfOrderPending(journal, new Set([700]))).toEqual([]);
  });

  it("never re-runs an in-order entry missing from the ledger (squashed history)", () => {
    const monotonic = [e(0, "a", 100), e(1, "b_squash", 200), e(2, "c", 300)];
    expect(outOfOrderPending(monotonic, new Set([100, 150, 300]))).toEqual([]);
  });
});

describe("diffByWhen", () => {
  it("names the pending entry by when, not by row count", () => {
    // The fork's state before this merge: everything except upstream 0008.
    const status = diffByWhen(journal, new Set([700, 800, 850]));
    expect(status.pending).toEqual(["0008_up"]);
    expect(status.unknown).toEqual([]);
  });

  it("reports ledger rows the journal doesn't know", () => {
    expect(diffByWhen(journal, new Set([700, 123])).unknown).toEqual(["when-123"]);
  });
});
