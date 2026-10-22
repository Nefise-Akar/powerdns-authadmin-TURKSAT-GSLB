import Link from "next/link";
import { tabClass } from "@/components/ui/tabs";

export type ZoneTabKey =
  | "records"
  | "soa"
  | "settings"
  | "dnssec"
  | "metadata"
  | "sync"
  | "statistics"
  | "access"
  | "history";

interface ZoneTabsProps {
  active: ZoneTabKey;
  zoneIdEncoded: string;
  serverSlug: string;
  canReadDnssec: boolean;
  canReadMetadata: boolean;
  /**
   * Gates the SOA tab (`soa.read`). The SOA carries the zone's authority
   * and its transfer timers, so a self-service editor can be given the
   * records without ever being shown it (#119).
   */
  canReadSoa: boolean;
  /**
   * Gates the Zone settings tab - `zone.settings.read`, or `zone.delete`
   * for the Danger Zone that shares the tab. Same reasoning as the SOA
   * tab: record editing must not imply seeing the zone's kind, masters
   * or SOA-EDIT-API.
   */
  showSettings: boolean;
  canReadAudit: boolean;
  /**
   * Gates the Access tab. The tab lists roles + teams + users that
   * can act on this zone - useful "who can touch this?" forensic
   * surface. Gated on `user.read` because the tab reveals user emails
   * and team membership.
   */
  canReadAccess: boolean;
  /**
   * Whether to render the Sync + Statistics tabs. Both depend on the
   * background poller (zone-state cache for Sync, metric_samples for
   * Statistics), so they hide when `PDNS_BACKGROUND_POLLING=false`.
   */
  showPollingFeatures: boolean;
}

export function ZoneTabs({
  active,
  zoneIdEncoded,
  serverSlug,
  canReadDnssec,
  canReadMetadata,
  canReadSoa,
  showSettings,
  canReadAudit,
  canReadAccess,
  showPollingFeatures,
}: ZoneTabsProps) {
  const qs = `server=${encodeURIComponent(serverSlug)}`;
  const detailHref = `/zones/${zoneIdEncoded}?${qs}`;
  const soaHref = `/zones/${zoneIdEncoded}?${qs}&tab=soa`;
  const settingsHref = `/zones/${zoneIdEncoded}?${qs}&tab=settings`;
  const historyHref = `/zones/${zoneIdEncoded}?${qs}&tab=history`;
  // DNSSEC + Metadata are now ?tab= switches on the same route too, so
  // every tab is an instant query-string change with no Next.js route
  // navigation + no shimmer fallback fired.
  const dnssecHref = `/zones/${zoneIdEncoded}?${qs}&tab=dnssec`;
  const metadataHref = `/zones/${zoneIdEncoded}?${qs}&tab=metadata`;
  const statisticsHref = `/zones/${zoneIdEncoded}?${qs}&tab=statistics`;
  const syncHref = `/zones/${zoneIdEncoded}?${qs}&tab=sync`;
  const accessHref = `/zones/${zoneIdEncoded}?${qs}&tab=access`;

  return (
    // Mobile (< sm): tabs wrap to multiple rows so the last one ("Change
    // history" - the widest label) never lives off-screen. From sm+ they
    // collapse back to a single horizontally-scrollable row, matching the
    // dense desktop layout.
    <div className="border-border border-b sm:overflow-x-auto">
      <nav
        aria-label="Zone sections"
        className="flex flex-wrap gap-x-5 sm:w-max sm:flex-nowrap [&>a]:h-10"
      >
        <TabLink href={detailHref} active={active === "records"}>
          Records
        </TabLink>
        {canReadSoa ? (
          <TabLink href={soaHref} active={active === "soa"}>
            SOA
          </TabLink>
        ) : null}
        {showSettings ? (
          <TabLink href={settingsHref} active={active === "settings"}>
            Zone settings
          </TabLink>
        ) : null}
        {canReadDnssec ? (
          <TabLink href={dnssecHref} active={active === "dnssec"}>
            DNSSEC
          </TabLink>
        ) : null}
        {canReadMetadata ? (
          <TabLink href={metadataHref} active={active === "metadata"}>
            Metadata &amp; TSIG
          </TabLink>
        ) : null}
        {showPollingFeatures ? (
          <>
            <TabLink href={syncHref} active={active === "sync"}>
              Sync
            </TabLink>
            <TabLink href={statisticsHref} active={active === "statistics"}>
              Statistics
            </TabLink>
          </>
        ) : null}
        {canReadAccess ? (
          <TabLink href={accessHref} active={active === "access"}>
            Access
          </TabLink>
        ) : null}
        {canReadAudit ? (
          <TabLink href={historyHref} active={active === "history"}>
            Change log
          </TabLink>
        ) : null}
      </nav>
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
      {children}
    </Link>
  );
}
