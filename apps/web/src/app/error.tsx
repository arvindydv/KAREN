'use client';

import { Button, Card } from '@karen/ui/web';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card role="alert" className="max-w-md space-y-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">
        Please try again. If this keeps happening, share this reference with support:{' '}
        {error.digest ?? 'n/a'}
      </p>
      <Button onClick={reset}>Try again</Button>
    </Card>
  );
}
