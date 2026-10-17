// Fallback shown while a dashboard page checks the session and loads its
// data. Each page folder has its own loading.tsx using it: on a client
// navigation the dashboard layout stays mounted, so only a boundary inside
// the page's own segment can show.
export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200/70" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-200/60" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="surface h-20 animate-pulse" />
        ))}
      </div>
      <div className="surface h-80 animate-pulse" />
    </div>
  );
}
