/**
 * app/(app)/layout.tsx
 *
 * Chrome for every authenticated route: the navigation rail, the top bar
 * (brand, health bell, theme toggle, settings, account menu) and the status
 * bar - see components/ui/app-shell.tsx for the layout. Runs
 * `requireUser()` at the top - when there's no session, it redirects to
 * /login rather than throwing 401 (better UX than a JSON error for a browser).
 *
 * Per-page authorization (e.g. "only Admins can see /admin") happens in the
 * page server components, not here.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings } from "lucide-react";
import { APP_DOCS_URL, APP_SOURCE_URL, APP_VERSION_LABEL } from "@/lib/app-meta";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { checkMfaCompliance } from "@/lib/auth/mfa-compliance";
import { listRoleMfaStatesForUser } from "@/lib/db/repositories/roles";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { UserMenu } from "@/components/ui/user-menu";
import { HealthBell } from "@/components/domain/health-bell";
import { GlobalSearch } from "@/components/domain/global-search";
import { buildSearchQuickLinks, searchTabsFor } from "@/lib/search/quick-links";
import { warmSearchIndex } from "@/lib/search/search-index";
import { hasNotificationAudience, loadNotificationsFor } from "@/lib/health/load-notifications";
import { bellPreview, summarizeNotifications } from "@/lib/health/notifications";
import { BrandMark } from "@/components/ui/brandmark";
import { AppShell, type NavGroup, type NavItem } from "@/components/ui/app-shell";
import { iconButtonClass } from "@/components/ui/button";
import { DialogProvider } from "@/components/ui/dialog";
import { FlashListener } from "@/components/ui/flash-listener";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { HeaderStatusProvider } from "@/components/realtime/header-status-chip";
import { ComplianceGuardProvider } from "@/components/auth/compliance-guard";
import { getAppSettings } from "@/lib/settings/app-settings";
import { ensureBackendsObserved } from "@/lib/realtime/zone-poller";
import { globalAnyLagging, hasReplicationTopology } from "@/lib/pdns/sync";
import { decideHeaderChipMode } from "@/lib/realtime/header-chip-mode";
import { optionalFeatures, pdnsBackgroundPollingEnabled } from "@/lib/env";
import {
  ensureZoneMonitorRunning,
  reverseDnsBadge,
  zoneMonitorBadge,
} from "@/lib/monitoring/zone-monitor";
import { navAccessOf } from "@/lib/rbac/nav-access";
import { plural } from "@/lib/text/plural";

/**
 * Paths a non-compliant user (forced-MFA-not-enrolled, or flagged
 * `mustChangePassword`) is still allowed to visit so they can self-remediate.
 * Anything else triggers a redirect to /profile. Match by prefix to cover
 * sub-routes and the self-service API surface (enroll TOTP / change password /
 * log out).
 */
const COMPLIANCE_ALLOWLIST: readonly string[] = [
  "/profile",
  "/api/profile/mfa",
  "/api/auth/change-password",
  "/api/auth/logout",
];

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const current = await getCurrentUser();
  if (!current) {
    // Remember where they were headed so login can shunt them straight there
    // (L-2). The middleware forwards the pathname via `x-pathname`.
    const attempted = (await headers()).get("x-pathname");
    const next = attempted && attempted !== "/" ? `?next=${encodeURIComponent(attempted)}` : "";
    redirect(`/login${next}`);
  }

  // Required-MFA-per-role enforcement. When any of the
  // user's assigned roles is marked `requiresMfa` and the user
  // hasn't enrolled TOTP yet, shunt them to /profile so they can
  // enroll. The allowlist keeps /profile + the MFA-related API
  // surface reachable - without it the operator would be in a
  // deadlock.
  //
  // SSO-only users (no local password hash) are exempt: their IdP
  // is the second-factor authority. Adding a second TOTP gate on
  // top would be a TOTP-after-TOTP user-experience papercut without
  // increasing security - the IdP is already the trust root for
  // this account.
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "/";
  const allowed = COMPLIANCE_ALLOWLIST.some((p) => pathname.startsWith(p));

  const userRoles = await listRoleMfaStatesForUser(current.user.id);
  const compliance = checkMfaCompliance(
    {
      totpEnrolled: current.user.totpSecretEncrypted !== null,
      webauthnEnrolled: current.user.webauthnCredentials.length > 0,
      ssoOnly: current.user.passwordHash === null,
      // Per-user override (admin user-detail page) supersedes roles + SSO.
      mfaOverride: current.user.mfaRequired,
    },
    userRoles,
  );
  if (!compliance.compliant && !allowed) {
    const because = encodeURIComponent(compliance.requiringRoleSlugs.join(","));
    redirect(`/profile?mfa-required=1&because=${because}`);
  }

  // A temp/expired password must be rotated before the operator can use the
  // app. Mirrors the route-handler gate in `requireUser` (which throws);
  // the page path redirects to /profile for a friendlier prompt.
  if (current.user.mustChangePassword && !allowed) {
    redirect(`/profile?must-change-password=1`);
  }

  const appSettings = await getAppSettings();

  // Each flag mirrors the guard of the page it links to (`navAccessOf`), so a
  // menu item never leads to a refusal. A type-level `ability.can(...)` would
  // be true for any scoped rule and offer pages that only admit global grants.
  const navAccess = navAccessOf({
    globalPermissions: current.globalPermissions,
    zoneGrants: current.zoneGrants,
    zoneScopedPermissions: current.zoneScopedPermissions,
    canReadAnyTeam: current.ability.can("read", "Team"),
    features: optionalFeatures,
  });
  const canReadZones = navAccess.zones;
  const canReadServers = navAccess.servers;
  const canReadTsig = navAccess.tsigKeys;
  const canManageAutoprimary = navAccess.autoprimaries;
  const canReadUsers = navAccess.users;
  const canReadRoles = navAccess.roles;
  const canReadTeams = navAccess.teams;
  const canReadAudit = navAccess.audit;
  const canReadSettings = navAccess.settings;
  const canReadAuth = navAccess.authentication;
  const canUseTemplates = navAccess.zoneTemplates;
  const canManageGslb = navAccess.gslb;

  // Zone monitoring runs in the background from the first authenticated render.
  ensureZoneMonitorRunning();
  // Build the search index in the background so the first Ctrl/Cmd K is instant.
  warmSearchIndex();

  // Notifications (ADR-0015): backend health and zone monitoring, filtered per
  // row to what this user may see (a zone finding needs zone.read on its zone).
  // Only the preview and the counts reach the client; the full list lives on
  // /notifications.
  const showBell = hasNotificationAudience(current);
  const notifications = showBell ? await loadNotificationsFor(current) : [];
  const bellSummary = summarizeNotifications(notifications);
  const bellItems = bellPreview(notifications);

  // One rail entry per area; an area's pages show as tabs above the page. An
  // entry renders only when the user can see at least one of its pages.
  // Settings lives behind the top bar's gear and Profile in the account menu.
  const powerdnsItems: NavItem[] = [
    ...(canReadServers ? [{ href: "/admin/servers", label: "Servers" }] : []),
    ...(canReadServers ? [{ href: "/admin/clusters", label: "Clusters" }] : []),
    ...(canManageAutoprimary ? [{ href: "/admin/autoprimaries", label: "Autoprimaries" }] : []),
    ...(canUseTemplates ? [{ href: "/admin/zone-templates", label: "Zone templates" }] : []),
    ...(navAccess.importExport ? [{ href: "/admin/import-export", label: "Import / Export" }] : []),
    ...(canReadTsig ? [{ href: "/admin/tsig-keys", label: "TSIG keys" }] : []),
    ...(canManageGslb ? [{ href: "/admin/gslb", label: "GSLB" }] : []),
    ...(navAccess.requestLog ? [{ href: "/admin/requests", label: "Request log" }] : []),
  ];
  const accessItems: NavItem[] = [
    ...(canReadUsers ? [{ href: "/admin/users", label: "Users" }] : []),
    ...(canReadTeams ? [{ href: "/admin/teams", label: "Teams" }] : []),
    ...(canReadRoles ? [{ href: "/admin/roles", label: "Roles" }] : []),
    ...(canReadAuth ? [{ href: "/admin/authentication", label: "Authentication" }] : []),
  ];
  // Reverse DNS and Zone Monitoring sit beside the zone list as tabs of the
  // Zones area, each with the count of things needing attention behind it.
  const reverseBadge = navAccess.reverseDns ? reverseDnsBadge() : 0;
  const monitorBadge = navAccess.zoneMonitoring
    ? zoneMonitorBadge()
    : { problems: 0, tone: "warn" as const };
  const zonesItems: NavItem[] = [
    ...(canReadZones ? [{ href: "/zones", label: "Zones" }] : []),
    ...(navAccess.reverseDns
      ? [
          {
            href: "/zones/auto-ptr",
            label: "Reverse DNS",
            badge: {
              count: reverseBadge,
              tone: "warn" as const,
              label: `${plural(reverseBadge, "address")} with reverse DNS problems`,
            },
          },
        ]
      : []),
    ...(navAccess.zoneMonitoring
      ? [
          {
            href: "/zones/monitoring",
            label: "Zone Monitoring",
            badge: {
              count: monitorBadge.problems,
              tone: monitorBadge.tone,
              label: `${plural(monitorBadge.problems, "zone")} with findings`,
            },
          },
        ]
      : []),
  ];
  // The three logs (Audit, Change, Request) are global audit.read pages; the
  // Request log stays with the PowerDNS pages it records.
  const logItems: NavItem[] = [
    ...(canReadAudit ? [{ href: "/admin/audit", label: "Audit log" }] : []),
    ...(navAccess.changeLog ? [{ href: "/admin/changes", label: "Change log" }] : []),
  ];
  const nav: NavGroup[] = [
    { key: "dashboard", label: "Dashboard", items: [{ href: "/dashboard", label: "Dashboard" }] },
  ];
  if (zonesItems.length) nav.push({ key: "zones", label: "Zones", items: zonesItems });
  if (powerdnsItems.length) nav.push({ key: "powerdns", label: "PowerDNS", items: powerdnsItems });
  if (accessItems.length) nav.push({ key: "access", label: "Access", items: accessItems });
  if (logItems.length) nav.push({ key: "audit", label: "Logs", items: logItems });

  const mark = (
    <Link
      href="/dashboard"
      aria-label={`${appSettings.siteName} home`}
      className="focus-visible:shadow-focus-ring flex size-8 items-center justify-center rounded-md focus-visible:outline-hidden"
    >
      {/* The `{}` mark (also the favicon), or the operator's own logo. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={appSettings.brandLogoUrl ?? "/icon.svg"}
        alt=""
        referrerPolicy="no-referrer"
        className="max-h-8 max-w-8 object-contain"
      />
    </Link>
  );

  const brand = (
    <Link
      href="/dashboard"
      aria-label={`${appSettings.siteName} home`}
      className="focus-visible:shadow-focus-ring flex min-w-0 items-center rounded-md focus-visible:outline-hidden"
    >
      <BrandMark
        siteName={appSettings.siteName}
        brandLogoUrl={appSettings.brandLogoUrl}
        width={184}
        maxHeight={22}
      />
    </Link>
  );

  const headerSearch = (
    <GlobalSearch
      visibility={searchTabsFor(current)}
      quickLinks={buildSearchQuickLinks(current, optionalFeatures)}
    />
  );
  const headerControls = (
    <>
      {showBell ? <HealthBell preview={bellItems} summary={bellSummary} /> : null}
      <ThemeToggle />
      {canReadSettings ? (
        <Link href="/admin/settings" aria-label="Settings" className={iconButtonClass("lg")}>
          <Settings aria-hidden strokeWidth={1.75} />
        </Link>
      ) : null}
      <span aria-hidden className="bg-border mx-1 h-6 w-px" />
      <UserMenu
        email={current.user.email}
        name={current.user.name}
        version={APP_VERSION_LABEL}
        docsUrl={APP_DOCS_URL}
        sourceUrl={APP_SOURCE_URL}
      />
    </>
  );

  // A user stuck on the must-change-password / MFA-enrolment screen can't reach
  // /api/realtime (requireUser rejects them with 403). Skipping RealtimeProvider
  // here avoids the stuck-on-CONNECTING chip + the wasted reconnect storm; the
  // chip self-hides when no provider is mounted.
  const realtimeAvailable = compliance.compliant && !current.user.mustChangePassword;

  // Fleet-wide sync verdict as the chip's default mode. Pages that show
  // their own (per-zone or per-page) sync state push it via
  // <HeaderStatusMode/> and override this. Computed only when realtime is
  // available + the operator can see backend state at all - otherwise the
  // chip falls back to plain "Live" so a profile-only user doesn't see a
  // signal they have no context for. The helper reads exclusively from the
  // poller's in-process caches, so this is a near-free lookup once the
  // first ensureBackendsObserved warms the store.
  // Sync-mode chip default. Pages that show their own per-zone or per-page
  // sync state override this via <HeaderStatusMode/>. The decision is a pure
  // function (`decideHeaderChipMode`) - unit-tested in isolation; the awaits
  // here are I/O bridges feeding it.
  const canReadBackends = canReadZones || canReadServers;
  const showGlobalSync = pdnsBackgroundPollingEnabled && realtimeAvailable && canReadBackends;
  let topology = false;
  let lagging = false;
  if (showGlobalSync) {
    await ensureBackendsObserved();
    topology = await hasReplicationTopology();
    if (topology) lagging = await globalAnyLagging();
  }
  const initialChipMode = decideHeaderChipMode({
    pollingEnabled: pdnsBackgroundPollingEnabled,
    realtimeAvailable,
    canReadBackends,
    hasReplicationTopology: topology,
    anyLagging: lagging,
  });

  const shell = (
    <AppShell
      nav={nav}
      mark={mark}
      brand={brand}
      headerCenter={headerSearch}
      headerControls={headerControls}
    >
      {children}
    </AppShell>
  );

  return (
    <DialogProvider>
      <ComplianceGuardProvider
        mfaRequired={!compliance.compliant}
        passwordChangeRequired={current.user.mustChangePassword}
      >
        {realtimeAvailable ? (
          <RealtimeProvider>
            <HeaderStatusProvider initialMode={initialChipMode}>
              <FlashListener />
              {shell}
            </HeaderStatusProvider>
          </RealtimeProvider>
        ) : (
          <>
            <FlashListener />
            {shell}
          </>
        )}
      </ComplianceGuardProvider>
    </DialogProvider>
  );
}
