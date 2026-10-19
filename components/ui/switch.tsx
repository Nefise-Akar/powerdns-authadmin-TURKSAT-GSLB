"use client";

/**
 * components/ui/switch.tsx
 *
 * Themed on/off toggle (`role="switch"`) - the project's standard boolean
 * control. Pair it with a separate text label/state span at the call site.
 *
 * The design system has no switch, so this one is assembled from its rules:
 * checkbox colors (input border off, primary fill on), square-ish corners
 * (no pill shapes), no elevation shadow on the thumb.
 */

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when there's no associated visible label. */
  ariaLabel?: string;
  /** Lets a `Field` caption point its `<label htmlFor>` at the switch. */
  id?: string;
  "aria-describedby"?: string;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
  id,
  "aria-describedby": ariaDescribedBy,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      aria-describedby={ariaDescribedBy}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`focus-visible:shadow-focus-ring inline-flex h-5 w-9 shrink-0 items-center rounded-md border transition-colors focus-visible:outline-hidden disabled:cursor-default disabled:opacity-45 ${
        checked ? "border-primary bg-primary" : "border-input bg-muted"
      } ${className ?? ""}`}
    >
      <span
        className={`inline-block size-3.5 rounded-sm transition-transform ${
          checked ? "bg-primary-foreground translate-x-4.5" : "bg-card translate-x-0.5"
        }`}
      />
    </button>
  );
}
