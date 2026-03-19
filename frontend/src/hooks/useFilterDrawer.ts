import { useCallback, useState } from "react";
import type { CurrentFilters } from "@/lib/filters";

/**
 * Manages the filter drawer's local state:
 * - whether the drawer is open
 * - the in-progress filter edits (currentFilters)
 * - helpers shared across all three pages: openDrawer, closeDrawer, onReset, onChangeFilter
 *
 * onApply and onResetAll intentionally stay outside this hook — they differ across pages
 * (different URL sync strategies and side-effects).
 *
 * @param seedFilters - the filter values to copy into currentFilters when opening the drawer.
 *   Units/projects pass their local `filters` state; map passes `filtersInUrl` from the URL.
 */
export function useFilterDrawer(seedFilters: CurrentFilters) {
  const [currentFilters, setCurrentFilters] = useState<CurrentFilters>({});
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => {
    setCurrentFilters({ ...seedFilters });
    setDrawerOpen(true);
  }, [seedFilters]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const onReset = useCallback(() => setCurrentFilters({}), []);

  const onChangeFilter = useCallback(
    (key: string, value: number | number[] | string[] | boolean | undefined) => {
      setCurrentFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return { currentFilters, drawerOpen, openDrawer, closeDrawer, onReset, onChangeFilter };
}
