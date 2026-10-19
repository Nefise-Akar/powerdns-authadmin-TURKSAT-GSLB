"use client";

/**
 * components/ui/app-shell.tsx
 *
 * Chrome for the authenticated app, per the Turksat shell:
 *
 *   ┌──────┬──────────────────────────────────────────────┐
 *   │ rail │ top bar 56 · brand · actions                 │
 *   │ 72   ├──────────────────────────────────────────────┤
 *   │      │ section tabs 40 (groups with several pages)  │
 *   │      │ page                                         │
 *   │      ├──────────────────────────────────────────────┤
 *   │      │ status bar 28                                │
 *   └──────┴──────────────────────────────────────────────┘
 *
 * The rail lists one entry per area; an area with several pages (PowerDNS,
 * Access) gets a tab strip above the page so its pages stay one click apart.
 * Below `md` the rail is hidden and the same navigation opens as an
 * off-canvas drawer from the top bar's menu button.
 *
 * The server layout owns auth and builds the RBAC-filtered `nav` (plain data,
 * so it crosses the server/client boundary); this component only resolves
 * the active entry from the pathname and manages the drawer.
 *
 * Drawer accessibility: while closed the drawer is `inert` and `aria-hidden`
 * - a translated-off-screen panel is otherwise still in the tab order and
 * the accessibility tree, so a phone user would tab through every invisible
 * link before reaching the page. Opening moves focus to the first nav link;
 * closing hands it back to the menu button.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  House,
  LayoutGrid,
  Menu,
  Server,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { HeaderStatusChip } from "@/components/realtime/header-status-chip";
import { iconButtonClass } from "@/components/ui/button";
import { tabClass, tabListClass } from "@/components/ui/tabs";

export type NavGroupKey = "dashboard" | "zones" | "powerdns" | "access" | "audit";

export interface NavItem {
  href: string;
  label: string;
}

export interface NavGroup {
  key: NavGroupKey;
  label: string;
  /** First item is where the rail entry links to. */
  items: NavItem[];
}

const ICONS: Record<NavGroupKey, LucideIcon> = {
  dashboard: House,
  zones: LayoutGrid,
  powerdns: Server,
  access: ShieldCheck,
  audit: FileText,
};

/** `/dashboard` matches exactly; everything else also matches deeper segments. */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const MAIN_CONTENT_ID = "main-content";

export function AppShell({
  nav,
  mark,
  brand,
  headerControls,
  children,
}: {
  nav: NavGroup[];
  /** Square logo for the rail's 56px logo cell (links home). */
  mark: ReactNode;
  /** Wordmark for the top bar's brand block (links home). */
  brand: ReactNode;
  headerControls: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const activeGroup = nav.find((g) => g.items.some((i) => isActivePath(pathname, i.href)));
  const drawerRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Close the drawer after navigating (tapping a nav link changes the route).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc closes the drawer; only matters while it's open on mobile.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus follows the drawer: into the first link on open, back to the
  // hamburger on close (including closes triggered by navigation and Esc).
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      drawerRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      hamburgerRef.current?.focus();
    }
  }, [open]);

  return (
    <div className="bg-background flex h-dvh overflow-hidden">
      {/* Skip link - the first tab stop on every page; visible only while
          focused so sighted mouse users never see it. */}
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="bg-primary text-body-strong text-primary-foreground focus-visible:shadow-focus-ring sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <nav
        aria-label="Main navigation"
        className="border-border bg-rail hidden w-18 shrink-0 flex-col border-r md:flex"
      >
        <div className="flex h-14 shrink-0 items-center justify-center">{mark}</div>
        <ul className="flex flex-col gap-0.5 px-1 py-2">
          {nav.map((group) => (
            <li key={group.key}>
              <RailLink group={group} active={group === activeGroup} />
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile drawer: backdrop + panel, both off-screen unless open. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-30 bg-black/50 transition-opacity duration-200 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <nav
        ref={drawerRef}
        aria-label="Main navigation"
        inert={!open || undefined}
        aria-hidden={!open || undefined}
        className={`border-border bg-rail fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r transition-transform duration-200 md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-border flex h-14 shrink-0 items-center justify-between border-b pr-4 pl-5">
          {brand}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className={iconButtonClass("lg")}
          >
            <X aria-hidden strokeWidth={2} />
          </button>
        </div>
        <DrawerNav nav={nav} pathname={pathname} />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-card flex h-14 shrink-0 items-center gap-4 border-b pr-4 pl-5">
          <button
            ref={hamburgerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            className={`${iconButtonClass("lg")} -ml-2 md:hidden`}
          >
            <Menu aria-hidden strokeWidth={1.75} />
          </button>
          {/* The wordmark is unreadable once squeezed below `sm`; phones get
              the square mark instead. */}
          <div className="flex sm:hidden">{mark}</div>
          <div className="hidden w-46 min-w-0 items-center sm:flex">{brand}</div>
          <div className="ml-auto flex items-center gap-1">{headerControls}</div>
        </header>

        {/* `min-h-0` is the canonical flexbox-clipping fix: a `flex-1` child
            without it can grow beyond its parent's height when its content
            is taller, defeating `overflow-y-auto` and leaking a second
            outer scroll region.

            `relative` makes this the containing block for absolutely-positioned
            descendants - notably Tailwind `sr-only` spans, which are
            `position: absolute`. `overflow-y-auto` alone does NOT establish a
            containing block, so without `relative` those spans escape the scroll
            region and anchor to the document at their full-content-height static
            position, stretching <html> past the viewport. That re-introduced the
            exact "scroll-in-scroll, black at the bottom" bug on the zones list at
            high row counts even with `min-h-0` already in place (each row's
            screen-reader label is one such span; 50 of them push the document to
            ~2000px tall behind a correctly-sized 100dvh shell).

            `tabIndex={-1}` lets the skip link land focus here without adding the
            region to the Tab order; `outline-none` because that programmatic
            focus shouldn't draw a ring around the whole page. */}
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="bg-card relative min-h-0 flex-1 overflow-y-auto outline-none"
        >
          {activeGroup && activeGroup.items.length > 1 ? (
            <SectionTabs group={activeGroup} pathname={pathname} />
          ) : null}
          <div className="px-5 pt-6 pb-8">{children}</div>
        </main>

        <footer className="border-border bg-background text-caption text-muted-foreground flex h-7 shrink-0 items-center gap-4 border-t pr-4 pl-5">
          <div className="ml-auto flex items-center">
            {/* Single SSE status for the whole app - its label is driven per
                page via <HeaderStatusMode/> in components that own a "synced"
                notion. */}
            <HeaderStatusChip />
          </div>
        </footer>
      </div>
    </div>
  );
}

function RailLink({ group, active }: { group: NavGroup; active: boolean }) {
  const Icon = ICONS[group.key];
  const href = group.items[0]?.href ?? "/dashboard";
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="group focus-visible:shadow-focus-ring flex flex-col items-center gap-1 rounded-md px-0.5 py-1.5 text-center focus-visible:outline-hidden"
    >
      <span
        className={`flex h-6 w-9 items-center justify-center rounded-md ${
          active
            ? "bg-rail-active text-rail-active-foreground"
            : "text-rail-foreground group-hover:bg-muted group-hover:text-foreground"
        }`}
      >
        <Icon aria-hidden size={20} strokeWidth={1.75} />
      </span>
      <span
        className={`text-rail-label ${
          active ? "text-rail-foreground-active font-semibold" : "text-rail-foreground"
        }`}
      >
        {group.label}
      </span>
    </Link>
  );
}

function SectionTabs({ group, pathname }: { group: NavGroup; pathname: string | null }) {
  return (
    <nav aria-label={`${group.label} pages`} className={`${tabListClass} px-5`}>
      {group.items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={tabClass(active)}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function DrawerNav({ nav, pathname }: { nav: NavGroup[]; pathname: string | null }) {
  return (
    <ul className="flex-1 overflow-y-auto px-3 py-3">
      {nav.map((group) => {
        const Icon = ICONS[group.key];
        const single = group.items.length === 1;
        return (
          <li key={group.key} className="pb-3">
            {single ? (
              <DrawerLink item={group.items[0]!} pathname={pathname} icon={<Icon />} />
            ) : (
              <>
                <div className="text-label text-muted-foreground flex h-8 items-center gap-2 px-2">
                  <Icon aria-hidden size={16} strokeWidth={1.75} />
                  {group.label}
                </div>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <DrawerLink item={item} pathname={pathname} indent />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DrawerLink({
  item,
  pathname,
  icon,
  indent = false,
}: {
  item: NavItem;
  pathname: string | null;
  icon?: ReactNode;
  indent?: boolean;
}) {
  const active = isActivePath(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`focus-visible:shadow-focus-ring flex h-8 items-center gap-2 rounded-md px-2 focus-visible:outline-hidden [&_svg]:size-4 [&_svg]:stroke-[1.75] ${
        indent ? "pl-8" : ""
      } ${
        active
          ? "bg-rail-active text-body-strong text-rail-active-foreground"
          : "text-body-medium text-foreground hover:bg-muted"
      }`}
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      {item.label}
    </Link>
  );
}
