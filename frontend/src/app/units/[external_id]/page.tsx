"use client";

import { formatAreaM2, formatCurrencyCzk, formatLayout } from "@/lib/format";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const API = "http://127.0.0.1:8001";

type Unit = {
  external_id: string;
  project: { name: string };
  unit_name: string | null;
  layout: string | null;
  floor_area_m2: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  available: boolean;
};

type PriceHistoryEntry = {
  captured_at: string;
  price_czk: number | null;
};

export default function UnitDetailPage() {
  const params = useParams();
  const router = useRouter();
  const external_id = params.external_id as string;

  const [unit, setUnit] = useState<Unit | null>(null);
  const [history, setHistory] = useState<PriceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!external_id) return;
    const id = decodeURIComponent(external_id);
    Promise.all([
      fetch(`${API}/units/${encodeURIComponent(id)}`).then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText)))),
      fetch(`${API}/units/${encodeURIComponent(id)}/price-history`).then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText)))),
    ])
      .then(([u, h]) => {
        setUnit(u);
        setHistory(Array.isArray(h) ? h : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [external_id]);

  if (loading) return <div className="p-4">Načítání…</div>;
  if (error) return <div className="p-4 text-red-600">Chyba: {error}</div>;
  if (!unit) return null;

  const chartData = history
    .filter((e) => e.price_czk != null)
    .map((e) => ({
      captured_at: new Date(e.captured_at).toLocaleDateString("cs-CZ", { month: "short", day: "numeric", year: "2-digit" }),
      price_czk: e.price_czk,
    }))
    .reverse();

  return (
    <div className="p-4">
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-4 text-sm text-gray-600 underline hover:text-gray-800"
      >
        ← Zpět
      </button>
      <h1 className="mb-4 text-xl font-semibold">{unit.unit_name ?? unit.external_id}</h1>
      <dl className="mb-6 grid gap-2 text-sm">
        <div><dt className="font-medium text-gray-500">Projekt</dt><dd>{unit.project?.name ?? "—"}</dd></div>
        <div><dt className="font-medium text-gray-500">Název jednotky</dt><dd>{unit.unit_name ?? "—"}</dd></div>
        <div><dt className="font-medium text-gray-500">Dispozice</dt><dd>{formatLayout(unit.layout)}</dd></div>
        <div><dt className="font-medium text-gray-500">Podlahová plocha</dt><dd>{formatAreaM2(unit.floor_area_m2)}</dd></div>
        <div><dt className="font-medium text-gray-500">Cena</dt><dd>{formatCurrencyCzk(unit.price_czk)}</dd></div>
        <div><dt className="font-medium text-gray-500">Cena za m²</dt><dd>{formatCurrencyCzk(unit.price_per_m2_czk)}</dd></div>
        <div>
          <dt className="font-medium text-gray-500">Dostupnost</dt>
          <dd className={unit.available ? "text-green-600" : "text-red-600"}>{unit.available ? "ANO" : "NE"}</dd>
        </div>
      </dl>
      <h2 className="mb-2 text-lg font-medium">Historie ceny</h2>
      <div className="h-80 w-full max-w-2xl">
        {chartData.length === 0 ? (
          <p className="text-gray-500">Žádná historie cen.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="captured_at" />
              <YAxis tickFormatter={(v) => formatCurrencyCzk(v)} />
              <Tooltip formatter={(v) => [formatCurrencyCzk(v as number), "Cena"]} />
              <Line type="monotone" dataKey="price_czk" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
