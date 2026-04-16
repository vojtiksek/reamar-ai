"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";

type Suggestion = { value: string; count: number };

type Props = {
  values: string[];
  onChange: (next: string[]) => void;
  scope?: "area" | "region";
  placeholder?: string;
  className?: string;
};

/**
 * Multi-select autocomplete backed by /locations/suggest.
 * Shows selected values as removable chips above the input.
 * Empty query on focus shows top suggestions by project count.
 */
export function AreaMultiSelect({
  values,
  onChange,
  scope = "area",
  placeholder = "Hledat oblast, čtvrť, město…",
  className = "",
}: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(
    (q: string) => {
      setLoading(true);
      const url = `${API_BASE}/locations/suggest?scope=${scope}&q=${encodeURIComponent(q)}&limit=20`;
      fetch(url)
        .then((r) => (r.ok ? r.json() : []))
        .then((data: Suggestion[]) => {
          // Filter out already-selected values
          setSuggestions(data);
          setOpen(true);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    },
    [scope]
  );

  const handleChange = (val: string) => {
    setQuery(val);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchSuggestions(val), 250);
  };

  const handleFocus = () => {
    if (suggestions.length === 0) fetchSuggestions(query);
    else setOpen(true);
  };

  const select = (val: string) => {
    if (!values.includes(val)) onChange([...values, val]);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const remove = (val: string) => {
    onChange(values.filter((v) => v !== val));
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = suggestions.filter((s) => !values.includes(s.value));

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Selected chips */}
      {values.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800"
            >
              {v}
              <button
                type="button"
                onClick={() => remove(v)}
                className="ml-0.5 text-indigo-400 hover:text-indigo-700"
                aria-label={`Odebrat ${v}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={values.length > 0 ? "Přidat další…" : placeholder}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
        />
        {loading && (
          <span className="absolute right-3 top-2 text-[10px] text-slate-400">…</span>
        )}
      </div>

      {/* Dropdown */}
      {open && filtered.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {filtered.map((s) => (
            <li key={s.value}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); select(s.value); }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                <span>{s.value}</span>
                <span className="ml-2 shrink-0 text-[10px] text-slate-400">{s.count} projektů</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
