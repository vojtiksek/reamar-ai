"use client";

import { useCallback, useRef, useState } from "react";

type SearchResult = {
  display_name: string;
  lat: string;
  lon: string;
  place_id: number;
};

type Props = {
  onSelect: (result: { label: string; lat: number; lng: number; address: string; place_id: string }) => void;
  placeholder?: string;
  className?: string;
};

export function AddressSearch({ onSelect, placeholder = "Hledat adresu…", className = "" }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    if (q.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=cz&limit=5&accept-language=cs`,
      { headers: { "User-Agent": "Reamar/1.0" } }
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data: SearchResult[]) => {
        setResults(data);
        setOpen(data.length > 0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => search(value), 400);
  };

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
      />
      {loading && (
        <span className="absolute right-3 top-2.5 text-xs text-slate-400">…</span>
      )}
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <li key={r.place_id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  onSelect({
                    label: r.display_name.split(",")[0],
                    lat: parseFloat(r.lat),
                    lng: parseFloat(r.lon),
                    address: r.display_name,
                    place_id: String(r.place_id),
                  });
                  setQuery(r.display_name.split(",").slice(0, 2).join(","));
                  setOpen(false);
                }}
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
