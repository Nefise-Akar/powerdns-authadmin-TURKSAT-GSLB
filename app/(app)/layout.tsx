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
import { listActiveAdvisories } from "@/lib/db/repositories/backend-advisories";
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
import { pdnsBackgroundPollingEnabled } from "@/lib/env";

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

  const canReadZones = current.ability.can("read", "Zone");
  const canReadServers = current.ability.can("read", "Server");
  const canReadTsig = current.ability.can("read", "Tsig");
  const canManageAutoprimary = current.ability.can("manage", "Autoprimary");
  const canReadUsers = current.ability.can("read", "User");
  const canReadRoles = current.ability.can("read", "Role");
  const canReadTeams = current.ability.can("read", "Team");
  const canReadAudit = current.ability.can("read", "Audit");
  const canReadSettings = current.ability.can("read", "Settings");
  const canReadAuth = current.ability.can("read", "Auth");
  const canUseTemplates = current.ability.can("use", "Template");
  // Global grant only, matching the page/route gate: a scoped `gslb.manage`
  // would pass a type-level CASL check yet still be refused by the page.
  const canManageGslb = current.globalPermissions.has("gslb.manage");

  // Health-bell advisories (ADR-0015) - only for users who can read backends.
  const advisories = canReadServers
    ? (await listActiveAdvisories()).map((a) => ({
        id: a.id,
        backendId: a.backendId,
        backendName: a.backendName,
        severity: a.severity,
        title: a.title,
        detail: a.detail,
        acknowledged: a.acknowledgedAt !== null,
      }))
    : [];

  // One rail entry per area; an area's pages show as tabs above the page. An
  // entry renders only when the user can see at least one of its pages.
  // Settings lives behind the top bar's gear and Profile in the account menu.
  const powerdnsItems: NavItem[] = [
    ...(canReadServers ? [{ href: "/admin/servers", label: "Servers" }] : []),
    ...(canReadServers ? [{ href: "/admin/clusters", label: "Clusters" }] : []),
    ...(canManageAutoprimary ? [{ href: "/admin/autoprimaries", label: "Autoprimaries" }] : []),
    ...(canUseTemplates ? [{ href: "/admin/zone-templates", label: "Zone templates" }] : []),
    ...(canReadZones ? [{ href: "/admin/import-export", label: "Import / Export" }] : []),
    ...(canReadTsig ? [{ href: "/admin/tsig-keys", label: "TSIG keys" }] : []),
    ...(canManageGslb ? [{ href: "/admin/gslb", label: "GSLB" }] : []),
    ...(canReadAudit ? [{ href: "/admin/requests", label: "Request log" }] : []),
  ];
  const accessItems: NavItem[] = [
    ...(canReadUsers ? [{ href: "/admin/users", label: "Users" }] : []),
    ...(canReadTeams ? [{ href: "/admin/teams", label: "Teams" }] : []),
    ...(canReadRoles ? [{ href: "/admin/roles", label: "Roles" }] : []),
    ...(canReadAuth ? [{ href: "/admin/authentication", label: "Authentication" }] : []),
  ];
  const nav: NavGroup[] = [
    { key: "dashboard", label: "Dashboard", items: [{ href: "/dashboard", label: "Dashboard" }] },
  ];
  if (canReadZones) {
    nav.push({ key: "zones", label: "Zones", items: [{ href: "/zones", label: "Zones" }] });
  }
  if (powerdnsItems.length) nav.push({ key: "powerdns", label: "PowerDNS", items: powerdnsItems });
  if (accessItems.length) nav.push({ key: "access", label: "Access", items: accessItems });
  if (canReadAudit) {
    nav.push({
      key: "audit",
      label: "Audit log",
      items: [{ href: "/admin/audit", label: "Audit log" }],
    });
  }

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

  const headerControls = (
    <>
      {canReadServers ? <HealthBell advisories={advisories} /> : null}
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
    <AppShell nav={nav} mark={mark} brand={brand} headerControls={headerControls}>
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
