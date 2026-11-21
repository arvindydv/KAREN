export default function AppLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-48 animate-pulse rounded-[var(--karen-radius-sm)] bg-surface" />
      <div className="h-32 animate-pulse rounded-[var(--karen-radius-lg)] bg-surface" />
    </div>
  );
}
