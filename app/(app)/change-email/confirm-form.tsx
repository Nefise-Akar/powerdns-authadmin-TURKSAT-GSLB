"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function ConfirmEmailChangeForm({ token }: { token: string }) {
  const [status, setStatus] = useState<"confirming" | "done" | "error">("confirming");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const started = useRef(false);

  async function confirm() {
    setStatus("confirming");
    setError(null);
    try {
      const res = await apiFetch("/api/profile/email/change/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Could not confirm email change.");
        setStatus("error");
        return;
      }
      const data = (await res.json()) as { email: string };
      setEmail(data.email);
      setStatus("done");
      // Sessions were revoked server-side - bounce to login with a flash so the
      // user reads the result first. (Leaving (app), so flash beats a toast.)
      setTimeout(() => window.location.assign("/login?flash=email-changed"), 1500);
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  // The link click IS the confirmation - confirm automatically on mount.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "error") {
    return (
      <div className="space-y-3">
        <Alert variant="destructive" live>
          {error}
        </Alert>
        <button
          type="button"
          onClick={() => void confirm()}
          className={buttonClass({ variant: "primary", className: "w-full" })}
        >
          Try again
        </button>
      </div>
    );
  }

  if (status === "done") {
    return (
      <p className="border-success bg-background rounded border p-3 text-sm" role="status">
        Email changed to <code>{email}</code>. Sessions revoked - sign in again in a moment.
      </p>
    );
  }

  return (
    <p className="border-border bg-background rounded border p-3 text-sm" role="status">
      Confirming your new email…
    </p>
  );
}
