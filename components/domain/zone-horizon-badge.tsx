/**
 * components/domain/zone-horizon-badge.tsx
 *
 * The INTERNAL badge - "this copy of the zone is the internal one" (#121,
 * ADR-0022). Rendered next to the CLUSTER badge in the zones list and next to
 * the zone name on zone detail, so a fleet running split-horizon reads as
 * `[CLUSTER] [INTERNAL]` at a glance rather than as two mystery rows with the
 * same name.
 *
 * Only `internal` gets a badge. `public` is the default horizon - badging it
 * would put a marker on nearly every row and stop the badge meaning anything.
 *
 * A horizon is a category, so it's a plain Tag like the capability tags - the
 * design system keeps color for status; the word itself is the signal.
 */

import { Tag } from "@/components/ui/badge";
import { type ZoneHorizon } from "@/lib/dns/zone-horizon";

const TITLE =
  "Internal zone - listed separately from a public zone of the same name (split horizon)";

/** Badge for a zone's horizon; renders nothing for the default (`public`). */
export function ZoneHorizonBadge({
  horizon,
  className,
}: {
  horizon: ZoneHorizon;
  /** Extra classes for spacing at the call site (e.g. `ml-2`). */
  className?: string;
}) {
  if (horizon !== "internal") return null;
  return (
    <Tag className={className} title={TITLE}>
      internal
      {/* The tooltip text, for keyboard and touch users who can't hover. */}
      <span className="sr-only"> ({TITLE})</span>
    </Tag>
  );
}
