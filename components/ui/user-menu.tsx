"use client";

/**
 * components/ui/user-menu.tsx
 *
 * Top-right account menu. The trigger is the avatar - initials only, no
 * photo. The menu shows the signed-in user's name + email, Profile, the docs
 * and source links (with the running version), and Sign out.
 *
 * Implementation notes:
 *   - Hand-rolled popover with click-outside + Escape-to-close. future work will
 *     swap in shadcn/Radix primitives across the UI; this component is a
 *     placeholder that's behaviorally complete (focus management aside) and
 *     will be migrated then.
 *   - The "avatar" is an SVG-generated monogram derived from email. No
 *     Gravatar - CONTRIBUTING.md bans external image hosts.
 */

import { useEffect, useRef, useState } from "react";
import { BookText, GitBranch, LogOut, User as UserIcon } from "lucide-react";
import { apiFetch } from "@/lib/client/api-fetch";

interface UserMenuProps {
  email: string;
  name: string | null;
  version: string;
  docsUrl: string;
  sourceUrl: string;
}

/** Up to two initials from the name ("Bootstrap Admin" → "BA"), else the email's first letter. */
function initialsOf(name: string | null, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words.length ? words.slice(0, 2).map((w) => w[0]) : [email[0] ?? "?"];
  return letters.join("").toUpperCase();
}

export function UserMenu({ email, name, version, docsUrl, sourceUrl }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on Escape and on click outside the container. One effect handles
  // both; both event types remove themselves on cleanup.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = initialsOf(name, email);

  // Sign-out is a state-changing POST. `apiFetch` adds the CSRF header
  // so `requireCsrf` on /api/auth/logout accepts it. The server replies
  // with JSON `{ ok, location }` - `location` is either the IdP's
  // RP-initiated-logout URL (for OIDC sessions) or the local
  // /login?signed-out=1 fallback. We navigate via `window.location.replace`
  // rather than letting fetch follow a 303 redirect: a cross-origin
  // redirect to the IdP's domain would be blocked by our
  // `connect-src 'self'` CSP, but a top-level navigation is exempt.
  //
  // This is the same flow certifi uses (see certifi/web/src/auth.tsx).
  async function signOut() {
    let target = "/login?signed-out=1";
    try {
      const res = await apiFetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { location?: string } | null;
        if (data && typeof data.location === "string" && data.location.length > 0) {
          target = data.location;
        }
      }
    } catch {
      // Network failure - fall through to the local redirect.
    }
    window.location.replace(target);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu: ${initials}`}
        className="bg-accent text-label text-accent-foreground focus-visible:shadow-focus-ring flex size-8 items-center justify-center rounded-md font-semibold tracking-[0.02em] focus-visible:outline-hidden"
      >
        <span aria-hidden>{initials}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="border-border bg-popover text-popover-foreground absolute right-0 z-50 mt-1 w-64 rounded-md border"
        >
          <div className="border-border border-b px-3 py-2">
            <div className="text-body-strong">{name ?? "Signed in"}</div>
            <div className="text-meta text-muted-foreground truncate" title={email}>
              {email}
            </div>
          </div>
          <div className="py-1">
            <MenuLink href="/profile" icon={<UserIcon />}>
              Profile
            </MenuLink>
            <MenuLink href={docsUrl} icon={<BookText />} external>
              Documentation
            </MenuLink>
            <MenuLink href={sourceUrl} icon={<GitBranch />} external>
              Source code
              <span className="text-mono-sm text-muted-foreground ml-auto font-mono tabular-nums">
                v{version}
              </span>
            </MenuLink>
          </div>
          <div className="border-border border-t py-1">
            <button type="button" role="menuitem" onClick={signOut} className={MENU_ITEM}>
              <LogOut aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const MENU_ITEM =
  "flex h-8 w-full items-center gap-2 px-3 text-left text-body text-foreground hover:bg-background focus-visible:shadow-focus-ring focus-visible:outline-hidden [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75] [&_svg]:text-muted-foreground";

function MenuLink({
  href,
  icon,
  children,
  external = false,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      role="menuitem"
      className={MENU_ITEM}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      <span aria-hidden className="contents">
        {icon}
      </span>
      {children}
      {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </a>
  );
}
