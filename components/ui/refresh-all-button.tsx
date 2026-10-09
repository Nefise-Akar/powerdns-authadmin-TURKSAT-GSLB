"use client";

/**
 * components/ui/refresh-all-button.tsx
 *
 * Shared "Refresh all" fleet button. Collapses the duplicated scaffolding
 * (busy state, POST, error toast, router.refresh, button markup) the OIDC and
 * PDNS-servers refresh-all buttons each carried. The per-feature success copy
 * is supplied via `successToast`, which maps the response payload to a toast.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";

interface RefreshAllButtonProps<T> {
  /** POST target. */
  endpoint: string;
  /** Native title/tooltip. */
  title: string;
  /** Maps the success payload to the toast to show. */
  successToast: (data: T) => { kind: "success" | "error"; title: string; description: string };
  className?: string;
}

export function RefreshAllButton<T = unknown>({
  endpoint,
  title,
  successToast,
  className,
}: RefreshAllButtonProps<T>) {
  const router = useRouter();
  const { toast } = useDialog();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const result = await mutate<T>(endpoint, { method: "POST" });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Refresh failed to dispatch",
          description: "Check your permissions or reload the page.",
        });
        return;
      }
      toast(successToast(result.data));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-busy={busy}
      title={title}
      className={className ?? buttonClass()}
    >
      Refresh all
    </button>
  );
}
