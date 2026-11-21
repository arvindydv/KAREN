import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppLockGate } from '../src/auth/app-lock';
import { ServicesProvider, getDefaultServices } from '../src/auth/services';
import { ErrorState, Screen } from '../src/components/primitives';
import { ApiRequestError, NetworkError } from '../src/lib/api-error';
import { reportError } from '../src/lib/error-reporting';
import { ensureCryptoRandomUuid } from '../src/lib/uuid';
import { useTheme } from '../src/theme/theme';

// Hermes lacks crypto.randomUUID, which the shared API client uses for x-request-id.
ensureCryptoRandomUuid();

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  reportError(error, { boundary: 'root' });
  return (
    <Screen>
      <ErrorState message="Something went wrong. Please try again." onRetry={() => void retry()} />
    </Screen>
  );
}

/** Retry only transient failures; never retry 4xx (auth, validation, denied). */
const shouldRetry = (failureCount: number, error: unknown): boolean =>
  failureCount < 2 &&
  (error instanceof NetworkError || (error instanceof ApiRequestError && error.retryable));

export default function RootLayout() {
  const theme = useTheme();
  const [services] = useState(getDefaultServices);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetry } },
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ServicesProvider services={services}>
          <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
          <AppLockGate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.background },
              }}
            />
          </AppLockGate>
        </ServicesProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
