"use client";

/**
 * components/ui/checkbox.tsx
 *
 * Themed checkbox - the project's replacement for the default browser checkbox.
 * A 16px `role="checkbox"` button with 2px corners: an `input` border when
 * empty, filled with primary + a checkmark when checked. Keyboard-operable
 * (Space/Enter via the native button).
 */

import type { ReactNode } from "react";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  /** Accessible name when there's no visible `label`. */
  ariaLabel?: string;
  className?: string;
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  ariaLabel,
  className,
}: CheckboxProps) {
  return (
    <label
      className={`text-body inline-flex items-center gap-2 ${disabled ? "cursor-default opacity-45" : "cursor-pointer"} ${className ?? ""}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`focus-visible:shadow-focus-ring flex size-4 shrink-0 items-center justify-center rounded-sm border focus-visible:outline-hidden ${
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"
        }`}
      >
        {checked ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M1.5 5l2.5 2.5L8.5 2.5"
              stroke="currentColor"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>
      {label != null ? <span>{label}</span> : null}
    </label>
  );
}
