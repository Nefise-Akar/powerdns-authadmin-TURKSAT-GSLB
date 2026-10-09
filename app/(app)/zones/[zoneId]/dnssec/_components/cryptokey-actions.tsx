"use client";

/**
 * app/(app)/zones/[zoneId]/dnssec/_components/cryptokey-actions.tsx
 *
 * "Generate key" button + per-row Toggle active / Delete buttons.
 * Hidden unless `canManage`. PDNS generates key material server-side;
 * no plaintext ever crosses the response boundary, so no reveal
 * panel needed (unlike TSIG).
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";

interface Row {
  id: number;
  keytype: string;
  active: boolean;
  published?: boolean;
}

interface Props {
  zoneIdEncoded: string;
  serverSlug: string;
  rows: Row[];
}

const KEYTYPES = ["ksk", "zsk", "csk"] as const;

export function CryptokeyActions({ zoneIdEncoded, serverSlug, rows }: Props) {
  const router = useRouter();
  const { confirm, prompt, toast } = useDialog();
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function handleGenerate() {
    // Use prompt for the keytype pick. Only three values so an input
    // with a validator beats a full select+modal at this scope.
    const keytype = await prompt({
      title: "Generate a new DNSSEC key",
      description:
        "PDNS will generate the key material with its default algorithm (typically ECDSAP256SHA256). KSKs sign the DNSKEY rrset; ZSKs sign other records; CSKs do both.",
      label: "Key type (ksk / zsk / csk)",
      defaultValue: "ksk",
      validate: (v) => {
        const lower = v.toLowerCase();
        if (!(KEYTYPES as readonly string[]).includes(lower)) {
          return `Must be one of: ${KEYTYPES.join(", ")}.`;
        }
        return null;
      },
      confirmLabel: "Generate",
    });
    if (!keytype) return;
    setGenerating(true);
    try {
      const result = await mutate(`/api/admin/pdns/zones/${zoneIdEncoded}/cryptokeys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverSlug,
          keytype: keytype.toLowerCase(),
          active: true,
        }),
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Generate failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: `Generated ${keytype.toUpperCase()}.` });
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  async function handleToggleActive(row: Row) {
    const next = !row.active;
    const ok = await confirm({
      title: `${next ? "Activate" : "Deactivate"} key ${row.id}?`,
      description: next
        ? "The key will start signing records on the next zone re-sign."
        : "The key will stop signing records but stays published in the zone. Use this for the pre-rotation deactivation step.",
      confirmLabel: next ? "Activate" : "Deactivate",
      variant: next ? "default" : "danger",
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      const result = await mutate(`/api/admin/pdns/zones/${zoneIdEncoded}/cryptokeys/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverSlug, active: next }),
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Toggle failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: `Key ${row.id} ${next ? "active" : "inactive"}.` });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(row: Row) {
    const ok = await confirm({
      title: `Delete cryptokey ${row.id}?`,
      description:
        "Permanent. If this is the only KSK, the zone becomes unsigned until another KSK is created and the parent registrar's DS records are updated. Affected validators may serve SERVFAIL during the gap.",
      confirmLabel: "Delete key",
      variant: "danger",
      dismissOnBackdrop: false,
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      const url = new URL(
        `/api/admin/pdns/zones/${zoneIdEncoded}/cryptokeys/${row.id}`,
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
      toast({ kind: "success", description: `Deleted cryptokey ${row.id}.` });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="border-border bg-background rounded-md border p-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Manage keys</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Generate, activate / deactivate, or delete cryptokeys for this zone.
          </p>
        </div>
        <button
          aria-busy={generating}
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className={buttonClass({ size: "sm" })}
        >
          Generate key
        </button>
      </header>

      {rows.length === 0 ? null : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="border-border bg-card flex flex-wrap items-center gap-2 rounded border p-2 text-xs"
            >
              <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
                {row.keytype}
              </span>
              <span className="text-muted-foreground">id {row.id}</span>
              <span className={row.active ? "text-success" : "text-muted-foreground"}>
                {row.active ? "active" : "inactive"}
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleActive(row)}
                  disabled={busyId === row.id}
                  className={buttonClass({ size: "sm" })}
                >
                  {row.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(row)}
                  disabled={busyId === row.id}
                  className={buttonClass({ variant: "destructive", size: "sm" })}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
