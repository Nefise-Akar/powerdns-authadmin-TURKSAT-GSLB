/**
 * components/domain/capability-badges.tsx
 *
 * One tag per PDNS capability a backend reports ON, so a server row shows its
 * role at a glance: primary, secondary, autosecondary - or `standalone` when no
 * replication flag is set (default PDNS Auth config; the API still accepts
 * zone creates, so it's fully usable), `unprobed` before the first probe.
 *
 * Two more tags ride along:
 *   • lua records - `enable-lua-records` is `yes` or `shared` (#122). Rendered
 *     last so the replication roles keep their leading position, and never
 *     suppressed by `standalone` - a standalone daemon with Lua armed is
 *     exactly the case the operator must see.
 *   • read-only - operator-declared, not observed: `write_mode='read_only'`
 *     (#111). Shown first, because it overrides whatever the daemon reports:
 *     a node tagged `standalone read-only` looks writable to PDNS but the
 *     operator has vetoed writes to it.
 *
 * These are categories, so they all use the plain Tag - the design system
 * keeps color for status, and the label carries the distinction.
 */

import { Tag } from "@/components/ui/badge";

/** Subset of the capability flags this component cares about. Declared locally
 *  so the UI layer doesn't reach into lib/pdns (the three-layer rule); any
 *  PdnsDaemonCapabilities value structurally satisfies it. */
interface Capabilities {
  primary: boolean;
  secondary: boolean;
  autosecondary: boolean;
  /** `enable-lua-records` mode. Absent on snapshots taken before #122 - that's
   *  "not observed", so no badge either way, rather than a claim of "off". */
  luaRecords?: "no" | "yes" | "shared";
}

interface Badge {
  key: string;
  label: string;
  title?: string;
}

export function CapabilityBadges({
  capabilities,
  writeMode = "auto",
}: {
  capabilities: Capabilities | null;
  /** Operator write-routing override (#111). "read_only" adds a leading badge. */
  writeMode?: "auto" | "read_only";
}) {
  const badges: Badge[] = [];

  // First, because it overrides whatever the daemon reports.
  if (writeMode === "read_only") {
    badges.push({
      key: "read-only",
      label: "read-only",
      title: "Operator override: writes are never routed here",
    });
  }

  if (!capabilities) {
    badges.push({ key: "unprobed", label: "unprobed" });
  } else {
    const roles = (["primary", "secondary", "autosecondary"] as const).filter(
      (role) => capabilities[role],
    );
    if (roles.length === 0) {
      badges.push({ key: "standalone", label: "standalone" });
    } else {
      for (const role of roles) badges.push({ key: role, label: role });
    }
    // Not a replication role, so it rides alongside `standalone` rather than
    // being displaced by it.
    const lua = capabilities.luaRecords;
    if (lua === "yes" || lua === "shared") {
      badges.push({
        key: "lua",
        label: lua === "shared" ? "lua records (shared)" : "lua records",
        title: `enable-lua-records=${lua} - this daemon arms LUA records (executable server-side code) for every zone it serves`,
      });
    }
  }

  return (
    <span className="inline-flex flex-wrap gap-1">
      {badges.map((b) => (
        <Tag key={b.key} title={b.title}>
          {b.label}
        </Tag>
      ))}
    </span>
  );
}
