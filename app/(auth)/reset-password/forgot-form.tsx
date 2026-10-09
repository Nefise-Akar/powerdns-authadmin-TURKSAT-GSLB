"use client";

import { useRef, useState, type FormEvent } from "react";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { apiFetch } from "@/lib/client/api-fetch";
import { readFormFields, useDomFieldSync } from "@/lib/client/form-dom";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  // Input typed before this bundle loaded is in the DOM and nowhere else;
  // adopt it on mount and re-read it on submit (#139).
  const formRef = useRef<HTMLFormElement>(null);
  useDomFieldSync(formRef, { email: setEmail });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const submitted = readFormFields(event.currentTarget, ["email"]);
    setEmail(submitted.email);

    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: submitted.email,
          ...(captchaToken !== null ? { captchaToken } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
        retryAfterSeconds?: number;
      } | null;
      if (res.status === 429) {
        setError(
          data?.retryAfterSeconds
            ? `Too many requests. Try again in ${data.retryAfterSeconds}s.`
            : "Too many requests.",
        );
        // Single-use token; refresh the widget.
        setCaptchaResetKey((n) => n + 1);
        return;
      }
      if (!res.ok) {
        setError(data?.error ?? "Request failed.");
        setCaptchaResetKey((n) => n + 1);
        return;
      }
      setMessage(data?.message ?? "Request received.");
      // The server returns the same opaque OK whether the email
      // matched or not (so this isn't an existence oracle) and
      // whether captcha verified or not (so misconfigured client
      // captchas don't help bots distinguish). Either way, the
      // token is burned upstream - refresh so the user can resubmit.
      setCaptchaResetKey((n) => n + 1);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const submitDisabled = loading || (turnstileSiteKey !== undefined && captchaToken === null);

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`mt-1 w-full ${inputClass}`}
        />
      </div>
      <TurnstileWidget
        siteKey={turnstileSiteKey}
        onToken={setCaptchaToken}
        resetKey={captchaResetKey}
      />
      {message ? (
        <p className="border-success bg-background rounded border p-3 text-sm" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <button
        aria-busy={loading}
        type="submit"
        disabled={submitDisabled}
        className={buttonClass({ variant: "primary", className: "block w-full" })}
      >
        Request reset link
      </button>
    </form>
  );
}
