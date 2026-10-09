"use client";

import { useRef, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/client/api-fetch";
import { readFormFields, useDomFieldSync } from "@/lib/client/form-dom";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export function ResetPasswordForm({ token }: { token: string }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Input typed before this bundle loaded is in the DOM and nowhere else;
  // adopt it on mount and re-read it on submit (#139). Without this the
  // length check below measures the empty state and rejects a password the
  // field visibly holds.
  const formRef = useRef<HTMLFormElement>(null);
  useDomFieldSync(formRef, { password: setPw, confirm: setConfirm });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const submitted = readFormFields(event.currentTarget, ["password", "confirm"]);
    setPw(submitted.password);
    setConfirm(submitted.confirm);

    if (submitted.password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (submitted.password !== submitted.confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: submitted.password }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        retryAfterSeconds?: number;
      } | null;
      if (res.status === 429) {
        setError(
          data?.retryAfterSeconds
            ? `Too many requests. Try again in ${data.retryAfterSeconds}s.`
            : "Too many requests.",
        );
        return;
      }
      if (!res.ok) {
        setError(data?.error ?? "Reset failed.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="border-success bg-background rounded border p-3 text-sm" role="status">
          Password updated. Sign in with the new password.
        </p>
        <a href="/login" className={buttonClass({ variant: "primary", className: "block w-full" })}>
          Sign in
        </a>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="pw" className="block text-sm font-medium">
          New password
        </label>
        <input
          id="pw"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className={`mt-1 w-full ${inputClass}`}
        />
        <p className="text-muted-foreground mt-1 text-xs">Minimum 12 characters.</p>
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-medium">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={`mt-1 w-full ${inputClass}`}
        />
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <button
        aria-busy={loading}
        type="submit"
        disabled={loading}
        className={buttonClass({ variant: "primary", className: "block w-full" })}
      >
        Set new password
      </button>
    </form>
  );
}
