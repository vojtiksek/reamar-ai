"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import * as idb from "idb-keyval";
import { useState } from "react";

/**
 * Wraps the app in a TanStack Query client. Cache config tuned for Reamar:
 *   - staleTime 60s — same fetch within 1 min is served from cache instantly
 *   - gcTime 24h — kept in IndexedDB across navigations and page reloads
 *   - refetchOnWindowFocus disabled — broker doesn't want a refetch every
 *     time they switch tabs back from email
 *   - retry once — Railway cold start sometimes drops the first request
 *
 * Persistence:
 *   - cache is mirrored to IndexedDB (`idb-keyval` store) so a hard reload
 *     can render the previous results immediately, then revalidate in the
 *     background. We bump CACHE_BUSTER when shipping shape changes that
 *     would make old cached payloads incompatible.
 *
 * NEVER cached:
 *   - mutations (pin/feedback/override edit) — always hit the network
 *   - any query whose key includes "no-cache" — escape hatch for hot data
 */

const CACHE_BUSTER = "v1";

const indexedDBStore =
  typeof window !== "undefined"
    ? idb.createStore("reamar-react-query", "kv")
    : null;

const persister =
  typeof window !== "undefined"
    ? createAsyncStoragePersister({
        storage: {
          getItem: (key) => idb.get<string>(key, indexedDBStore!) as Promise<string>,
          setItem: (key, value) => idb.set(key, value, indexedDBStore!),
          removeItem: (key) => idb.del(key, indexedDBStore!),
        },
        key: `reamar-rq-${CACHE_BUSTER}`,
        throttleTime: 1000,
      })
    : null;

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 24 * 60 * 60_000, // 24h — required ≥ persist throttle for cache to be persisted
            refetchOnWindowFocus: false,
            // Retry transient network blips automatically. Safari often
            // reports brief Wi-Fi drops as "TypeError: Load failed" with no
            // status, and we don't want a 1s connectivity hiccup to break
            // the broker workflow. Exponential backoff: 1s, 2s, 4s.
            retry: 3,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
          },
        },
      }),
  );

  if (!persister) {
    // SSR / non-browser — render without persistence
    return (
      <PersistQueryClientProvider
        client={client}
        persistOptions={{
          persister: {
            persistClient: async () => {},
            restoreClient: async () => undefined,
            removeClient: async () => {},
          },
        }}
      >
        {children}
      </PersistQueryClientProvider>
    );
  }

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60_000,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            // Don't persist queries explicitly marked as no-cache.
            return !query.queryKey.includes("no-cache");
          },
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
