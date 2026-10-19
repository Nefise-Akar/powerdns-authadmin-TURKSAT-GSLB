"use client";

/**
 * components/ui/user-menu.tsx
 *
 * Top-right account menu. The trigger is the avatar - initials only, no
 * photo. The menu shows the signed-in user's name + email, Profile, the docs
 * and source links (with the running version), and Sign out.
 *
 * Implementation notes:
 *   - Hand-rolled `role="menu"` popover following the WAI-ARIA menu button
 *     pattern: the trigger opens it, focus moves to the first item, ↑/↓
 *     wrap between items, Home/End jump, Escape closes and returns focus to
 *     the trigger, Tab or a click outside closes it. Items use a roving
 *     `tabIndex={-1}` so the menu is one Tab stop, not one per item.
 *   - The "avatar" is an SVG-generated monogram derived from email. No
 *     Gravatar - CONTRIBUTING.md bans external image hosts.
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside the container. Escape is handled on the menu
  // itself (below) so it can also hand focus back to the trigger.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const initials = initialsOf(name, email);

  // Focus the first item as soon as the menu is in the DOM.
  useEffect(() => {
    if (open) menuItems()[0]?.focus();
  }, [open]);

  function menuItems(): HTMLElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
  }

  function closeAndRefocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        items[(current + 1) % items.length]?.focus();
        return;
      case "ArrowUp":
        e.preventDefault();
        items[(current - 1 + items.length) % items.length]?.focus();
        return;
      case "Home":
        e.preventDefault();
        items[0]?.focus();
        return;
      case "End":
        e.preventDefault();
        items[items.length - 1]?.focus();
        return;
      case "Escape":
        e.preventDefault();
        closeAndRefocus();
        return;
      case "Tab":
        // Let the browser move on, but don't leave an open menu behind.
        setOpen(false);
        return;
    }
  }

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
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          // ↓ on a closed menu button opens it (and the effect focuses item 1).
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name ?? email}`}
        className="bg-accent text-label text-accent-foreground focus-visible:shadow-focus-ring flex size-8 items-center justify-center rounded-md font-semibold tracking-[0.02em] focus-visible:outline-hidden"
      >
        <span aria-hidden>{initials}</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
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
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={signOut}
              className={MENU_ITEM}
            >
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
      tabIndex={-1}
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
