import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

/**
 * components/ui/create-button.tsx
 *
 * Primary "create / add" call-to-action with a leading plus icon - the one
 * primary button on its page. Full-width on mobile, auto-width on `sm+` -
 * pairs with the stacked page headers so the CTA reads as a clear
 * full-width button on a phone.
 *
 * `createCtaClass` is exported for the handful of CTAs that are <button>s
 * (e.g. "Add record", which opens a dialog) rather than links.
 */
export const createCtaClass = buttonClass({ variant: "primary", className: "w-full sm:w-auto" });

export function CreateButton({
  href,
  label,
  className = "",
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link href={href} className={`${createCtaClass} ${className}`}>
      <Plus aria-hidden strokeWidth={2} />
      {label}
    </Link>
  );
}
