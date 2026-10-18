/**
 * components/ui/button.tsx
 *
 * The app's button styles, per the Turksat design system:
 *
 *   primary      - the single main action on a screen ("Add zone"). Only one
 *                  per screen; everything else is secondary/ghost.
 *   secondary    - card surface with an `input` border (a meaning-bearing
 *                  edge, so not the decorative `border` token).
 *   ghost        - no surface until hover.
 *   destructive  - deletes; filled, like primary.
 *   link         - inline text action ("Clear filters").
 *
 * Sizes: md 32px (default), sm 28px, xs 24px (link only). Hover never uses
 * `accent` - that token is reserved for selection.
 *
 * While an action runs, disable the button and keep its label: the label says
 * what the button does, not what is happening.
 *
 * `buttonClass()` is exported for links and other elements that must look
 * like a button.
 */

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "link";
export type ButtonSize = "md" | "sm" | "xs";

const BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border tabular-nums focus-visible:shadow-focus-ring focus-visible:outline-hidden disabled:cursor-default disabled:opacity-45 aria-disabled:cursor-default aria-disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover disabled:hover:border-primary disabled:hover:bg-primary",
  secondary:
    "border-input bg-secondary text-secondary-foreground hover:bg-muted disabled:hover:bg-secondary",
  ghost:
    "border-transparent bg-transparent text-foreground hover:bg-muted disabled:hover:bg-transparent",
  destructive: "border-destructive bg-destructive text-destructive-foreground",
  link: "border-transparent bg-transparent text-primary hover:text-primary-hover hover:underline",
};

const HEIGHT: Record<ButtonSize, string> = { md: "h-8", sm: "h-7", xs: "h-6" };
const PADDING: Record<ButtonSize, string> = { md: "px-3", sm: "px-2", xs: "px-2" };

/** One type style per button - there's no class merging, so never emit two. */
function typeStyle(variant: ButtonVariant, size: ButtonSize): string {
  if (variant === "link" || size !== "md") return "text-body-sm";
  return variant === "primary" || variant === "destructive"
    ? "text-body-strong"
    : "text-body-medium";
}

export function buttonClass({
  variant = "secondary",
  size = "md",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  const padding = variant === "link" ? "" : PADDING[size];
  return `${BASE} ${VARIANT[variant]} ${HEIGHT[size]} ${padding} ${typeStyle(variant, size)} ${className}`
    .replace(/\s+/g, " ")
    .trim();
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClass({ variant, size, className })} {...rest}>
      {children}
    </button>
  );
}

/**
 * Square, icon-only ghost button: 36px in the top bar (lg), 28px in panel
 * headers and pagination (sm), 20px for removing a chip (xs). Always pass an
 * `aria-label` - the icon is `aria-hidden` and carries no meaning alone.
 */
export type IconButtonSize = "lg" | "sm" | "xs";

const ICON_SIZE: Record<IconButtonSize, string> = {
  lg: "size-9 [&_svg]:size-5",
  sm: "size-7 [&_svg]:size-4",
  xs: "size-5 rounded-sm [&_svg]:size-3",
};

export function iconButtonClass(size: IconButtonSize = "sm", className = ""): string {
  return `inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:shadow-focus-ring focus-visible:outline-hidden disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent ${ICON_SIZE[size]} ${className}`.trim();
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  "aria-label": string;
}

export function IconButton({
  size = "sm",
  className = "",
  type = "button",
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button type={type} className={iconButtonClass(size, className)} {...rest}>
      {children}
    </button>
  );
}
