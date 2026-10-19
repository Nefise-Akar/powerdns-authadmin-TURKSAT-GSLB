"use client";

/**
 * components/ui/dialog.tsx
 *
 * In-app modal + toast system, replacing the browser's native alert / confirm
 * which the project bans on UX grounds. Exposes an imperative API via the
 * `useDialog()` hook:
 *
 *   const { confirm, toast } = useDialog();
 *   if (await confirm({ title: "Delete user?", confirmLabel: "Delete user", variant: "danger" })) { … }
 *   toast({ kind: "success", description: "Saved." });
 *
 * Both are global: the `DialogProvider` mounts once in `app/(app)/layout.tsx`
 * and `app/(auth)/layout.tsx`, and every component beneath gets the hook.
 *
 * Accessibility:
 *   - role="dialog", aria-modal, aria-labelledby / aria-describedby
 *   - Escape closes (resolves false for confirms)
 *   - Backdrop click closes (configurable per-call)
 *   - Focus moves into the dialog on open: the primary action for a plain
 *     confirm, Cancel for a `danger` confirm (so Enter can't destroy by
 *     reflex), the input for a prompt. Restored to the prior activeElement
 *     on close.
 *   - Focus trap via Tab cycling among tabbable descendants, and the app
 *     root is made `inert` while any modal is open so nothing behind the
 *     backdrop is reachable by pointer, keyboard or screen reader.
 *
 * Toasts are non-blocking. Success / info / warn auto-dismiss after 4–6 s,
 * paused while hovered or focused; error toasts stay until dismissed, since
 * they carry the failure text the operator needs to act on. Stacked
 * top-right, always-mounted live region.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { inputClass } from "@/components/ui/field";
import { createPortal } from "react-dom";

/**
 * The element `DialogProvider` wraps the page in. Modals are portaled to
 * <body>, outside this element, so it can be made `inert` while one is open
 * without disabling the modal itself.
 */
const APP_ROOT_ID = "pda-app-root";

// =============================================================================
// Shared page lock - counter-based so stacked dialogs cooperate.
//
// Two things happen while a modal is open: body scroll is suppressed and the
// app root is made `inert`. Both are counted rather than toggled.
//
// The bug the counter guards against: each Dialog effect used to save+restore
// `body.style.overflow` independently. When the editor flow opened a second
// dialog (Review) on top of the first (Editor), the Review effect captured
// the already-set `overflow: hidden` as its "previous" value. On close,
// React fires cleanups in an order that depends on commit timing - if the
// outer cleanup ran first, the inner cleanup would then *re-apply*
// `overflow: hidden` over the now-restored `""`, leaving the page scroll
// permanently locked.
//
// Instead, every Dialog calls `lockPage()` on open and `unlockPage()` on
// close. The first lock snapshots the original value and applies `hidden` +
// `inert`; subsequent locks just bump the counter. The last unlock restores
// both. Order-independent.
// =============================================================================

let activeDialogLocks = 0;
let bodyOverflowBeforeLock: string | null = null;

function lockPage(): void {
  if (typeof document === "undefined") return;
  if (activeDialogLocks === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.getElementById(APP_ROOT_ID)?.setAttribute("inert", "");
  }
  activeDialogLocks++;
}

function unlockPage(): void {
  if (typeof document === "undefined") return;
  if (activeDialogLocks === 0) return;
  activeDialogLocks--;
  if (activeDialogLocks === 0) {
    if (bodyOverflowBeforeLock !== null) {
      document.body.style.overflow = bodyOverflowBeforeLock;
      bodyOverflowBeforeLock = null;
    }
    document.getElementById(APP_ROOT_ID)?.removeAttribute("inert");
  }
}

/**
 * Restore focus to the element that opened a modal. Deferred one microtask
 * so it runs after every effect cleanup of the closing modal, including the
 * one that lifts `inert` from the app root - an inert element refuses focus.
 */
function restoreFocus(el: HTMLElement | null): void {
  if (!el) return;
  queueMicrotask(() => el.focus?.());
}

/** Modals render into <body> so they sit outside the inert app root. */
function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

// =============================================================================
// Public API
// =============================================================================

export type DialogVariant = "default" | "danger";

/** Optional checkbox rendered between the description and the action row. */
export interface ConfirmCheckbox {
  label: string;
  /** Initial checked state. Default false. */
  defaultChecked?: boolean;
  /** Alert shown (in a warning style) ONLY while the box is unchecked. */
  warningWhenUnchecked?: string;
}

export interface ConfirmCheckboxResult {
  confirmed: boolean;
  /** The checkbox's final state (only meaningful when `confirmed`). */
  checked: boolean;
}

export interface ConfirmOptions {
  title: string;
  /** Body text. Accepts a node so callers can prepend an icon, bold a phrase, etc. */
  description?: ReactNode;
  /**
   * Required: the button says what happens ("Delete key", "Revoke"), never a
   * bare "OK" / "Confirm" - the design system rules those out.
   */
  confirmLabel: string;
  cancelLabel?: string;
  variant?: DialogVariant;
  /** When true (default), backdrop click cancels. Disable for high-stakes prompts. */
  dismissOnBackdrop?: boolean;
  /** Adds a checkbox; `confirm` then resolves `{ confirmed, checked }`. */
  checkbox?: ConfirmCheckbox;
}

export interface PromptOptions {
  title: string;
  description?: string;
  /** Initial value of the input. */
  defaultValue?: string;
  /** HTML placeholder attribute. */
  placeholder?: string;
  /** Label text above the input. Defaults to the title. */
  label?: string;
  /** Required, as for `confirm`: name the outcome of submitting. */
  confirmLabel: string;
  cancelLabel?: string;
  /**
   * Optional synchronous validator. Return null when the value is
   * acceptable, or a string error message to render under the input
   * and block submission.
   */
  validate?: (value: string) => string | null;
  /** When true (default), backdrop click cancels. */
  dismissOnBackdrop?: boolean;
}

export type ToastKind = "success" | "error" | "info" | "warn";

export interface ToastOptions {
  title?: string;
  description: string;
  kind?: ToastKind;
  /**
   * Auto-dismiss delay in ms; `0` keeps the toast until dismissed. Defaults
   * by kind: error stays (it carries the failure text), warn 6 s, else 4 s.
   */
  durationMs?: number;
}

interface DialogApi {
  confirm: {
    (opts: ConfirmOptions & { checkbox: ConfirmCheckbox }): Promise<ConfirmCheckboxResult>;
    (opts: ConfirmOptions): Promise<boolean>;
  };
  /**
   * Prompt for a single text value. Resolves with the trimmed input
   * on confirm, or `null` on cancel / dismiss. Replaces the browser's
   * `window.prompt` for the same reasons we ban `alert` / `confirm`:
   * native modals are unstyled, can't be tested, and break flow on
   * mobile.
   */
  prompt: (opts: PromptOptions) => Promise<string | null>;
  toast: (opts: ToastOptions) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error(
      "useDialog must be used inside a <DialogProvider>. Add it to the route layout.",
    );
  }
  return ctx;
}

// =============================================================================
// Provider
// =============================================================================

interface ConfirmState extends ConfirmOptions {
  id: number;
  resolve: (value: ConfirmCheckboxResult) => void;
}

interface PromptState extends PromptOptions {
  id: number;
  resolve: (value: string | null) => void;
}

interface ToastState extends ToastOptions {
  id: number;
  durationMs: number;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [confirmStack, setConfirmStack] = useState<ConfirmState[]>([]);
  const [promptStack, setPromptStack] = useState<PromptState[]>([]);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean | ConfirmCheckboxResult> => {
    return new Promise<boolean | ConfirmCheckboxResult>((resolve) => {
      setConfirmStack((stack) => [
        ...stack,
        {
          ...opts,
          id: nextId.current++,
          // Callers without a checkbox keep the historical boolean contract;
          // callers with one get the richer { confirmed, checked }.
          resolve: (r: ConfirmCheckboxResult) => resolve(opts.checkbox ? r : r.confirmed),
        },
      ]);
    });
  }, []) as DialogApi["confirm"];

  const resolveTop = useCallback((value: ConfirmCheckboxResult) => {
    setConfirmStack((stack) => {
      const top = stack[stack.length - 1];
      if (!top) return stack;
      top.resolve(value);
      return stack.slice(0, -1);
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setPromptStack((stack) => [...stack, { ...opts, id: nextId.current++, resolve }]);
    });
  }, []);

  const resolveTopPrompt = useCallback((value: string | null) => {
    setPromptStack((stack) => {
      const top = stack[stack.length - 1];
      if (!top) return stack;
      top.resolve(value);
      return stack.slice(0, -1);
    });
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    const id = nextId.current++;
    const durationMs =
      opts.durationMs ?? (opts.kind === "error" ? 0 : opts.kind === "warn" ? 6000 : 4000);
    // The card owns its own timer so it can pause while hovered / focused.
    setToasts((current) => [...current, { ...opts, id, durationMs }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<DialogApi>(() => ({ confirm, prompt, toast }), [confirm, prompt, toast]);

  // Stack ordering: confirms render under prompts when both are open
  // (a prompt opened from inside a confirm's handler still appears on
  // top). The `isTopMost` heuristic considers BOTH stacks because the
  // global topmost is whatever was opened last, regardless of kind.
  const totalOpen = confirmStack.length + promptStack.length;

  return (
    <DialogContext.Provider value={api}>
      {/* `display: contents` keeps the wrapper out of the layout: the shell's
          `h-dvh flex` root still sits directly under <body> as far as CSS is
          concerned, while the id gives the modals something to make inert. */}
      <div id={APP_ROOT_ID} style={{ display: "contents" }}>
        {children}
      </div>
      {confirmStack.map((state, index) => (
        <ConfirmModal
          key={state.id}
          state={state}
          isTopMost={index === confirmStack.length - 1 && promptStack.length === 0}
          onResolve={resolveTop}
        />
      ))}
      {promptStack.map((state, index) => (
        <PromptModal
          key={state.id}
          state={state}
          isTopMost={index === promptStack.length - 1}
          onResolve={resolveTopPrompt}
        />
      ))}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      {/* Reference totalOpen so the linter sees it used in dev-tools
          telemetry hooks we may add later. Cheap no-op. */}
      <span hidden data-dialog-open-count={totalOpen} />
    </DialogContext.Provider>
  );
}

// =============================================================================
// Confirm modal
// =============================================================================

function ConfirmModal({
  state,
  isTopMost,
  onResolve,
}: {
  state: ConfirmState;
  isTopMost: boolean;
  onResolve: (value: ConfirmCheckboxResult) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [checked, setChecked] = useState(state.checkbox?.defaultChecked ?? false);
  // Cancel paths (escape / backdrop / Cancel) don't act on the checkbox.
  const cancel = useCallback(() => onResolve({ confirmed: false, checked: false }), [onResolve]);

  // Capture the element that triggered the dialog so we can restore focus.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => restoreFocus(previouslyFocused.current);
  }, []);

  // Page lock + initial focus + key handling, only on the topmost modal.
  useEffect(() => {
    if (!isTopMost) return;
    lockPage();

    // Initial focus lands on the action marked `data-dialog-focus`: Confirm
    // for an ordinary question, Cancel for a destructive one, so a reflexive
    // Enter on a danger prompt backs out instead of deleting.
    const tabbables = getTabbables(dialogRef.current);
    const initial = tabbables.find((el) => el.dataset["dialogFocus"] === "true") ?? tabbables[0];
    initial?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key === "Tab") {
        const focusable = getTabbables(dialogRef.current);
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockPage();
    };
  }, [isTopMost, cancel]);

  const titleId = `dialog-title-${state.id}`;
  const descriptionId = state.description ? `dialog-description-${state.id}` : undefined;
  const variant = state.variant ?? "default";
  const dismissOnBackdrop = state.dismissOnBackdrop !== false;

  return (
    // Two-layer layout - see the matching comment in `Dialog` below for the
    // why. Outer is the scrollable viewport, inner flex centers the dialog
    // when there's room and lets it overflow + scroll when there isn't.
    <ModalPortal>
      <div className="fixed inset-0 z-[100] !mt-0 overflow-y-auto" aria-hidden={!isTopMost}>
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => dismissOnBackdrop && cancel()}
          aria-hidden
        />
        <div className="relative flex min-h-full items-center justify-center p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="border-border bg-card text-card-foreground relative w-full max-w-md rounded-md border p-6"
          >
            <h2 id={titleId} className="text-h2">
              {state.title}
            </h2>
            {state.description ? (
              <p id={descriptionId} className="text-body text-muted-foreground mt-1">
                {state.description}
              </p>
            ) : null}
            {state.checkbox ? (
              <div className="mt-4">
                <Checkbox checked={checked} onChange={setChecked} label={state.checkbox.label} />
                {!checked && state.checkbox.warningWhenUnchecked ? (
                  <Alert live className="mt-3">
                    {state.checkbox.warningWhenUnchecked}
                  </Alert>
                ) : null}
              </div>
            ) : null}
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                data-dialog-focus={variant === "danger" ? "true" : undefined}
                onClick={cancel}
                className={buttonClass()}
              >
                {state.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                data-dialog-focus={variant === "danger" ? undefined : "true"}
                onClick={() => onResolve({ confirmed: true, checked })}
                className={buttonClass({
                  variant: variant === "danger" ? "destructive" : "primary",
                })}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// =============================================================================
// Prompt modal - text input variant of confirm
// =============================================================================

function PromptModal({
  state,
  isTopMost,
  onResolve,
}: {
  state: PromptState;
  isTopMost: boolean;
  onResolve: (value: string | null) => void;
}) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [value, setValue] = useState(state.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => restoreFocus(previouslyFocused.current);
  }, []);

  useEffect(() => {
    if (!isTopMost) return;
    lockPage();

    // Focus the input rather than the primary button - operator
    // starts typing immediately, the common case for a prompt.
    inputRef.current?.focus();
    inputRef.current?.select();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onResolve(null);
        return;
      }
      if (event.key === "Tab") {
        const focusable = getTabbables(dialogRef.current);
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockPage();
    };
  }, [isTopMost, onResolve]);

  function submit() {
    const trimmed = value.trim();
    if (state.validate) {
      const v = state.validate(trimmed);
      if (v) {
        setError(v);
        return;
      }
    }
    onResolve(trimmed);
  }

  const titleId = `prompt-title-${state.id}`;
  const descriptionId = state.description ? `prompt-description-${state.id}` : undefined;
  const inputId = `prompt-input-${state.id}`;
  const errorId = error ? `prompt-error-${state.id}` : undefined;
  const dismissOnBackdrop = state.dismissOnBackdrop !== false;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[100] !mt-0 overflow-y-auto" aria-hidden={!isTopMost}>
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => dismissOnBackdrop && onResolve(null)}
          aria-hidden
        />
        <div className="relative flex min-h-full items-center justify-center p-4">
          <form
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="border-border bg-card text-card-foreground relative w-full max-w-md rounded-md border p-6"
          >
            <h2 id={titleId} className="text-h2">
              {state.title}
            </h2>
            {state.description ? (
              <p id={descriptionId} className="text-body text-muted-foreground mt-1">
                {state.description}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-1.5">
              <label htmlFor={inputId} className="text-label">
                {state.label ?? state.title}
              </label>
              <input
                ref={inputRef}
                id={inputId}
                type="text"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={state.placeholder}
                aria-invalid={error ? "true" : "false"}
                aria-describedby={errorId}
                className={inputClass}
              />
              {error ? (
                <p id={errorId} className="text-caption text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button type="button" onClick={() => onResolve(null)} className={buttonClass()}>
                {state.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="submit"
                data-dialog-focus="true"
                className={buttonClass({ variant: "primary" })}
              >
                {state.confirmLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

// =============================================================================
// Low-level Dialog - for custom content (forms, diff previews, etc.)
// =============================================================================

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Accessible title. Required for screen readers; visually hidden via `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  description?: string;
  /** Tailwind max-width class - default "max-w-lg". */
  maxWidthClass?: string;
  /** When false, backdrop click does nothing. Default true. */
  dismissOnBackdrop?: boolean;
  children: React.ReactNode;
}

/**
 * Controlled modal primitive. Use this when you need form fields or any
 * content beyond a yes/no question. Caller owns the open state.
 *
 *   <Dialog open={editing} onClose={() => setEditing(false)} title="Edit record">
 *     <form>…</form>
 *   </Dialog>
 */
export function Dialog({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  maxWidthClass = "max-w-lg",
  dismissOnBackdrop = true,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useRef(`dlg-title-${Math.random().toString(36).slice(2)}`);
  const descriptionId = useRef(
    description ? `dlg-desc-${Math.random().toString(36).slice(2)}` : undefined,
  );

  // Hold the latest onClose in a ref so the key handler can call it without
  // forcing the focus/listener effects to re-run on every parent render.
  // Without this, an inline `onClose={() => setX(false)}` from the caller
  // (which is a new arrow function each render) would re-fire the effect on
  // every keystroke and bounce focus back to the primary action.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Open / close lifecycle: focus management, body scroll lock, key listener.
  // Depends only on `open` so it runs exactly once per open cycle.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    lockPage();

    const tabbables = getTabbables(dialogRef.current);
    const initial = tabbables.find((el) => el.dataset["dialogFocus"] === "true") ?? tabbables[0];
    initial?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const focusable = getTabbables(dialogRef.current);
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockPage();
      restoreFocus(previouslyFocused.current);
    };
  }, [open]);

  if (!open) return null;

  return (
    // Two-layer layout: the outer is the scrollable viewport (with body
    // locked, this is the *only* surface that scrolls while the dialog is
    // open). The inner is a flex container with `min-h-full` - it stretches
    // to the viewport when the dialog is short (so `items-center` centers
    // the dialog), and grows past the viewport when the dialog is tall (so
    // the outer scrolls to reveal the overflow). The earlier single-div
    // approach (`fixed inset-0 flex items-center overflow-y-auto`) clipped
    // the top of any over-tall dialog above the scroll origin because
    // `items-center` centered content that was taller than the container.
    <ModalPortal>
      <div className="fixed inset-0 z-[100] !mt-0 overflow-y-auto">
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => dismissOnBackdrop && onClose()}
          aria-hidden
        />
        <div className="relative flex min-h-full items-start justify-center p-4 sm:items-center">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId.current}
            aria-describedby={descriptionId.current}
            className={`relative my-4 w-full ${maxWidthClass} border-border bg-card text-card-foreground rounded-md border p-6`}
          >
            <h2 id={titleId.current} className={hideTitle ? "sr-only" : "text-h2"}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId.current} className="text-body text-muted-foreground mt-1">
                {description}
              </p>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function getTabbables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const nodes = root.querySelectorAll<HTMLElement>(
    [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(","),
  );
  // `[hidden]` subtrees (collapsed wizard steps, inactive tabs) are not
  // tabbable in the browser either; letting them into the trap would park
  // focus on an invisible control.
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute("data-dialog-skip-tab") && el.closest("[hidden]") === null,
  );
}

// =============================================================================
// Toast viewport
// =============================================================================

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastState[];
  onDismiss: (id: number) => void;
}) {
  // Always mounted: a live region only announces changes to content that
  // was already in the accessibility tree, so one that appears together
  // with its first toast is often missed.
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed top-4 right-4 z-[120] flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

// Status is carried by the dot color and the text, never by color alone; the
// border stays a plain card edge except for errors and warnings.
const TOAST_DOT = {
  success: "bg-success",
  error: "bg-destructive",
  warn: "bg-warning",
  info: "bg-info",
} as const;
const TOAST_BORDER = {
  success: "border-border",
  error: "border-destructive",
  warn: "border-warning-border",
  info: "border-border",
} as const;

/**
 * Auto-dismiss timer that pauses while the pointer or keyboard focus is on
 * the card, so the operator can finish reading or reach the dismiss button.
 * Returns the hover/focus handlers to spread on the card.
 */
function useToastTimer(durationMs: number, onDismiss: () => void) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(durationMs);
  const startedAt = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (durationMs <= 0 || paused || remaining.current <= 0) return;
    startedAt.current = Date.now();
    const handle = window.setTimeout(() => onDismissRef.current(), remaining.current);
    return () => {
      window.clearTimeout(handle);
      if (startedAt.current !== null) {
        remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
        startedAt.current = null;
      }
    };
  }, [durationMs, paused]);

  return {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocus: () => setPaused(true),
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
    },
  };
}

function ToastCard({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const kind = toast.kind ?? "info";
  const pauseHandlers = useToastTimer(toast.durationMs, onDismiss);

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      {...pauseHandlers}
      className={`bg-card text-body text-card-foreground pointer-events-auto w-80 max-w-[90vw] rounded-md border px-4 py-3 ${TOAST_BORDER[kind]}`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={`mt-[7px] size-1.5 flex-none rounded-full ${TOAST_DOT[kind]}`}
        />
        <div className="min-w-0 flex-1">
          {toast.title ? <div className="text-body-strong">{toast.title}</div> : null}
          <div className={toast.title ? "text-body-sm text-muted-foreground" : ""}>
            {toast.description}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className={iconButtonClass("xs")}
        >
          <X aria-hidden strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
