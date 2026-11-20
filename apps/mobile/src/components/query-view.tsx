import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describeError, isDenied } from '../lib/api-error';
import { DeniedState, ErrorState, LoadingState } from './primitives';

/** Standard loading / denied / error-with-retry handling for a query. */
export function QueryView<T>({
  query,
  loadingLabel,
  children,
}: {
  query: UseQueryResult<T>;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState {...(loadingLabel ? { label: loadingLabel } : {})} />;
  if (query.isError) {
    if (isDenied(query.error)) return <DeniedState />;
    return <ErrorState message={describeError(query.error)} onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}
