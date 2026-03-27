"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/api";

type ClientWithoutInventoryItem = {
  client_id: number;
  client_name: string;
  budget_max: number | null;
  layouts: string[];
  area_min: number | null;
  area_max: number | null;
  matching_units: number;
  available_units: number;
};

export default function DemandAnalyticsPage() {
  const [items, setItems] = useState<ClientWithoutInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token =
      typeof window !== "undefined" ? window.localStorage.getItem("broker_token") : null;
    if (!token) {
      setError("Nejste přihlášen – prosím přejděte na /login.");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/analytics/clients-without-units`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((json: ClientWithoutInventoryItem[]) => {
        setItems(json || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="glass-header sticky top-0 z-20 mt-2 flex shrink-0 items-center justify-between gap-4 rounded-2xl px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 shrink-0">Reamar</h1>
          <div className="flex items-center rounded-full border border-white/40 bg-white/40 p-0.5 shadow-sm backdrop-blur shrink-0">
            <Link
              href="/units"
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white hover:text-slate-900"
            >
              Jednotky
            </Link>
            <Link
              href="/projects"
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white hover:text-slate-900"
            >
              Projekty
            </Link>
            <Link
              href="/clients"
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white hover:text-slate-900"
            >
              Klienti
            </Link>
            <Link
              href="/analytics/demand"
              className="rounded-full bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm"
            >
              Analytics
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-4">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Market demand insights
        </h2>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Clients with no inventory</h3>
          {loading ? (
            <p className="text-sm text-slate-600">Načítání…</p>
          ) : error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-600">
              Všichni klienti mají dostatek odpovídajících jednotek. Žádná výrazná nenaplněná
              poptávka.
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const layouts = item.layouts.length ? item.layouts.join(", ") : "—";
                const budget =
                  item.budget_max != null
                    ? `${item.budget_max.toLocaleString("cs-CZ")} Kč`
                    : "—";
                const areaRange =
                  item.area_min != null || item.area_max != null
                    ? `${item.area_min ?? "—"}–${item.area_max ?? "—"} m²`
                    : "—";
                const isHighDemand = item.available_units === 0;
                return (
                  <article
                    key={item.client_id}
                    className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-col">
                        <Link
                          href={`/clients/${item.client_id}`}
                          className="text-sm font-semibold text-slate-900 hover:underline"
                        >
                          {item.client_name}
                        </Link>
                        <div className="text-xs text-slate-600">
                          Dispozice: {layouts} · Plocha: {areaRange}
                        </div>
                        <div className="text-xs text-slate-600">Rozpočet: {budget}</div>
                      </div>
                      {isHighDemand && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                          HIGH DEMAND
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-700">
                      Matching units:{" "}
                      <span className="font-semibold">{item.matching_units}</span>{" "}
                      · Available units:{" "}
                      <span className="font-semibold">{item.available_units}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

