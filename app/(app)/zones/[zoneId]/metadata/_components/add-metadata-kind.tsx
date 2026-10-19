"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "@/components/ui/dialog";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";
import { mutate } from "@/lib/client/api-fetch";
import { KIND_SPECS, getKindSpec, isKindApiWritable } from "./kind-specs";
import { MetadataValuesInput } from "./metadata-values-input";
import { buttonClass } from "@/components/ui/button";

interface Props {
  zoneIdEncoded: string;
  serverSlug: string;
  existingKinds: readonly string[];
}

const KIND_OPTIONS: Array<SelectOption<string>> = Object.entries(KIND_SPECS)
  .filter(([kind]) => isKindApiWritable(kind))
  .map(([kind, spec]) => ({ value: kind, label: kind, description: spec.description }))
  .sort((a, b) => a.value.localeCompare(b.value));

export function AddMetadataKind({ zoneIdEncoded, serverSlug, existingKinds }: Props) {
  const router = useRouter();
  const { toast } = useDialog();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const kindId = useId();

  const existing = new Set(existingKinds);
  const available = KIND_OPTIONS.filter((o) => !existing.has(o.value));
  const spec = kind ? getKindSpec(kind) : null;

  function reset() {
    setKind(null);
    setValues([]);
    setOpen(false);
  }

  async function handleSave() {
    if (!kind) return;
    setSaving(true);
    try {
      const cleaned = values.map((s) => s.trim()).filter((s) => s.length > 0);
      const result = await mutate(
        `/api/admin/pdns/zones/${zoneIdEncoded}/metadata/${encodeURIComponent(kind)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverSlug, values: cleaned }),
        },
      );
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Add failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: `Added ${kind}.` });
      reset();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass({ variant: "primary", size: "sm" })}
      >
        + Add metadata kind
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
      className="border-border bg-card space-y-3 rounded-md border p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Add metadata kind</h3>
        <button
          type="button"
          onClick={reset}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          Cancel
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={kindId} className="mb-1 block text-xs font-medium">
            Kind
          </label>
          <SelectMenu
            id={kindId}
            value={kind ?? ""}
            onChange={(next) => {
              setKind(next);
              setValues([]);
            }}
            options={available}
            placeholder="Select a kind…"
            searchable
            searchPlaceholder="Filter kinds…"
          />
          {spec ? (
            <p className="text-muted-foreground text-caption mt-1">{spec.description}</p>
          ) : null}
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium">Value{listy(spec) ? "s" : ""}</span>
          {kind ? (
            <MetadataValuesInput kind={kind} values={values} onChange={setValues} />
          ) : (
            <p className="text-muted-foreground text-caption">Pick a kind first.</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          aria-busy={saving}
          type="submit"
          disabled={!kind || saving}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          Add
        </button>
      </div>
    </form>
  );
}

function listy(spec: ReturnType<typeof getKindSpec> | null): boolean {
  return spec?.type === "list";
}
