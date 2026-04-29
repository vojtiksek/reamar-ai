import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api";
import { type FilterGroup, type FiltersResponse } from "@/lib/filters";

/**
 * Fetches filter group metadata from the given API path and returns the groups array.
 * Backed by TanStack Query: shared across all hook instances, deduplicates concurrent
 * fetches, kept in cache across navigations (staleTime/gcTime from QueryProvider).
 *
 * Filter metadata changes only on backend redeploy / data import, so a 30-min staleTime
 * is conservative — first navigation hits the network, every page swap thereafter is
 * instant from cache.
 *
 * @param path - path relative to API_BASE, e.g. "filters" or "projects/filters"
 */
// Stable empty-array fallback. Returning a fresh `[]` per render would change
// reference every time, breaking downstream useMemo/useEffect dep arrays and
// causing infinite refetch loops in consumers (e.g. UnitsExplorerPage).
const EMPTY_GROUPS: FilterGroup[] = [];

export function useFilterGroups(path: string): FilterGroup[] {
  const { data } = useQuery({
    queryKey: ["filter-groups", path],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/${path}`);
      if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
      const json = (await res.json()) as FiltersResponse;
      return json?.groups ?? [];
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });
  return data ?? EMPTY_GROUPS;
}
