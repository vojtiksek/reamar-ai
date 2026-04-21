"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────

type SearchClient = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
};

type SearchProject = {
  id: number;
  name: string;
  district: string | null;
};

type SearchUnit = {
  id: number;
  external_id: string;
  project_id: number | null;
  project_name: string | null;
  floor: number | null;
  price_czk: number | null;
};

type SearchResults = {
  clients: SearchClient[];
  projects: SearchProject[];
  units: SearchUnit[];
};

type FlatItem =
  | { type: "client"; item: SearchClient }
  | { type: "project"; item: SearchProject }
  | { type: "unit"; item: SearchUnit };

// ── Helpers ────────────────────────────────────────────────────────────

function getHref(fi: FlatItem): string | null {
  if (fi.type === "client") return `/cases/${fi.item.id}/brief`;
  if (fi.type === "unit") return `/units/${encodeURIComponent(fi.item.external_id)}`;
  return null; // projects have no dedicated broker page
}

// ── Component ──────────────────────────────────────────────────────────

type Props = { open: boolean; onClose: () => void };

export function GlobalSearchPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset & focus when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(null);
      setSelectedIdx(0);
      // Slight delay so the DOM is visible before focus
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setResults(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const token =
        typeof window !== "undefined"
          ? window.localStorage.getItem("broker_token")
          : null;
      if (!token) return;
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/search?q=${encodeURIComponent(query.trim())}&limit=5`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          setResults(await res.json());
          setSelectedIdx(0);
        }
      } finally {
        setLoading(false);
      }
    }, 200);
  }, [query, open]);

  // Build flat item list for keyboard nav
  const flatItems: FlatItem[] = results
    ? [
        ...results.clients.map((c) => ({ type: "client" as const, item: c })),
        ...results.projects.map((p) => ({ type: "project" as const, item: p })),
        ...results.units.map((u) => ({ type: "unit" as const, item: u })),
      ]
    : [];

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, flatItems.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && flatItems[selectedIdx]) {
        const href = getHref(flatItems[selectedIdx]);
        if (href) {
          window.location.href = href;
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, flatItems, selectedIdx, onClose]);

  if (!open) return null;

  const hasResults =
    results &&
    (results.clients.length > 0 ||
      results.projects.length > 0 ||
      results.units.length > 0);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Palette */}
      <div
        role="dialog"
        aria-label="Globální vyhledávání"
        className="fixed left-1/2 top-[18vh] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Search input row */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-slate-400"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat klienta, projekt nebo jednotku…"
            className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
            autoComplete="off"
          />
          {loading && (
            <span className="text-[11px] text-slate-400">Hledám…</span>
          )}
          <kbd className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-mono text-slate-400">
            Esc
          </kbd>
        </div>

        {/* Results */}
        {hasResults && (
          <div className="max-h-80 overflow-y-auto py-1.5">
            {/* Clients */}
            {results.clients.length > 0 && (
              <section>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Klienti
                </p>
                {results.clients.map((c, i) => {
                  const idx = i;
                  const active = selectedIdx === idx;
                  return (
                    <Link
                      key={c.id}
                      href={`/cases/${c.id}/brief`}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${active ? "bg-slate-100" : "hover:bg-slate-50"}`}
                    >
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                        {c.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {c.name}
                        </p>
                        {(c.email || c.phone) && (
                          <p className="truncate text-[11px] text-slate-500">
                            {c.email ?? c.phone}
                          </p>
                        )}
                      </div>
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="shrink-0 text-slate-300"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </Link>
                  );
                })}
              </section>
            )}

            {/* Projects */}
            {results.projects.length > 0 && (
              <section>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Projekty
                </p>
                {results.projects.map((p, i) => {
                  const idx = results.clients.length + i;
                  const active = selectedIdx === idx;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 px-4 py-2.5 ${active ? "bg-slate-100" : ""}`}
                    >
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-600">
                        P
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {p.name}
                        </p>
                        {p.district && (
                          <p className="text-[11px] text-slate-500">
                            {p.district}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {/* Units */}
            {results.units.length > 0 && (
              <section>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Jednotky
                </p>
                {results.units.map((u, i) => {
                  const idx = results.clients.length + results.projects.length + i;
                  const active = selectedIdx === idx;
                  return (
                    <Link
                      key={u.id}
                      href={`/units/${encodeURIComponent(u.external_id)}`}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${active ? "bg-slate-100" : "hover:bg-slate-50"}`}
                    >
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-semibold text-emerald-600">
                        J
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {u.external_id}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {[
                            u.project_name,
                            u.floor != null ? `${u.floor}. p.` : null,
                            u.price_czk != null
                              ? `${(u.price_czk / 1_000_000).toFixed(1)} mil. Kč`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="shrink-0 text-slate-300"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </Link>
                  );
                })}
              </section>
            )}
          </div>
        )}

        {/* Empty state */}
        {results && !hasResults && (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            Nic nenalezeno pro „{query}"
          </p>
        )}

        {/* Default / hint state */}
        {!results && !loading && (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            {query.trim().length < 2
              ? "Zadejte alespoň 2 znaky…"
              : "Hledám…"}
          </p>
        )}

        {/* Footer keyboard hints */}
        <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-2">
          <span className="text-[10px] text-slate-400">
            <kbd className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
              ↑↓
            </kbd>{" "}
            navigace
          </span>
          <span className="text-[10px] text-slate-400">
            <kbd className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            otevřít
          </span>
          <span className="text-[10px] text-slate-400">
            <kbd className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
              Esc
            </kbd>{" "}
            zavřít
          </span>
        </div>
      </div>
    </>
  );
}
