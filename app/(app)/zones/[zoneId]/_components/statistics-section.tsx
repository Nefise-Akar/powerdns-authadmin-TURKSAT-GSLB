/**
 * Statistics tab body for the zone detail page. PDNS doesn't expose
 * per-zone statistics endpoints - what we surface here is audit-derived
 * per-zone activity over the last 7 days. Server-wide PDNS counters
 * (query rate, latency, qtype mix) live on the dashboard "PowerDNS
 * stats" tab where they belong; surfacing them here implied per-zone
 * relevance they don't actually have.
 */

import { zoneAuditCounts7d } from "@/lib/db/repositories/audit-log";

interface Props {
  /** Backend slug(s) - multiple for a cluster (edits scatter across peers). */
  serverSlugs: readonly string[];
  zoneName: string;
}

export async function ZoneStatisticsSection({ serverSlugs, zoneName }: Props) {
  const zoneCounts = await zoneAuditCounts7d(serverSlugs, zoneName);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-h3 text-foreground mb-2">Activity (last 7 days)</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Stat label="Records added" value={zoneCounts.recordCreate} />
          <Stat label="Records updated" value={zoneCounts.recordUpdate} />
          <Stat label="Records deleted" value={zoneCounts.recordDelete} />
          <Stat label="NOTIFY sent" value={zoneCounts.notify} />
          <Stat label="Metadata edits" value={zoneCounts.metadata} />
          <Stat label="Settings edits" value={zoneCounts.settings} />
          <Stat label="DNSSEC ops" value={zoneCounts.dnssec} />
          <Stat label="Total operations" value={zoneCounts.total} />
        </dl>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-medium">{value}</dd>
    </div>
  );
}
