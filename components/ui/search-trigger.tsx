"use client";

/**
 * components/ui/search-trigger.tsx
 *
 * The header button that opens the global search palette: a search icon, a
 * label naming what it searches and the shortcut hint, styled as the Turksat
 * command bar so it reads as "type here". Centred in the top bar from `md` up
 * and collapses to the icon alone below it.
 *
 * The hint says "Ctrl K" on the server render and switches to "⌘K" after
 * mount on Apple platforms: the platform is only knowable in the browser, and
 * rendering it on the server would mismatch hydration.
 */

import { useEffect, useState, type Ref } from "react";
import { Search } from "lucide-react";
import { Kbd } from "@/components/ui/badge";

function isApplePlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform) || /Mac OS X|iPhone|iPad/.test(nav.userAgent);
}

/** "⌘K" on Apple platforms once mounted, "Ctrl K" everywhere else and on the server. */
export function useShortcutLabel(): string {
  const [apple, setApple] = useState(false);
  useEffect(() => {
    setApple(isApplePlatform());
  }, []);
  return apple ? "⌘K" : "Ctrl K";
}

export function SearchTrigger({
  onOpen,
  expanded,
  ref,
}: {
  onOpen: () => void;
  expanded: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  const shortcut = useShortcutLabel();
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-keyshortcuts="Control+K Meta+K"
      aria-label={`Search (${shortcut})`}
      data-search-trigger=""
      className="text-body text-commandbar-foreground hover:text-foreground focus-visible:shadow-focus-ring md:border-commandbar-border md:bg-commandbar max-md:hover:bg-muted inline-flex size-9 items-center justify-center gap-2 rounded-md focus-visible:outline-hidden md:h-8 md:w-full md:justify-start md:border md:pr-1 md:pl-2.5"
    >
      <Search aria-hidden strokeWidth={1.75} className="size-4 shrink-0" />
      <span className="hidden flex-1 truncate text-left md:inline">
        Search zones, records, settings…
      </span>
      <span className="hidden md:inline-flex">
        <Kbd surface="muted">{shortcut}</Kbd>
      </span>
    </button>
  );
}
