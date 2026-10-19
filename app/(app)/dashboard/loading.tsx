/**
 * Route-transition skeleton for /dashboard.
 *
 * Rendered the moment the user clicks the dashboard link - covers the
 * gap until the streaming server response begins flushing. Without
 * this file, Next.js falls back to "nothing" while the server-side
 * data fetch (sampler probe to PDNS over WAN) blocks the first byte.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 motion-safe:animate-pulse">
      <header>
        <div className="bg-background h-8 w-72 rounded" />
        <div className="bg-background mt-2 h-4 w-96 rounded" />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-border bg-background rounded-md border p-4">
            <div className="bg-muted h-3 w-24 rounded" />
            <div className="bg-muted mt-2 h-7 w-16 rounded" />
          </div>
        ))}
      </div>

      <div className="border-border h-9 border-b">
        <div className="flex gap-6">
          <div className="bg-background h-4 w-32 rounded" />
          <div className="bg-background h-4 w-28 rounded" />
        </div>
      </div>

      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="border-border space-y-3 rounded-md border p-4">
          <div className="bg-background h-5 w-48 rounded" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="border-border bg-background rounded border p-3">
                <div className="bg-muted h-3 w-32 rounded" />
                <div className="bg-muted mt-3 h-40 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
