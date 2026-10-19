"use client";

/**
 * app/(app)/profile/_components/name-edit.tsx
 *
 * Inline editor for the user's display name. Renders as the name
 * string + Edit button by default; clicking Edit swaps in a text
 * input + Save/Cancel.
 *
 * Submitting an empty string clears the name (server normalizes
 * empty → null). The placeholder line uses an em-dash to match the
 * static "no name set" rendering elsewhere on the profile page.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export function NameEdit({ initialName }: { initialName: string | null }) {
  const router = useRouter();
  const { toast } = useDialog();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName ?? "");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      const result = await mutate("/api/profile/name", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft === "" ? null : draft }),
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Save failed",
          description: result.error,
        });
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    setDraft(initialName ?? "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <span className="flex items-center gap-2">
        <span className="truncate">{initialName ?? "-"}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-primary hover:text-primary-hover text-xs hover:underline"
        >
          Edit
        </button>
      </span>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
      className="flex items-center gap-2"
    >
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, 120))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            handleCancel();
          }
        }}
        autoFocus
        disabled={busy}
        aria-label="Display name"
        placeholder="Display name (leave empty to clear)"
        className={`min-w-0 flex-1 ${inputClass}`}
      />
      <button
        aria-busy={busy}
        type="submit"
        disabled={busy}
        className={buttonClass({ variant: "primary", size: "sm", className: "shrink-0" })}
      >
        Save
      </button>
      <button
        type="button"
        onClick={handleCancel}
        disabled={busy}
        className={buttonClass({ size: "sm", className: "shrink-0" })}
      >
        Cancel
      </button>
    </form>
  );
}
