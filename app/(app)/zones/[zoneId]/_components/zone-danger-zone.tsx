"use client";

/**
 * Zone-deletion "Danger zone" affordance. The web UI gates the delete
 * behind:
 *
 *   1. Download a BIND zonefile backup - the operator has to actually
 *      click the button and let the file land. The confirm input
 *      doesn't unlock until that's done.
 *   2. Type the exact phrase `yes, delete <zone>` into a text input
 *      to prove they meant it.
 *
 * The API itself (`DELETE /api/admin/pdns/zones/[zoneId]`) doesn't
 * enforce either - programmatic clients are trusted to back up on
 * their own.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

interface Props {
  zoneIdEncoded: string;
  serverSlug: string;
  zoneName: string;
  canDelete: boolean;
}

export function ZoneDangerZone({ zoneIdEncoded, serverSlug, zoneName, canDelete }: Props) {
  const router = useRouter();
  const { toast } = useDialog();
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // The exact phrase the operator must type. Strip the trailing dot
  // from the canonical PDNS zone name so the phrase reads naturally -
  // `yes, delete example.com` rather than `yes, delete example.com.`.
  const cleanName = zoneName.replace(/\.$/, "");
  const requiredPhrase = `yes, delete ${cleanName}`;
  const phraseMatches = confirmText === requiredPhrase;

  async function handleDownload() {
    setDownloading(true);
    try {
      const url = `/api/admin/pdns/zones/${zoneIdEncoded}/export?serverSlug=${encodeURIComponent(serverSlug)}`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          kind: "error",
          title: "Backup download failed",
          description: data?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${cleanName}.zone`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      setDownloaded(true);
      toast({ kind: "success", description: "Backup downloaded - you can now confirm deletion." });
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    if (!phraseMatches || !downloaded) return;
    setDeleting(true);
    try {
      const url = `/api/admin/pdns/zones/${zoneIdEncoded}?serverSlug=${encodeURIComponent(serverSlug)}`;
      const result = await mutate(url, { method: "DELETE" });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Delete failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: `Zone ${cleanName} deleted.` });
      router.push(`/zones?server=${encodeURIComponent(serverSlug)}`);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  if (!canDelete) return null;

  return (
    <section className="border-destructive bg-destructive-muted rounded-md border p-5">
      <header>
        <h2 className="text-destructive text-base font-semibold">Danger zone</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Permanently delete this zone from the PowerDNS backend.{" "}
          <strong className="text-destructive">This cannot be undone.</strong> Every record, every
          comment, every metadata kind is wiped server-side. Existing DNS resolvers will keep
          serving cached answers until their TTLs expire - but new queries will fail.
        </p>
      </header>

      <ol className="mt-4 space-y-4 text-sm">
        <li>
          <div className="flex flex-wrap items-center gap-3">
            <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 w-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
              1
            </span>
            <span className="font-medium">Download a BIND zonefile backup.</span>
            <button
              aria-busy={downloading}
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className={buttonClass({ size: "sm" })}
            >
              {downloaded ? `Re-download ${cleanName}.zone` : `Download ${cleanName}.zone`}
            </button>
            {downloaded ? (
              <span className="text-success text-caption">✓ Backup saved to your downloads</span>
            ) : (
              <span className="text-muted-foreground text-caption">
                Required before delete unlocks
              </span>
            )}
          </div>
        </li>

        <li className={downloaded ? "" : "opacity-50"}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 w-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
              2
            </span>
            <span className="font-medium">
              Type <code className="bg-background rounded px-1 font-mono">{requiredPhrase}</code> to
              confirm.
            </span>
          </div>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={!downloaded}
            placeholder={requiredPhrase}
            className={`mt-2 max-w-md font-mono ${inputClass}`}
            spellCheck={false}
            autoComplete="off"
          />
        </li>

        <li>
          <button
            aria-busy={deleting}
            type="button"
            onClick={handleDelete}
            disabled={!downloaded || !phraseMatches || deleting}
            className={buttonClass({ variant: "destructive" })}
          >
            {`Permanently delete ${cleanName}`}
          </button>
        </li>
      </ol>
    </section>
  );
}
