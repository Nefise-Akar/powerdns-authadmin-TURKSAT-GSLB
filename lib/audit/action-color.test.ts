import { describe, expect, it } from "vitest";
import { colorForAuditAction } from "./action-color";

describe("colorForAuditAction", () => {
  it("returns the destructive color for .delete and .revoked", () => {
    expect(colorForAuditAction("record.delete")).toContain("text-destructive");
    expect(colorForAuditAction("session.revoked")).toContain("text-destructive");
  });

  it("returns the neutral tag for every other verb", () => {
    for (const action of [
      "record.create",
      "role.granted",
      "user.update",
      "zone.metadata.set",
      "auth.login.success",
      "anything.weird",
    ]) {
      expect(colorForAuditAction(action)).toBe("bg-tag text-tag-foreground");
    }
  });

  it("does not match action that merely contains the verb mid-string", () => {
    // Suffix-only - `record.deletes` (typo) should NOT be treated as delete.
    expect(colorForAuditAction("record.deletes")).toBe("bg-tag text-tag-foreground");
  });
});
