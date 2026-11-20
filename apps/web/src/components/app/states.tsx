import { Card } from '@karen/ui/web';
import type { ReactNode } from 'react';
import { errorMessage, type ApiErrorBody } from '@/lib/errors';

/** Server-rendered error state for a section whose data could not load. */
export function LoadError({ what, error }: { what: string; error: ApiErrorBody | null }) {
  const denied = error?.code === 'FORBIDDEN' || error?.code === 'CONSENT_REQUIRED';
  return (
    <Card role="alert" className="space-y-2">
      <h2 className="text-base font-semibold">
        {denied ? `You don’t have access to ${what}` : `We couldn’t load ${what}`}
      </h2>
      <p className="text-sm text-muted">
        {errorMessage(error)} {error?.correlation_id ? `Reference: ${error.correlation_id}` : null}
      </p>
    </Card>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--karen-radius-md)] border border-dashed border-border p-4 text-sm text-muted">
      {children}
    </p>
  );
}

export function PageHeader({ title, intro }: { title: string; intro?: ReactNode }) {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {intro ? <p className="text-sm text-muted">{intro}</p> : null}
    </header>
  );
}

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}
