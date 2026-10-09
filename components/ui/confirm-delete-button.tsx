"use client";

/**
 * components/ui/confirm-delete-button.tsx
 *
 * Shared confirm-then-DELETE button. Collapses the near-identical
 * delete-role / delete-cluster / delete-server (etc.) components that each
 * re-implemented the same confirm → DELETE → toast → redirect/refresh flow.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";

interface ConfirmDeleteButtonProps {
  /** DELETE target. */
  endpoint: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  /** Toast description shown on success. */
  successMessage: string;
  /** Button label; it stays the same while the request runs (the button is disabled). */
  label: string;
  /** Navigate here on success before refreshing. Omit to refresh in place. */
  redirectTo?: string;
  className?: string;
}

export function ConfirmDeleteButton({
  endpoint,
  confirmTitle,
  confirmDescription,
  confirmLabel,
  successMessage,
  label,
  redirectTo,
  className,
}: ConfirmDeleteButtonProps) {
  const router = useRouter();
  const { confirm, toast } = useDialog();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    const ok = await confirm({
      title: confirmTitle,
      description: confirmDescription,
      confirmLabel,
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await mutate(endpoint, { method: "DELETE" });
      if (!result.ok) {
        toast({ kind: "error", title: "Delete failed", description: result.error });
        return;
      }
      toast({ kind: "success", description: successMessage });
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={busy}
      aria-busy={busy}
      className={className ?? buttonClass({ variant: "destructive" })}
    >
      {label}
    </button>
  );
}
