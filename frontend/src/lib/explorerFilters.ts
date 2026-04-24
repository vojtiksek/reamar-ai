/**
 * Persistence vrstva pro filtry v Exploreru (Projekty / Jednotky / Mapa).
 *
 * Záměr:
 *  - Když broker nastaví filtr v jedné Explorer záložce, po přejetí na další
 *    zůstává aktivní (URL navigace mezi záložkami jinak filtry neprenáší).
 *  - Zůstává i po odhlášení a přihlášení (pevně uložený v localStorage, bez vazby
 *    na token/session).
 *  - Zruší se jen explicitním Reset tlačítkem.
 *
 * Rozsah: pouze 3 Explorer stránky. Ostatní moduly (klienti, admin, scoring, ...)
 * tento storage nečtou ani nezapisují.
 *
 * Perzistují se POUZE filtry (CurrentFilters). Ne polygon, řazení, paging —
 * ty jsou kontextové pro konkrétní záložku.
 */

import type { CurrentFilters } from "./filters";

const STORAGE_KEY = "reamar_explorer_filters";
const POLYGON_KEY = "reamar_explorer_polygon";

/** Parametry URL, které NEJSOU filtry (a při hydrataci je ignorujeme). */
const NON_FILTER_PARAMS = new Set(["limit", "offset", "sort_by", "sort_dir", "poly"]);

export function saveExplorerFilters(filters: CurrentFilters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // localStorage může být nedostupný (privátní režim, quota) — ignoruj.
  }
}

export function loadExplorerFilters(): CurrentFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CurrentFilters;
    }
  } catch {
    // Poškozená data — tváříme se, že tam nic není.
  }
  return null;
}

export function clearExplorerFilters(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignoruj
  }
}

/**
 * Vrací true, pokud URL už obsahuje nějaký filtr-like parametr
 * (cokoliv jiného než limit/offset/sort/poly). Používá se k rozhodnutí,
 * jestli má smysl hydratovat z localStorage, nebo URL už "vyhrála".
 */
export function urlHasAnyFilterParam(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (!NON_FILTER_PARAMS.has(key)) return true;
  }
  return false;
}

/** True pokud je filtr objekt reálně prázdný (bez klíčů). */
export function isEmptyFilters(filters: CurrentFilters): boolean {
  return Object.keys(filters).length === 0;
}

/**
 * Polygon se perzistuje jako zakódovaný string (ten, který používáme v URL ?poly=).
 * Hodnota null/prázdný string = žádný polygon.
 */
export function saveExplorerPolygon(encoded: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (encoded && encoded.trim() !== "") {
      window.localStorage.setItem(POLYGON_KEY, encoded);
    } else {
      window.localStorage.removeItem(POLYGON_KEY);
    }
  } catch {
    // ignoruj
  }
}

export function loadExplorerPolygon(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(POLYGON_KEY);
    if (!raw || raw.trim() === "") return null;
    return raw;
  } catch {
    return null;
  }
}

export function clearExplorerPolygon(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(POLYGON_KEY);
  } catch {
    // ignoruj
  }
}
