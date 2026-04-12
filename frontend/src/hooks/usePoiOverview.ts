import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { PoiOverview } from "@/app/projects/map/ProjectsLeafletMap";

/**
 * Fetch POI overview for a project.
 *
 * @param projectId - numeric project ID, or null to skip fetching
 * @param categories - comma-separated string or Set<string> of category slugs
 */
export function usePoiOverview(
  projectId: number | null,
  categories: Set<string> | string,
): { poiOverview: PoiOverview; loading: boolean } {
  const [poiOverview, setPoiOverview] = useState<PoiOverview>(null);
  const [loading, setLoading] = useState(false);

  const categoryString =
    typeof categories === "string"
      ? categories
      : [...categories].join(",");

  useEffect(() => {
    if (projectId == null) {
      setPoiOverview(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const url = `${API_BASE}/projects/${projectId}/walkability/poi-overview?categories=${encodeURIComponent(categoryString)}`;

    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) {
          setPoiOverview(data ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setPoiOverview(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, categoryString]);

  return { poiOverview, loading };
}
