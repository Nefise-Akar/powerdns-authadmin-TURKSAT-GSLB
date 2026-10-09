/**
 * components/domain/rr-editors/_form.tsx
 *
 * Tiny shared form primitives used by every per-type editor. The field
 * wrapper and control styles are the app-wide ones from components/ui/field.
 */

"use client";

import { inputClass } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";

export { Field, inputClass, textareaClass } from "@/components/ui/field";

/**
 * Clamp a string to a non-negative integer ≤ max. Returns `null` for empty
 * input so an editor can render the empty state without forcing a 0.
 */
export function parseUintClamped(raw: string, max: number): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

/**
 * Unsigned-integer field. Backed by `<NumberInput>` so the operator can
 * clear the field while retyping (a controlled `value={number}` snaps an
 * emptied field straight back to `0`, which made "select all, type 20"
 * produce "020"-style surprises in the MX / SRV editors).
 */
export function uintInput(
  current: number,
  max: number,
  onChange: (n: number) => void,
  extra: { placeholder?: string; ariaLabel?: string } = {},
) {
  return (
    <NumberInput
      value={current}
      min={0}
      max={max}
      onChange={onChange}
      placeholder={extra.placeholder}
      ariaLabel={extra.ariaLabel}
      className={inputClass}
    />
  );
}
