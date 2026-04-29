"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Wraps the app in a TanStack Query client. Default cache config tuned for
 * the Reamar use case:
 *   - staleTime 60s — same fetch within 1 min is served from cache instantly
 *   - gcTime 5 min — kept in memory across navigations
 *   - refetchOnWindowFocus disabled — broker doesn't want a refetch every
 *     time they switch tabs back from email
 *   - retry once — Railway cold start sometimes drops the first request
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
