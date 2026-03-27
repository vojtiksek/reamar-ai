import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { type FilterGroup, type FiltersResponse } from "@/lib/filters";

/** Module-level cache shared across all hook instances. Keyed by path. */
const cache = new Map<string, FilterGroup[]>();

/**
 * Fetches filter group metadata from the given API path and returns the groups array.
 * Results are cached in memory for the lifetime of the page — subsequent calls with
 * the same path return immediately from cache without refetching.
 *
 * @param path - path relative to API_BASE, e.g. "filters" or "projects/filters"
 */
export function useFilterGroups(path: string): FilterGroup[] {
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>(
    () => cache.get(path) ?? []
  );

  useEffect(() => {
    if (cache.has(path)) return;
    fetch(`${API_BASE}/${path}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: FiltersResponse) => {
        const groups = data?.groups ?? [];
        cache.set(path, groups);
        setFilterGroups(groups);
      })
      .catch(() => setFilterGroups([]));
  }, [path]);

  return filterGroups;
}
