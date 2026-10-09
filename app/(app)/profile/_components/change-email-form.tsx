"use client";

/**
 * app/(app)/profile/_components/change-email-form.tsx
 *
 * Self-service email change. Two-step UX:
 *   1. User enters the new email + current password. We POST to
 *      /api/profile/email/change which mints a `pde_` token and
 *      records the confirm URL in the audit log (until SMTP lands).
 *   2. We surface a "Check your email - or ask your admin for the
 *      link from the audit log" message. The user opens the link
 *      and lands on /change-email?token=... to confirm.
 *
 * Hidden when the account is SSO-only (no local password) - those
 * users must change their email via the IdP.
 */

import { useState, type FormEvent } from "react";
import { useDialog } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

interface ErrorBody {
  error?: string;
  details?: { fieldErrors?: Record<string, string[]> };
  retryAfterSeconds?: number;
}

export function ChangeEmailForm() {
  const { toast } = useDialog();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await apiFetch("/api/profile/email/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, currentPassword }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ErrorBody | null;
        if (res.status === 429 && data?.retryAfterSeconds) {
          setError(`Too many attempts. Try again in ${data.retryAfterSeconds}s.`);
        } else {
          setError(data?.error ?? "Could not start email change.");
        }
        if (data?.details?.fieldErrors) setFieldErrors(data.details.fieldErrors);
        return;
      }
      setSent(true);
      setCurrentPassword("");
      toast({
        kind: "success",
        title: "Confirmation link issued",
        description:
          "Check the audit log (or ask your administrator) for the confirm URL, then open it to finalize.",
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="newEmail" className="block text-sm font-medium">
          New email
        </label>
        <input
          id="newEmail"
          type="email"
          autoComplete="email"
          required
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          className={`mt-1 w-full ${inputClass}`}
        />
        {fieldErrors["newEmail"]?.length ? (
          <p className="text-destructive mt-1 text-xs" role="alert">
            {fieldErrors["newEmail"].join(" ")}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="currentPasswordForEmail" className="block text-sm font-medium">
          Current password
        </label>
        <input
          id="currentPasswordForEmail"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={`mt-1 w-full ${inputClass}`}
        />
        {fieldErrors["currentPassword"]?.length ? (
          <p className="text-destructive mt-1 text-xs" role="alert">
            {fieldErrors["currentPassword"].join(" ")}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {sent ? (
        <p className="text-success text-sm">
          Confirmation link issued. Until transactional email lands, your administrator must share
          the URL from the audit log with you.
        </p>
      ) : null}

      <button
        aria-busy={loading}
        type="submit"
        disabled={loading}
        className={buttonClass({ variant: "primary" })}
      >
        Request email change
      </button>
    </form>
  );
}
