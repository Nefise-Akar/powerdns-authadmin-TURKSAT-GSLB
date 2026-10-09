/**
 * Sync tab body - replication / consistency view for one zone.
 *
 * Two modes, identical layout, different wording:
 *
 *   • primary-secondaries: the zone is served by a Primary that NOTIFYs
 *     N Secondaries. Each Secondary is compared serial-to-serial AND
 *     record-for-record against the Primary. Anything off ⇒ in-flight
 *     or stalled replication.
 *
 *   • cluster: the zone is served by N peer Primaries sharing a
 *     replicated backend. There's no canonical Primary, so the peer
 *     with the highest serial becomes the anchor for the comparison
 *     (ties broken alphabetically). Any other peer whose content drifts
 *     ⇒ flagged. Per-user request: "highest serial would be regarded as
 *     source of truth here."
 */

import { compareZoneRecords, compareClusterPeerRecords } from "@/lib/pdns/sync";
import { BareDiff } from "./bare-diff";
import type { PdnsServer } from "@/lib/db/schema";
import type { PdnsZoneDetail } from "@/lib/pdns/types";
import Link from "next/link";

type Props =
  | {
      mode: "primary-secondaries";
      primary: PdnsServer;
      zone: PdnsZoneDetail;
    }
  | {
      mode: "cluster";
      /** All active peers, including the one this view is reading from.
       *  The helper picks the highest-serial peer as the anchor - it
       *  doesn't have to be the one we currently render via. */
      peers: PdnsServer[];
      zoneName: string;
      /** The cluster, for the header copy + the empty-state link. */
      cluster: { id: string; name: string; slug: string };
    };

export function SyncSection(props: Props) {
  if (props.mode === "cluster") {
    return <ClusterSync {...props} />;
  }
  return <PrimarySecondariesSync {...props} />;
}

async function PrimarySecondariesSync({
  primary,
  zone,
}: {
  primary: PdnsServer;
  zone: PdnsZoneDetail;
}) {
  const diffs = await compareZoneRecords(primary, zone);
  if (diffs.length === 0) {
    return (
      <div className="border-border bg-background text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        No secondaries configured for <code className="font-mono">{primary.name}</code>. Add one on
        the{" "}
        <Link href={`/admin/servers/${primary.id}`} className="underline">
          server admin page
        </Link>{" "}
        to enable sync checks here.
      </div>
    );
  }

  return (
    <DiffList
      headerTitle={`Replication state (${diffs.length} secondar${diffs.length === 1 ? "y" : "ies"})`}
      headerSubtitle="Each secondary is compared against the serial the primary serves (after SOA-EDIT) and record-for-record. Differences below the header mean replication is in flight or stalled."
      diffs={diffs.map((d) => ({
        ...d,
        // For the primary/secondaries mode the labels match what was
        // there before - primary serial / secondary serial.
        leftLabel: "primary served serial",
        rightLabel: "secondary serial",
        synopsis: "All records match between primary and secondary.",
      }))}
    />
  );
}

async function ClusterSync({
  peers,
  zoneName,
  cluster,
}: {
  peers: PdnsServer[];
  zoneName: string;
  cluster: { id: string; name: string; slug: string };
}) {
  if (peers.length < 2) {
    return (
      <div className="border-border bg-background text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        Cluster <code className="font-mono">{cluster.name}</code> has fewer than two active peers -
        nothing to compare. Add a peer on the{" "}
        <Link href={`/admin/clusters/${cluster.slug}`} className="underline">
          cluster admin page
        </Link>{" "}
        to enable sync checks here.
      </div>
    );
  }

  const { anchor, diffs } = await compareClusterPeerRecords(peers, zoneName);

  return (
    <DiffList
      headerTitle={`Cluster sync (${peers.length} peers)`}
      headerSubtitle={
        <>
          Each peer is compared serial-to-serial and record-for-record against{" "}
          <code className="font-mono">{anchor.name}</code>, the highest-serial peer (used as
          source-of-truth when peers disagree). Drift below the header means a write hasn&apos;t
          propagated across all peers yet.
        </>
      }
      diffs={diffs.map((d) => ({
        ...d,
        leftLabel: "anchor serial",
        rightLabel: "peer serial",
        synopsis: "Peer matches the anchor exactly.",
      }))}
    />
  );
}

interface DiffWithLabels {
  server: PdnsServer;
  primarySerial: number | null;
  secondarySerial: number | null;
  refreshDue: boolean;
  onlyOnPrimary: string[];
  onlyOnSecondary: string[];
  presignedRecords: number;
  error: string | null;
  leftLabel: string;
  rightLabel: string;
  synopsis: string;
}

function DiffList({
  headerTitle,
  headerSubtitle,
  diffs,
}: {
  headerTitle: string;
  headerSubtitle: React.ReactNode;
  diffs: DiffWithLabels[];
}) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-h3 text-foreground">{headerTitle}</h2>
        <p className="text-muted-foreground mt-1 text-xs">{headerSubtitle}</p>
      </header>

      <ul className="space-y-4">
        {diffs.map((d) => {
          const recordsMatch = d.onlyOnPrimary.length === 0 && d.onlyOnSecondary.length === 0;
          const inSync = d.error === null && d.primarySerial === d.secondarySerial && recordsMatch;
          // Behind only on the weekly SOA-EDIT rollover: expected until the
          // mirror's next SOA refresh, so it's not shown as drift.
          const refreshDue = d.error === null && d.refreshDue && recordsMatch;
          const settled = inSync || refreshDue;
          const tone = d.error
            ? "border-destructive"
            : settled
              ? "border-success"
              : "border-warning-border";
          return (
            <li key={d.server.id} className={`overflow-hidden rounded-md border ${tone}`}>
              <header className="border-border bg-background flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2 text-xs">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link
                    href={`/admin/servers/${d.server.id}`}
                    className="text-primary hover:text-primary-hover font-medium hover:underline"
                  >
                    {d.server.name}
                  </Link>
                  <span className="text-muted-foreground">{d.server.slug}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-3 text-xs">
                  <span>
                    {d.leftLabel}: <code className="font-mono">{d.primarySerial ?? "-"}</code>
                  </span>
                  <span>
                    {d.rightLabel}: <code className="font-mono">{d.secondarySerial ?? "-"}</code>
                  </span>
                  <Badge
                    text={
                      d.error
                        ? "error"
                        : inSync
                          ? "synced"
                          : refreshDue
                            ? "refresh due"
                            : "desynced"
                    }
                    tone={
                      d.error
                        ? "error"
                        : settled
                          ? "success"
                          : d.secondarySerial === null
                            ? "error"
                            : "warn"
                    }
                  />
                </div>
              </header>
              {d.error ? (
                <p className="text-destructive px-4 py-3 text-xs">{d.error}</p>
              ) : settled ? (
                <p className="text-muted-foreground px-4 py-3 text-xs">
                  {refreshDue
                    ? "Records match. The served serial advanced at this week's SOA-EDIT rollover, which PowerDNS doesn't NOTIFY - the secondary picks it up at its next SOA refresh."
                    : d.synopsis}
                  {d.presignedRecords > 0 ? <PresignedNote count={d.presignedRecords} /> : null}
                </p>
              ) : (
                /* Diff framing: BEFORE = what THIS peer/secondary currently
                   has; AFTER = what the anchor/primary has (the target).
                   So records to *remove* (lines only on this peer/secondary)
                   go on the left (red), and records to *add* (lines only
                   on the anchor/primary) go on the right (green). */
                <BareDiff removed={d.onlyOnSecondary} added={d.onlyOnPrimary} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PresignedNote({ count }: { count: number }) {
  return (
    <span className="mt-1 block">
      Signed zone - {count} DNSSEC record{count === 1 ? "" : "s"} (RRSIG, DNSKEY, CDS, NSEC…) held
      presigned on this server and not compared; the primary signs on the fly and doesn&apos;t store
      them.
    </span>
  );
}

function Badge({ text, tone }: { text: string; tone: "success" | "warn" | "error" }) {
  const tint =
    tone === "success"
      ? "bg-background text-success"
      : tone === "warn"
        ? "bg-warning-muted text-warning"
        : "bg-destructive-muted text-destructive";
  return (
    <span
      className={`text-mono-xs inline-flex h-5 items-center rounded-sm px-1.5 font-mono ${tint}`}
    >
      {text}
    </span>
  );
}
