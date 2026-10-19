"use client";

/**
 * app/(app)/admin/servers/_components/server-actions.tsx
 *
 * Test-connection + delete buttons for the edit page. Calls the admin routes
 * directly and renders the response inline.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { apiFetch, mutate } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";

interface ServerActionsProps {
  id: string;
}

interface TestResponse {
  ok: boolean;
  /**
   * Coarse classification on failure: `auth | reachable | unreachable |
   * unknown`. The server intentionally does NOT return the raw upstream
   * error (S-12) - operators correlate via `requestId` against the
   * server-side log.
   */
  kind?: "auth" | "reachable" | "unreachable" | "unknown";
  /** Static human-readable hint per kind. Safe to render verbatim. */
  hint?: string;
  /** Echoed from the middleware so operators can join the log line. */
  requestId?: string | null;
  persisted?: boolean;
  cache?: {
    version: string;
    /**
     * Both optional on purpose. `listZones` (the reachability probe) can
     * succeed while the version probe fails, and a backend that has never been
     * probed has no snapshot at all - so a successful test legitimately comes
     * back with nothing but a version. Rendering these unconditionally is what
     * threw "Cannot read properties of undefined (reading 'supportsExtendPrune')".
     */
    serverId?: string;
    capabilities?: {
      supportsExtendPrune: boolean;
      supportsCatalogZones: boolean;
      supportsViews: boolean;
    };
  };
}

export function ServerActions({ id }: ServerActionsProps) {
  const router = useRouter();
  const { confirm, toast } = useDialog();
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await apiFetch(`/api/admin/pdns-servers/${id}/test`, {
        method: "POST",
      });
      const data = (await res.json()) as TestResponse;
      setResult(data);
      if (data.ok) router.refresh();
    } catch {
      setResult({
        ok: false,
        kind: "unknown",
        hint: "Network error during connection test.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete this PowerDNS server?",
      description:
        "Audit history is preserved. Zones on this backend will no longer be reachable through the UI.",
      confirmLabel: "Delete server",
      variant: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const result = await mutate(`/api/admin/pdns-servers/${id}`, {
        method: "DELETE",
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Delete failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: "Server deleted." });
      router.push("/admin/servers");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="border-border bg-background space-y-4 rounded-md border p-5">
      <header>
        <h2 className="text-sm font-medium">Diagnostics</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Test the connection to verify credentials and capability flags.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <button
          aria-busy={testing}
          type="button"
          onClick={handleTest}
          disabled={testing}
          className={buttonClass()}
        >
          Test connection
        </button>
        <button
          aria-busy={deleting}
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={buttonClass({ variant: "destructive", className: "ml-auto" })}
        >
          Delete
        </button>
      </div>

      {result ? (
        <div
          className={[
            "rounded-md border p-3 text-sm",
            result.ok ? "border-success bg-background" : "border-destructive bg-destructive-muted",
          ].join(" ")}
        >
          {result.ok ? (
            <>
              <div className="font-medium">Connection OK</div>
              {result.cache ? (
                <ul className="mt-2 list-disc pl-5 text-xs">
                  <li>PowerDNS version: {result.cache.version}</li>
                  {result.cache.serverId ? <li>Server id: {result.cache.serverId}</li> : null}
                  {result.cache.capabilities ? (
                    <>
                      <li>
                        EXTEND/PRUNE: {result.cache.capabilities.supportsExtendPrune ? "yes" : "no"}
                      </li>
                      <li>
                        Catalog zones:{" "}
                        {result.cache.capabilities.supportsCatalogZones ? "yes" : "no"}
                      </li>
                      <li>
                        Views (split-horizon):{" "}
                        {result.cache.capabilities.supportsViews ? "yes" : "no"}
                      </li>
                    </>
                  ) : (
                    <li>Capabilities: not probed yet - reachable, but the version probe failed.</li>
                  )}
                </ul>
              ) : null}
              {result.persisted ? (
                <p className="mt-2 text-xs">Snapshot persisted to the row.</p>
              ) : null}
            </>
          ) : (
            <>
              <div className="font-medium">
                Connection failed{result.kind ? ` (${result.kind})` : ""}
              </div>
              <p className="mt-1 text-xs">{result.hint ?? "Unknown error."}</p>
              {result.requestId ? (
                <p className="text-muted-foreground text-mono-xs mt-2 font-mono">
                  request-id: {result.requestId}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
