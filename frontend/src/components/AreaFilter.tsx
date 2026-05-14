"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";

export type Area = {
  id: number;
  name: string;
  display_name?: string | null;
  project_count?: number;
};

type SuggestItem = {
  label: string;
  address?: string | null;
  lat: number | null;
  lng: number | null;
  result_type?: string | null;
};

type Props = {
  /** Areas the user wants to include (OR). */
  included: Area[];
  /** Areas the user wants to exclude (NOT). */
  excluded: Area[];
  /** Fired when the broker adds/removes a chip or flips include↔exclude. */
  onChange: (next: { included: Area[]; excluded: Area[] }) => void;
  className?: string;
};

const AREA_RESULT_TYPES = new Set([
  "locality",
  "administrativeArea",
  "district",
  "country",
  "subdistrict",
]);

function authHeader(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Unified "Oblast" filter — typeahead chips with include / exclude toggle.
 *
 * Replaces the legacy six text fields (city, district, municipality, postal
 * code, etc.) with one geographic filter backed by boundary_areas + PostGIS.
 *
 * The component is purely presentational w.r.t. URL state — the parent
 * (FiltersDrawer / MapExplorerPage / etc.) is responsible for persisting
 * the area ids to the URL and re-hydrating them on load.
 */
export function AreaFilter({ included, excluded, onChange, className }: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced autosuggest. Reuses the same /geocode/suggest endpoint the map
  // page already uses for address typeahead — HERE returns admin-area
  // results alongside street addresses, so we filter to "area-shaped" types.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/geocode/suggest?q=${encodeURIComponent(q)}`, {
          headers: authHeader(),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { results?: SuggestItem[] };
        if (cancelled) return;
        // Only keep suggestions that look like a geographic area; addresses
        // don't make sense for this filter.
        const filtered = (data.results ?? []).filter(
          (s) => s.result_type && AREA_RESULT_TYPES.has(s.result_type),
        );
        setSuggestions(filtered.length ? filtered : data.results ?? []);
      } catch {
        /* silent — input still works via free-text submit */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const allSelected = useMemo(
    () => [...included, ...excluded].map((a) => a.id),
    [included, excluded],
  );

  const handlePick = useCallback(
    async (s: SuggestItem) => {
      setError(null);
      setResolving(true);
      try {
        // /areas/resolve normalises the free-text name into a cached boundary
        // row + returns the polygon + project count. Hits Nominatim on cache
        // miss; subsequent picks of the same area are instant.
        const res = await fetch(`${API_BASE}/areas/resolve`, {
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: s.label }),
        });
        if (!res.ok) {
          if (res.status === 404) {
            setError("Oblast nenalezena v OSM");
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          id: number;
          name: string;
          display_name?: string | null;
          project_count?: number;
        };
        if (allSelected.includes(data.id)) {
          // already in the list — don't duplicate, just clear input
        } else {
          onChange({
            included: [...included, {
              id: data.id,
              name: data.name,
              display_name: data.display_name ?? null,
              project_count: data.project_count,
            }],
            excluded,
          });
        }
        setQuery("");
        setSuggestions([]);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chyba načítání oblasti");
      } finally {
        setResolving(false);
      }
    },
    [included, excluded, onChange, allSelected],
  );

  const removeArea = useCallback(
    (id: number, from: "include" | "exclude") => {
      if (from === "include") {
        onChange({ included: included.filter((a) => a.id !== id), excluded });
      } else {
        onChange({ included, excluded: excluded.filter((a) => a.id !== id) });
      }
    },
    [included, excluded, onChange],
  );

  const flipExclude = useCallback(
    (id: number, from: "include" | "exclude") => {
      if (from === "include") {
        const found = included.find((a) => a.id === id);
        if (!found) return;
        onChange({
          included: included.filter((a) => a.id !== id),
          excluded: [...excluded, found],
        });
      } else {
        const found = excluded.find((a) => a.id === id);
        if (!found) return;
        onChange({
          included: [...included, found],
          excluded: excluded.filter((a) => a.id !== id),
        });
      }
    },
    [included, excluded, onChange],
  );

  const placeholder = included.length + excluded.length > 0
    ? "Přidat další oblast…"
    : "Hledat oblast (např. Praha 8)…";

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setError(null); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          aria-label="Hledat oblast"
          autoComplete="off"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
        {resolving && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            Načítám…
          </span>
        )}
        {open && suggestions.length > 0 && (
          <ul
            className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
            role="listbox"
          >
            {suggestions.map((s, i) => (
              <li key={`${s.label}-${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handlePick(s)}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                >
                  <div className="truncate font-medium">{s.label}</div>
                  {s.address && s.address !== s.label && (
                    <div className="truncate text-[11px] text-slate-500">{s.address}</div>
                  )}
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {s.result_type ?? ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <div className="text-xs text-rose-600">{error}</div>}
      {(included.length > 0 || excluded.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {included.map((a) => (
            <AreaChip key={`inc-${a.id}`} area={a} mode="include"
              onRemove={() => removeArea(a.id, "include")}
              onToggleExclude={() => flipExclude(a.id, "include")}
            />
          ))}
          {excluded.map((a) => (
            <AreaChip key={`exc-${a.id}`} area={a} mode="exclude"
              onRemove={() => removeArea(a.id, "exclude")}
              onToggleExclude={() => flipExclude(a.id, "exclude")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AreaChip({
  area, mode, onRemove, onToggleExclude,
}: {
  area: Area;
  mode: "include" | "exclude";
  onRemove: () => void;
  onToggleExclude: () => void;
}) {
  const isExclude = mode === "exclude";
  const colorClass = isExclude
    ? "bg-rose-50 border-rose-200 text-rose-700"
    : "bg-sky-50 border-sky-200 text-sky-700";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${colorClass}`}>
      {isExclude && <span className="font-semibold">–</span>}
      <span className="font-medium">{area.name}</span>
      {typeof area.project_count === "number" && (
        <span className="text-[10px] opacity-75">({area.project_count})</span>
      )}
      <button
        type="button"
        onClick={onToggleExclude}
        title={isExclude ? "Přepnout na zahrnout" : "Přepnout na vyloučit"}
        className="ml-0.5 rounded px-1 text-[10px] opacity-75 hover:opacity-100"
      >
        {isExclude ? "+" : "−"}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Odebrat oblast"
        title="Odebrat"
        className="ml-0.5 rounded text-sm leading-none opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </span>
  );
}
