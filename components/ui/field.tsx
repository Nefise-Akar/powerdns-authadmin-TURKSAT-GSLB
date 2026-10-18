"use client";

/**
 * components/ui/field.tsx
 *
 * Form control styles + the label/control/help wrapper, per the Turksat design
 * system: 32px controls on the card surface with an `input` border (the
 * meaning-bearing edge), a `ring` border plus the focus ring on keyboard
 * focus, and a `destructive` border when invalid. Label, control and help
 * text sit 6px apart; a field error replaces the help text in the same spot.
 */

import { cloneElement, isValidElement, useId, type ReactNode } from "react";

const CONTROL =
  "block w-full rounded-md border border-input bg-card px-3 text-body text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-focus-ring focus-visible:outline-hidden aria-invalid:border-destructive disabled:cursor-default disabled:opacity-45";

/** Single-line input (and anything else that should look like one). */
export const inputClass = `${CONTROL} h-8`;

/** Multi-line input: same frame, height follows `rows`. */
export const textareaClass = `${CONTROL} py-1.5`;

/**
 * Label + control + help/error. A single child element without an `id` gets
 * one, and is wired to the label (`htmlFor`) and to the help or error text
 * (`aria-describedby`); an error also sets `aria-invalid`.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const autoId = useId();
  const noteId = `${autoId}-note`;
  const hasNote = Boolean(error ?? hint);
  let control = children;
  let controlId: string | undefined;
  if (
    isValidElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>(children)
  ) {
    controlId = children.props.id ?? autoId;
    control = cloneElement(children, {
      id: controlId,
      ...(hasNote && !children.props["aria-describedby"] ? { "aria-describedby": noteId } : {}),
      ...(error ? { "aria-invalid": true } : {}),
    });
  }
  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      <label htmlFor={controlId} className="text-label text-foreground">
        {label}
      </label>
      {control}
      {error ? (
        <p id={noteId} className="text-caption text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
