"use client";

/**
 * app/(app)/admin/users/_components/mfa-panel.tsx
 *
 * Admin view of a user's MFA enrollment + a "Reset MFA" button when
 * the operator has `user.update`. Replaces the old SQL-poke workflow
 * for the "user lost their phone" recovery path.
 *
 * When the target's roles require MFA, removing the enrollment shunts
 * the user to forced re-enrollment on their next request (the
 * `(app)/layout.tsx` compliance check handles that). The dialog copy
 * mentions the consequence so the operator isn't surprised.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";

interface Props {
  userId: string;
  canManage: boolean;
  totpEnabled: boolean;
  /**
   * True when the admin is looking at their own account. Tightens
   * the confirm copy so the admin notices that resetting THEIR own
   * MFA may immediately push them into the forced-enrollment flow
   * if their role requires MFA.
   */
  isSelf: boolean;
}

export function MfaPanel({ userId, canManage, totpEnabled, isSelf }: Props) {
  const router = useRouter();
  const { confirm, toast } = useDialog();
  const [busy, setBusy] = useState(false);

  async function handleReset() {
    const ok = await confirm({
      title: isSelf ? "Reset YOUR MFA?" : "Reset this user's MFA?",
      description: isSelf
        ? "Your TOTP enrollment will be removed. If any of your roles require MFA you'll be sent straight to re-enrollment on your next request - you won't be locked out, but you'll need an authenticator app handy."
        : "Their TOTP enrollment will be removed. If any of their roles require MFA, they'll be forced to re-enroll on their next visit. Use this when the user has lost their authenticator device.",
      confirmLabel: "Reset MFA",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await mutate(`/api/admin/users/${userId}/mfa/totp`, {
        method: "DELETE",
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Reset failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: "MFA enrollment removed." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-border rounded-md border p-5">
      <h2 className="text-h3 text-foreground mb-2">Multi-factor authentication</h2>
      <div className="flex items-center justify-between gap-3 text-sm">
        <div>
          <div className="font-medium">
            TOTP:{" "}
            {totpEnabled ? (
              <span className="text-success">enrolled</span>
            ) : (
              <span className="text-muted-foreground">not enrolled</span>
            )}
          </div>
          {!totpEnabled ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              The user can enroll themselves from /profile.
            </p>
          ) : null}
        </div>
        {canManage && totpEnabled ? (
          <button
            aria-busy={busy}
            type="button"
            onClick={handleReset}
            disabled={busy}
            className={buttonClass({ variant: "destructive", size: "sm", className: "shrink-0" })}
          >
            Reset MFA
          </button>
        ) : null}
      </div>
    </section>
  );
}
