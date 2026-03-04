"use client";

import { API_BASE } from "@/lib/api";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Comparable = {
  external_id: string;
  project_name: string | null;
  price_per_m2_czk: number | null;
  floor_area_m2: number | null;
  distance_m: number;
  availability_status: string | null;
  available: boolean;
  renovation: boolean | null;
};

type DebugData = {
  unit_external_id: string;
  radius_m: number;
  group: string | null;
  bucket_label: string | null;
  bucket_min_area_m2: number | null;
  bucket_max_area_m2: number | null;
  unit_price_per_m2_czk: number | null;
  ref_avg_price_per_m2_czk: number | null;
  diff_percent: number | null;
  unit_renovation: boolean | null;
  comparables: Comparable[];
};

export default function DebugComparePage() {
  const searchParams = useSearchParams();
  const externalId = searchParams?.get("external_id") ?? "";
  const radiusParam = searchParams?.get("radius_m");
  const radius = radiusParam ? Math.max(500, Math.min(2000, Number(radiusParam))) : 500;

  const [data, setData] = useState<DebugData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!externalId) {
      setError("Chybí parametr external_id");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/units/${encodeURIComponent(externalId)}/local-price-diff-debug?radius_m=${radius}`
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as DebugData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při načítání");
    } finally {
      setLoading(false);
    }
  }, [externalId, radius]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (!externalId) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-4xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Srovnání ceny s trhem</h1>
          <p className="mt-2 text-sm text-gray-600">
            V URL chybí parametr <code className="rounded bg-gray-100 px-1">external_id</code>.
            Použijte odkaz z tabulky jednotek (klik na procento odchylky).
          </p>
          <Link
            href="/units"
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline"
          >
            ← Zpět na jednotky
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-base font-semibold text-gray-900 sm:text-lg">
              Jednotky pro srovnání ceny
              {data?.bucket_label != null && (
                <span className="ml-2 font-normal text-gray-600">
                  – {data.bucket_label}
                </span>
              )}
            </h1>
            <Link
              href="/units"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              ← Zpět na jednotky
            </Link>
          </div>
        </div>

        {loading && (
          <div className="px-4 py-12 text-center text-sm text-gray-600 sm:px-6">
            Načítám srovnávací jednotky…
          </div>
        )}

        {error && (
          <div className="px-4 py-6 sm:px-6">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => void fetchData()}
              className="mt-2 text-sm font-medium text-blue-600 hover:underline"
            >
              Zkusit znovu
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div className="border-b border-gray-100 bg-gray-50/80 px-4 py-3 text-sm text-gray-800 sm:px-6">
              <div className="grid gap-1 sm:grid-cols-2">
                <p>
                  <span className="font-medium">Jednotka:</span>{" "}
                  <span className="font-mono text-gray-900">{data.unit_external_id}</span>
                  {data.unit_price_per_m2_czk != null && (
                    <> – cena {Math.round(data.unit_price_per_m2_czk).toLocaleString("cs-CZ")} Kč/m²</>
                  )}
                </p>
                <p>
                  <span className="font-medium">Referenční průměr</span> v okruhu{" "}
                  {Math.round(data.radius_m).toLocaleString("cs-CZ")} m:{" "}
                  {data.ref_avg_price_per_m2_czk != null ? (
                    <span className="text-gray-900">
                      {Math.round(data.ref_avg_price_per_m2_czk).toLocaleString("cs-CZ")} Kč/m²
                    </span>
                  ) : (
                    "není k dispozici"
                  )}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-medium">Odchylka:</span>{" "}
                  {data.diff_percent != null ? (
                    <span
                      className={
                        data.diff_percent > 0
                          ? "font-semibold text-red-600"
                          : data.diff_percent < 0
                            ? "font-semibold text-green-600"
                            : "text-gray-900"
                      }
                    >
                      {data.diff_percent > 0 ? "+" : ""}
                      {data.diff_percent.toFixed(2)} %
                    </span>
                  ) : (
                    "—"
                  )}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-medium">Porovnání jen s jednotkami:</span>{" "}
                  {data.unit_renovation === true
                    ? "rekonstrukce"
                    : data.unit_renovation === false
                      ? "novostavba"
                      : "—"}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              {data.comparables.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-600 sm:px-6">
                  V daném okruhu a bucketu nejsou žádné srovnatelné jednotky.
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-800">
                        Jednotka
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-800">
                        Projekt
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold text-gray-800">
                        Cena / m²
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold text-gray-800">
                        Plocha
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold text-gray-800">
                        Vzdálenost
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-800">
                        Rekonstrukce
                      </th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-800">
                        Stav
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.comparables.map((c) => (
                      <tr key={c.external_id} className="bg-white text-gray-900">
                        <td className="px-4 py-2 font-mono text-gray-900">
                          {c.external_id}
                        </td>
                        <td className="px-4 py-2 text-gray-800">
                          {c.project_name ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-900">
                          {c.price_per_m2_czk != null
                            ? `${Math.round(c.price_per_m2_czk).toLocaleString("cs-CZ")} Kč/m²`
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-800">
                          {c.floor_area_m2 != null
                            ? `${c.floor_area_m2.toFixed(1)} m²`
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-800">
                          {Math.round(c.distance_m).toLocaleString("cs-CZ")} m
                        </td>
                        <td className="px-4 py-2 text-gray-800">
                          {c.renovation === true
                            ? "rekonstrukce"
                            : c.renovation === false
                              ? "novostavba"
                              : "—"}
                        </td>
                        <td className="px-4 py-2 text-gray-800">
                          {c.availability_status ?? (c.available ? "dostupná" : "prodaná")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
