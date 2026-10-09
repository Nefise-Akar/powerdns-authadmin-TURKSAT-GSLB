"use client";

/**
 * app/(auth)/login/ldap-login-form.tsx
 *
 * Username + password form for an LDAP provider. Posts to
 * /api/auth/ldap/<slug>/login, which runs the bind-then-search-
 * then-rebind flow server-side. Same captcha contract as the local
 * form - when `turnstileSiteKey` is provided the Cloudflare widget
 * renders and its token is included in the body.
 */

import { useRef, useState, type FormEvent } from "react";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { apiFetch } from "@/lib/client/api-fetch";
import { readFormFields, useDomFieldSync } from "@/lib/client/form-dom";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

interface Props {
  slug: string;
  providerName: string;
  turnstileSiteKey?: string;
  /** Validated (same-origin) post-login destination. */
  next?: string;
}

export function LdapLoginForm({
  slug,
  providerName,
  turnstileSiteKey,
  next = "/dashboard",
}: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  // Credentials typed before this bundle loaded are in the DOM and nowhere
  // else; adopt them on mount and re-read them on submit (#139).
  const formRef = useRef<HTMLFormElement>(null);
  useDomFieldSync(formRef, { username: setUsername, password: setPassword });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const submitted = readFormFields(event.currentTarget, ["username", "password"]);
    setUsername(submitted.username);
    setPassword(submitted.password);

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch(`/api/auth/ldap/${encodeURIComponent(slug)}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: submitted.username,
          password: submitted.password,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          retryAfterSeconds?: number;
          reason?: string;
        } | null;
        if (res.status === 429 && data?.retryAfterSeconds) {
          setError(`Too many attempts. Try again in ${data.retryAfterSeconds}s.`);
        } else if (res.status === 502 && (data?.reason === "transport" || data?.reason === "tls")) {
          setError(
            "We couldn't reach the directory. Try again in a moment, or contact your administrator.",
          );
        } else if (data?.reason === "ldap-not-authorized") {
          setError(
            "Sign-in refused: your account is not authorized for this system. Contact your administrator if you believe this is a mistake.",
          );
        } else if (data?.reason === "captcha-required" || data?.reason === "captcha-failed") {
          setError(
            data.reason === "captcha-required"
              ? "Please complete the captcha challenge."
              : "Captcha verification failed. Try again.",
          );
        } else {
          setError(data?.error ?? "Sign-in failed.");
        }
        setCaptchaResetKey((n) => n + 1);
        return;
      }
      window.location.assign(next);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const submitDisabled = loading || (turnstileSiteKey !== undefined && captchaToken === null);

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-4"
      aria-label={`Sign in with ${providerName}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{providerName}</span>
        <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
          LDAP
        </span>
      </div>
      <div>
        <label htmlFor={`ldap-username-${slug}`} className="block text-sm font-medium">
          Username
        </label>
        <input
          id={`ldap-username-${slug}`}
          name="username"
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={`mt-1 w-full ${inputClass}`}
          placeholder="alice"
        />
      </div>

      <div>
        <label htmlFor={`ldap-password-${slug}`} className="block text-sm font-medium">
          Password
        </label>
        <input
          id={`ldap-password-${slug}`}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`mt-1 w-full ${inputClass}`}
        />
      </div>

      <TurnstileWidget
        siteKey={turnstileSiteKey}
        onToken={setCaptchaToken}
        resetKey={captchaResetKey}
      />

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
        Sign in
      </button>
    </form>
  );
}
