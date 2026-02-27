"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatAreaM2, formatCurrencyCzk } from "@/lib/format";

const API_BASE = "http://127.0.0.1:8001";

type UnitListItem = {
  external_id: string;
  unit_name: string | null;
  project?: { name?: string | null } | string | null;
  floor_area_m2: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  availability_status?: string | null;
  available?: boolean | null;
};

function renderAvailability(unit: UnitListItem): string {
  if (unit.availability_status && unit.availability_status.trim() !== "") {
    return unit.availability_status;
  }
  if (unit.available == null) return "—";
  return unit.available ? "Dostupná" : "Nedostupná";
}

export default function UnitsPage() {
  const [units, setUnits] = useState<UnitListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/units`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((json) => {
        if (cancelled) return;
        const rows: UnitListItem[] = Array.isArray(json)
          ? (json as UnitListItem[])
          : (((json as any)?.items as UnitListItem[] | undefined) ?? []);
        setUnits(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Chyba");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5 shadow-sm sm:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">Reamar</h1>
          <div className="relative z-10 flex shrink-0 items-center rounded-lg border border-gray-200 bg-gray-50/50 p-0.5">
            <Link
              href="/units"
              className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-900"
            >
              Jednotky
            </Link>
            <Link
              href="/projects"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white hover:text-gray-900"
            >
              Projekty
            </Link>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            Chyba: {error}
          </div>
        )}

        <div className="flex-1 overflow-auto p-4">
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Jednotka
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Projekt
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Podlahová plocha
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Cena
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Cena za m²
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Dostupnost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading && units.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-sm text-gray-600"
                    >
                      Načítání…
                    </td>
                  </tr>
                ) : units.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-sm text-gray-600"
                    >
                      Žádné jednotky k zobrazení.
                    </td>
                  </tr>
                ) : (
                  units.map((u) => {
                    const projectName =
                      typeof u.project === "string"
                        ? u.project
                        : u.project?.name ?? "—";

                    return (
                      <tr
                        key={u.external_id}
                        className="transition-colors hover:bg-gray-50"
                      >
                        <td className="px-4 py-2 text-sm text-gray-900">
                          <Link
                            href={`/units/${encodeURIComponent(u.external_id)}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            {u.unit_name ?? u.external_id}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {projectName}
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900">
                          {formatAreaM2(u.floor_area_m2)}
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900">
                          {formatCurrencyCzk(
                            u.price_czk != null ? Number(u.price_czk) : null
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-gray-900">
                          {formatCurrencyCzk(
                            u.price_per_m2_czk != null
                              ? Number(u.price_per_m2_czk)
                              : null
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {renderAvailability(u)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

