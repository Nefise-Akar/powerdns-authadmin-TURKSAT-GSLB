"use client";

/**
 * app/(app)/admin/roles/[id]/_components/require-mfa-toggle.tsx
 *
 * Single checkbox + save button bound to the role's `requiresMfa`
 * column. The save is a narrow PATCH to /api/admin/roles/[id] - the
 * rest of the role row (slug, name, permissions) isn't editable from
 * the UI yet, so a focused toggle keeps the blast radius small.
 *
 * When permission to update is absent the parent simply doesn't
 * render this component; this layer assumes it's allowed to act.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";

interface Props {
  roleId: string;
  initialValue: boolean;
}

export function RequireMfaToggle({ roleId, initialValue }: Props) {
  const router = useRouter();
  const { toast } = useDialog();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);

  const dirty = value !== initialValue;

  async function handleSave() {
    setBusy(true);
    try {
      const result = await mutate(`/api/admin/roles/${roleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiresMfa: value }),
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Save failed",
          description: result.error,
        });
        return;
      }
      toast({
        kind: "success",
        description: value
          ? "MFA is now required for this role."
          : "MFA is no longer required for this role.",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-border bg-background flex items-start justify-between gap-4 rounded-md border p-4">
      <label className="flex flex-1 cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => setValue(e.target.checked)}
          disabled={busy}
          className="accent-primary mt-0.5 h-4 w-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
        />
        <span>
          <span className="font-medium">Require MFA</span>
          <span className="text-muted-foreground mt-0.5 block text-xs">
            Users assigned this role at any scope must have TOTP enrolled. Anyone holding the role
            without MFA is shunted to /profile to enroll before they can use the app.
          </span>
        </span>
      </label>
      <button
        aria-busy={busy}
        type="button"
        onClick={handleSave}
        disabled={!dirty || busy}
        className={buttonClass({ variant: "primary", size: "sm", className: "shrink-0" })}
      >
        Save
      </button>
    </div>
  );
}
