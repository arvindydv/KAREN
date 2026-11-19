import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorState, Screen } from '../src/components/primitives';
import { reportError } from '../src/lib/error-reporting';
import { useTheme } from '../src/theme/theme';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  reportError(error, { boundary: 'root' });
  return (
    <Screen>
      <ErrorState message="Something went wrong. Please try again." onRetry={() => void retry()} />
    </Screen>
  );
}

export default function RootLayout() {
  const theme = useTheme();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
