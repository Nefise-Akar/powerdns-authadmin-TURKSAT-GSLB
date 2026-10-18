"use client";

/**
 * app/(app)/admin/gslb/_components/test-gslb-button.tsx
 *
 * "Test connection" for one PowerGSLB backend. Same UX shape as the PDNS
 * server and OIDC Test buttons: click → toast with the verdict → refresh so
 * the row's last-test chip picks up the new probe.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { useGslbFetch } from "../_lib/use-gslb-fetch";
import { buttonClass } from "@/components/ui/button";

interface TestResponse {
  ok: boolean;
  kind?: string;
  hint?: string;
  latencyMs?: number;
  counts?: { domains: number; monitors: number; views: number; records: number };
  requestId?: string;
}

export function TestGslbButton({
  backendId,
  label = "Test",
}: {
  backendId: string;
  label?: string;
}) {
  const router = useRouter();
  const gslbFetch = useGslbFetch();
  const { toast } = useDialog();
  const [busy, setBusy] = useState(false);

  async function handleTest() {
    setBusy(true);
    try {
      const res = await gslbFetch(`/api/admin/gslb-backends/${backendId}/test`, {
        method: "POST",
      });
      if (!res.ok) {
        toast({
          kind: "error",
          title: "Test failed to dispatch",
          description: "Check your permissions or reload the page.",
        });
        return;
      }
      const data = (await res.json()) as TestResponse;
      if (data.ok) {
        toast({
          kind: "success",
          title: `Connected in ${data.latencyMs ?? "?"} ms`,
          description: data.counts ? describeCounts(data.counts) : "Probe OK.",
        });
      } else {
        toast({
          kind: "error",
          title: `Connection failed (${data.kind ?? "unknown"})`,
          description: data.hint ?? "See server logs for details.",
        });
      }
      router.refresh();
    } catch {
      toast({ kind: "error", description: "Network error. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      aria-busy={busy}
      type="button"
      onClick={handleTest}
      disabled={busy}
      title="Sign in to the PowerGSLB admin API and count its domains, monitors, views and records."
      className={buttonClass({ size: "sm" })}
    >
      {busy ? "Testing…" : label}
    </button>
  );
}

export function describeCounts(counts: {
  domains: number;
  monitors: number;
  views: number;
  records: number;
}): string {
  return `${counts.domains} domains · ${counts.monitors} monitors · ${counts.views} views · ${counts.records} records`;
}
