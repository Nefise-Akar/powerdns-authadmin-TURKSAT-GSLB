/**
 * components/ui/tabs.tsx
 *
 * Tab styling, per the Turksat design system: a 40px strip with a bottom
 * border; inactive tabs in muted body-medium, the current one in
 * body-strong with the 2px primary `tab-indicator` underline. A count, when
 * shown, is a CountBadge after the label ("All 10").
 *
 * Style-only helpers: each tab strip in the app keeps its own element
 * (links for navigation, buttons for filters) and its own behavior.
 */

/** A row of tabs without the bottom border - for strips sharing one container. */
export const tabStripClass = "flex h-10 items-stretch gap-5 overflow-x-auto overflow-y-hidden";

/** The strip: one row that scrolls sideways rather than wrapping. */
export const tabListClass = `${tabStripClass} border-b border-border`;

export function tabClass(active: boolean): string {
  return `flex shrink-0 items-center gap-1.5 whitespace-nowrap focus-visible:shadow-focus-ring focus-visible:outline-hidden ${
    active
      ? "text-body-strong text-foreground shadow-tab-indicator"
      : "text-body-medium text-muted-foreground hover:text-foreground"
  }`;
}
