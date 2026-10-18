"use client";

/**
 * app/(app)/admin/gslb/_components/gslb-delete-button.tsx
 *
 * Confirm-then-DELETE for the GSLB screens. Same flow as the shared
 * `ConfirmDeleteButton`, but on top of the GSLB fetch helper, so an expired
 * session says so and goes to sign-in instead of failing silently. The shared
 * component is deliberately left alone.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { useDialog } from "@/components/ui/dialog";
import { useGslbMutate } from "../_lib/use-gslb-fetch";

interface Props {
  endpoint: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  /** Toast on success; may use the response body (e.g. a leftover warning). */
  successMessage: string | ((body: unknown) => string);
  label: string;
  redirectTo?: string;
  className?: string;
}

export function GslbDeleteButton({
  endpoint,
  confirmTitle,
  confirmDescription,
  confirmLabel,
  successMessage,
  label,
  redirectTo,
  className,
}: Props) {
  const router = useRouter();
  const { confirm, toast } = useDialog();
  const gslbMutate = useGslbMutate();
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
      const result = await gslbMutate(endpoint, { method: "DELETE" });
      if (!result.ok) {
        toast({ kind: "error", title: `${label} failed`, description: result.error });
        return;
      }
      toast({
        kind: "success",
        description:
          typeof successMessage === "function" ? successMessage(result.data) : successMessage,
      });
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
