"use client";

import { formatAreaM2, formatCurrencyCzk } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const API_BASE = "http://127.0.0.1:8001";

type UnitRow = {
  external_id: string;
  unit_name: string | null;
  project: { name: string; [k: string]: unknown } | null;
  floor_area_m2: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  availability_status: string | null;
};

type UnitsListResponse = {
  items: UnitRow[];
  total: number;
  limit: number;
  offset: number;
};

const DEFAULT_LIMIT = 100;

export default function UnitsListPage() {
  const router = useRouter();
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("limit", String(DEFAULT_LIMIT));
    params.set("offset", String(offset));
    fetch(`${API_BASE}/units?${params}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((json: UnitsListResponse) => {
        setUnits(json.items ?? []);
        setTotal(json.total ?? 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, [offset]);

  const showFrom = total === 0 ? 0 : offset + 1;
  const showTo = total === 0 ? 0 : Math.min(offset + DEFAULT_LIMIT, total);
  const currentPage = total === 0 ? 0 : Math.floor(offset / DEFAULT_LIMIT) + 1;
  const totalPages = total === 0 ? 0 : Math.ceil(total / DEFAULT_LIMIT) || 1;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-2 shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900">Reamar</h1>
          <div className="flex items-center rounded-lg border border-gray-300 p-0.5">
            <button
              type="button"
              className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white"
            >
              Jednotky
            </button>
            <button
              type="button"
              onClick={() => router.push("/projects")}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              Projekty
            </button>
          </div>
        </div>
        <span className="text-xs text-gray-500">
          {showFrom}–{showTo} z {total}
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
        <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
          <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded border border-gray-200">
            <div className="sticky top-0 z-[1] flex items-center justify-end gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
              <button
                type="button"
                onClick={() => setOffset(Math.max(0, offset - DEFAULT_LIMIT))}
                disabled={offset <= 0 || loading}
                className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50 hover:bg-gray-100"
              >
                Předchozí
              </button>
              <span className="text-sm text-gray-600">
                Strana {currentPage} z {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setOffset(offset + DEFAULT_LIMIT)}
                disabled={offset + DEFAULT_LIMIT >= total || loading}
                className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50 hover:bg-gray-100"
              >
                Další
              </button>
            </div>
            <table className="min-w-full border-collapse">
              <thead className="sticky top-[45px] z-[1] bg-gray-100">
                <tr>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-700">Jednotka</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-700">Projekt</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-right text-sm font-medium text-gray-700">Podlahová plocha</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-right text-sm font-medium text-gray-700">Cena</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-right text-sm font-medium text-gray-700">Cena za m²</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-700">Dostupnost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {loading && units.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                      Načítání…
                    </td>
                  </tr>
                ) : units.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                      Žádné jednotky k zobrazení.
                    </td>
                  </tr>
                ) : (
                  units.map((u) => (
                    <tr
                      key={u.external_id}
                      onClick={() => router.push(`/units/${encodeURIComponent(u.external_id)}`)}
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <td className="px-3 py-2 text-sm">{u.unit_name ?? u.external_id}</td>
                      <td className="px-3 py-2 text-sm">{u.project?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-sm">{formatAreaM2(u.floor_area_m2)}</td>
                      <td className="px-3 py-2 text-right text-sm">{formatCurrencyCzk(u.price_czk)}</td>
                      <td className="px-3 py-2 text-right text-sm">{formatCurrencyCzk(u.price_per_m2_czk)}</td>
                      <td className="px-3 py-2 text-sm">{u.availability_status ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
