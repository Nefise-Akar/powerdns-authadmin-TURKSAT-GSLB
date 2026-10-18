"use client";

/**
 * app/(app)/admin/gslb/_lib/use-gslb-fetch.ts
 *
 * `apiFetch` for the GSLB screens, plus one behaviour the shared helper
 * doesn't have: a 401 (session expired) says so and sends the operator to
 * sign in, returning to the same page - instead of a generic "Save failed".
 *
 * Deliberately scoped to the GSLB UI (the redesign exception covers it);
 * doing the same app-wide belongs in `lib/client/api-fetch.ts` as a separate
 * change.
 */

import { useCallback } from "react";
import { useDialog } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/client/api-fetch";

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

export function loginUrlForHere(): string {
  const here = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(here)}`;
}

/**
 * Returns a fetch that behaves like `apiFetch`, except that on 401 it shows
 * the expiry message, navigates to the login page and never resolves - so
 * the caller's "saving…" state simply stays until the page changes.
 */
export function useGslbFetch(): (input: string, init?: RequestInit) => Promise<Response> {
  const { toast } = useDialog();
  return useCallback(
    async (input: string, init: RequestInit = {}) => {
      const res = await apiFetch(input, init);
      if (res.status === 401) {
        toast({ kind: "error", description: SESSION_EXPIRED_MESSAGE });
        window.location.assign(loginUrlForHere());
        return new Promise<Response>(() => undefined);
      }
      return res;
    },
    [toast],
  );
}

/** `mutate`-style result on top of `useGslbFetch`. */
export function useGslbMutate(): <T = unknown>(
  input: string,
  init?: RequestInit,
) => Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const gslbFetch = useGslbFetch();
  return useCallback(
    async <T>(input: string, init: RequestInit = {}) => {
      const res = await gslbFetch(input, init);
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const error =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Unexpected error.";
        return { ok: false as const, error, status: res.status };
      }
      return { ok: true as const, data: body as T };
    },
    [gslbFetch],
  );
}
