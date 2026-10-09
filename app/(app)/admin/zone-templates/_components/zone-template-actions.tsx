"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";

export function ZoneTemplateActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { confirm, toast } = useDialog();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete template "${name}"?`,
      description:
        "Removes the template definition. Zones already created from it keep their records - templates are a creation-time scaffold, not a live link.",
      confirmLabel: "Delete template",
      variant: "danger",
      dismissOnBackdrop: false,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/admin/zone-templates/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          kind: "error",
          description: data?.error ?? "Delete failed.",
        });
        return;
      }
      toast({ kind: "success", description: "Template deleted." });
      router.push("/admin/zone-templates");
      router.refresh();
    } catch {
      toast({ kind: "error", description: "Network error. Please try again." });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      aria-busy={deleting}
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className={buttonClass({ variant: "destructive", className: "mt-4" })}
    >
      Delete template
    </button>
  );
}
