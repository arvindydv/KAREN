'use client';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="p-8">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">Reference: {error.digest ?? 'n/a'}</p>
      <button type="button" onClick={reset} className="mt-4 underline">
        Try again
      </button>
    </div>
  );
}
