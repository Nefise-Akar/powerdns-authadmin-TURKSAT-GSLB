/**
 * Body-only loading skeleton for tab switches. Rendered as the
 * `<Suspense>` fallback that wraps the tab body - the header + tab
 * strip above stay put (they were already streamed), only this area
 * shimmers while the new tab's RSC resolves (e.g. PDNS fetch on
 * DNSSEC / Metadata).
 *
 * For synchronous tabs (records / soa / settings / history) the
 * fallback flickers very briefly or not at all - the inner JSX has
 * no async dependency to wait on.
 */

import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export function TabBodySkeleton({ tab }: { tab: string }) {
  if (tab === "dnssec") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-72" />
        <div className="border-border bg-background rounded-md border p-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="border-border space-y-3 rounded-md border p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    );
  }
  if (tab === "metadata") {
    return (
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-7 w-36" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-border rounded-md border p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-72" />
            <Skeleton className="mt-3 h-12 w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (tab === "history") {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <SkeletonTable rows={8} cols={5} />
      </div>
    );
  }
  if (tab === "settings" || tab === "soa") {
    return (
      <div className="border-border space-y-4 rounded-md border p-5">
        <Skeleton className="h-4 w-32" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    );
  }
  // records (default)
  return <SkeletonTable rows={10} cols={5} />;
}
