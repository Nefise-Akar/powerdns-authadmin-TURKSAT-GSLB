"use client";

/**
 * components/ui/field.tsx
 *
 * Form control styles + the label/control/help wrapper, per the Turksat design
 * system: 32px controls on the card surface with an `input` border (the
 * meaning-bearing edge), a `ring` border plus the focus ring on keyboard
 * focus, and a `destructive` border when invalid. Label, control and help
 * text sit 6px apart; a field error replaces the help text in the same spot.
 *
 * `Field` wires the caption to its control for assistive technology. The
 * caller hands over a bare control; the field gives it an id (`useId`) when
 * it has none, points the `<label htmlFor>` at it and lists the help or
 * error paragraph in `aria-describedby`. When the child is not a single
 * labelable control (a `<div>` holding a Switch and its state text, a
 * checkbox `<label>`), the caption becomes a `<span>` and the wrapper a
 * `role="group"` labelled by it, so the name still reaches the controls
 * inside without producing a dangling `<label>`.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

const CONTROL =
  "block w-full rounded-md border border-input bg-card px-3 text-body text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-focus-ring focus-visible:outline-hidden aria-invalid:border-destructive disabled:cursor-default disabled:opacity-45";

/** Single-line input (and anything else that should look like one). */
export const inputClass = `${CONTROL} h-8`;

/** Multi-line input: same frame, height follows `rows`. */
export const textareaClass = `${CONTROL} py-1.5`;

interface WireableProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

/** Elements the caption can't point at: containers and nested labels. */
const NON_LABELABLE_TAGS = new Set(["div", "span", "label", "ul", "ol", "fieldset", "p"]);

export interface FieldProps {
  label: ReactNode;
  /**
   * Id for the control. Optional - a child without an id gets a generated
   * one. Pass it when something else (a test, a `prompt` default) needs to
   * find the control by id.
   */
  id?: string;
  /** Appends a destructive asterisk to the caption. */
  required?: boolean;
  hint?: ReactNode;
  /** A single validation message; replaces the hint in the same spot. */
  error?: ReactNode;
  /** Validation messages straight from a Zod `fieldErrors` entry. */
  errors?: string[];
  /** Extra classes on the wrapper (grid spans, margins). */
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  id,
  required,
  hint,
  error,
  errors,
  className = "",
  children,
}: FieldProps) {
  const autoId = useId();
  const noteId = `${autoId}-note`;
  const captionId = `${autoId}-caption`;
  const errorText: ReactNode = error ?? (errors && errors.length > 0 ? errors.join(" ") : null);
  const hasError = errorText !== null && errorText !== undefined && errorText !== false;
  const hasNote = hasError || Boolean(hint);

  // The control is the first labelable element among the children - a field
  // may also carry a preview line or a secondary note after its input, and
  // those must not swallow the label wiring.
  //
  // The children are always rendered as this array, never as the lone
  // element when there happens to be one. A control followed by a sibling
  // that appears on the first keystroke (the zone-name "Stored as" preview)
  // would otherwise switch its slot from one element to an array, and React
  // remounts the control on that switch - dropping focus mid-word (#161).
  // `Children.toArray` keys by original position, so the control keeps its
  // key when a sibling shows up or goes away.
  const parts = Children.toArray(children);
  const controlIndex = parts.findIndex(
    (part) => isValidElement<WireableProps>(part) && isLabelable(part.type),
  );
  let controlId: string | undefined;
  let control: ReactNode[] = parts;
  if (controlIndex !== -1) {
    const target = parts[controlIndex] as ReactElement<WireableProps>;
    controlId = target.props.id ?? id ?? autoId;
    const describedBy = [target.props["aria-describedby"], hasNote ? noteId : null]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ");
    const wired = cloneElement(target, {
      id: controlId,
      ...(describedBy ? { "aria-describedby": describedBy } : {}),
      ...(hasError && target.props["aria-invalid"] === undefined ? { "aria-invalid": true } : {}),
    });
    control = parts.map((part, index) => (index === controlIndex ? wired : part));
  }

  const caption = (
    <>
      {label}
      {required ? <span className="text-destructive"> *</span> : null}
    </>
  );

  return (
    <div
      className={`flex flex-col gap-1.5 ${className}`.trim()}
      role={controlId ? undefined : "group"}
      aria-labelledby={controlId ? undefined : captionId}
    >
      {controlId ? (
        <label htmlFor={controlId} className="text-label text-foreground">
          {caption}
        </label>
      ) : (
        <span id={captionId} className="text-label text-foreground">
          {caption}
        </span>
      )}
      {control}
      {hasError ? (
        <p id={noteId} className="text-caption text-destructive" role="alert">
          {errorText}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Host elements are labelable unless they're known containers; a component
 * (SelectMenu, NumberInput, DateTimePicker, …) is assumed to forward `id` to
 * its focusable element, which every control under components/ui does.
 */
function isLabelable(type: unknown): boolean {
  if (typeof type === "string") return !NON_LABELABLE_TAGS.has(type);
  return typeof type === "function" || (typeof type === "object" && type !== null);
}
