"use client";

/**
 * app/(app)/dashboard/_components/unverified-email-banner.tsx
 *
 * Reminder + send-verification trigger for users with no
 * `email_verified_at`. Dismissible per-session via local state;
 * reappears on next page load so the operator can't forget.
 */

import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function UnverifiedEmailBanner() {
  const { toast } = useDialog();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  async function handleSend() {
    setBusy(true);
    try {
      const result = await mutate(`/api/auth/email/send-verification`, {
        method: "POST",
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Send failed",
          description: result.error,
        });
        return;
      }
      const data = result.data as { message: string };
      toast({ kind: "success", description: data.message, durationMs: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert
      title="email not verified"
      action={
        <div className="mt-1 flex gap-2">
          <button
            aria-busy={busy}
            type="button"
            onClick={handleSend}
            disabled={busy}
            className={buttonClass({ variant: "primary", size: "sm" })}
          >
            Send verification link
          </button>
          <button
            type="button"
            onClick={() => setHidden(true)}
            className={buttonClass({ size: "sm" })}
          >
            Dismiss
          </button>
        </div>
      }
    >
      Send a verification link to confirm your address. Your administrator will share it with you
      out-of-band until transactional email is configured.
    </Alert>
  );
}
