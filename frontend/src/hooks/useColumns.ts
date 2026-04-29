import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api";

/**
 * Fetches column metadata from /columns?view=… and caches it across the app.
 * Column definitions only change on backend redeploy, so cache is kept for an
 * hour. Same view across multiple pages → one network request, instant from
 * cache on every subsequent mount.
 */
// Stable empty-array reference — see comment in useFilterGroups for why a
// fresh `[]` per render breaks downstream memo/effect dep arrays.
const EMPTY: never[] = [];

export function useColumns<T = unknown>(view: "projects" | "units"): T[] {
  const { data } = useQuery({
    queryKey: ["columns", view],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/columns?view=${view}`);
      if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
      return (await res.json()) as T[];
    },
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
  });
  return (data ?? EMPTY) as T[];
}
