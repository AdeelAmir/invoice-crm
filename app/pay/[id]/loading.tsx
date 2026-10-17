export default function Loading() {
  return (
    <main className="min-h-screen bg-page px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-slate-200/70" />
        <div className="surface h-112 animate-pulse" />
      </div>
    </main>
  );
}
