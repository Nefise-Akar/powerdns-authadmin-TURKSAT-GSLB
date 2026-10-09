"use client";

/**
 * Per-metadata-kind edit affordance. The input control is picked
 * by `MetadataValuesInput` based on the kind - bool kinds get a
 * toggle, enum kinds a dropdown, list kinds a textarea, etc.
 * Hidden unless the operator has `metadata.write`.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { isKindApiWritable } from "./kind-specs";
import { MetadataValuesInput } from "./metadata-values-input";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

interface Props {
  zoneIdEncoded: string;
  serverSlug: string;
  kind: string;
  initialValues: readonly string[];
}

export function MetadataEditor({ zoneIdEncoded, serverSlug, kind, initialValues }: Props) {
  const router = useRouter();
  const { confirm, toast } = useDialog();
  const [values, setValues] = useState<string[]>(() => [...initialValues]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = !sameValues(values, initialValues);
  const writable = isKindApiWritable(kind);

  if (!writable) {
    return (
      <Alert className="mt-3" title="read-only via API">
        PowerDNS does not allow modifying <code className="font-mono">{kind}</code> through its HTTP
        API. Use{" "}
        <code className="font-mono">
          pdnsutil set-meta {`<zone>`} {kind} {`<value>`}
        </code>{" "}
        on the PDNS host to change it.
      </Alert>
    );
  }

  async function handleSave() {
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
          title: "Save failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: `Saved ${kind}.` });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete ${kind}?`,
      description: `The kind will be removed entirely from this zone. PDNS reverts to its default behavior for this setting.`,
      confirmLabel: "Delete kind",
      variant: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const url = new URL(
        `/api/admin/pdns/zones/${zoneIdEncoded}/metadata/${encodeURIComponent(kind)}`,
        window.location.origin,
      );
      url.searchParams.set("serverSlug", serverSlug);
      const result = await mutate(url.pathname + url.search, { method: "DELETE" });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Delete failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: `Deleted ${kind}.` });
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <MetadataValuesInput kind={kind} values={values} onChange={setValues} />
      <div className="flex items-center gap-3">
        <button
          aria-busy={saving}
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          Save
        </button>
        <button
          aria-busy={deleting}
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={buttonClass({ variant: "destructive", size: "sm" })}
        >
          Delete kind
        </button>
        {!dirty ? (
          <span className="text-muted-foreground text-caption">No unsaved changes</span>
        ) : null}
      </div>
    </div>
  );
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  const ax = a.map((s) => s.trim()).filter((s) => s.length > 0);
  const bx = b.map((s) => s.trim()).filter((s) => s.length > 0);
  if (ax.length !== bx.length) return false;
  return ax.every((v, i) => v === bx[i]);
}
