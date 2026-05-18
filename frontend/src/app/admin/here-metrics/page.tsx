"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarCard, ReamarButton, StatCard } from "@/components/ui/reamar-ui";

type LiveSnapshot = {
  counters: Record<string, number>;
  ttl_days: {
    geocode_cache: number;
    commute_cache: number;
  };
  cache_size: {
    geocode_cache_rows: number;
    geocode_cache_written_24h: number;
    commute_cache_rows: number;
    commute_cache_written_24h: number;
  };
  note?: string;
};

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const COUNTER_LABELS: Record<string, string> = {
  "geocode.address.here_call": "HERE Geocoding — volání",
  "geocode.address.cache_hit": "HERE Geocoding — cache hit",
  "geocode.suggest.here_call": "HERE Autosuggest — volání",
  "geocode.suggest.cache_hit": "HERE Autosuggest — cache hit",
  "transit.here_call": "HERE Transit — volání",
  "transit.cache_hit": "HERE Transit — cache hit",
};

const COUNTER_ORDER = [
  "geocode.address.here_call",
  "geocode.address.cache_hit",
  "geocode.suggest.here_call",
  "geocode.suggest.cache_hit",
  "transit.here_call",
  "transit.cache_hit",
];

function hitRate(hits: number, calls: number): string {
  const total = hits + calls;
  if (total === 0) return "—";
  return `${Math.round((hits / total) * 100)} %`;
}

export default function HereMetricsPage() {
  const [data, setData] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/here-metrics/live`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Backend vrátil ${res.status}`);
      }
      const json = (await res.json()) as LiveSnapshot;
      setData(json);
      setError(null);
      setLastFetched(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neznámá chyba");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const counters = data?.counters ?? {};
  const totalHereCalls =
    (counters["geocode.address.here_call"] ?? 0) +
    (counters["geocode.suggest.here_call"] ?? 0) +
    (counters["transit.here_call"] ?? 0);
  const totalCacheHits =
    (counters["geocode.address.cache_hit"] ?? 0) +
    (counters["geocode.suggest.cache_hit"] ?? 0) +
    (counters["transit.cache_hit"] ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">HERE API metriky</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Živý stav HERE billingu — geocoding, autosuggest, transit. Auto-refresh po 30 s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-[11px] text-slate-500">
              Načteno {lastFetched.toLocaleTimeString("cs-CZ")}
            </span>
          )}
          <ReamarButton size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </ReamarButton>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          Načítání selhalo: {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Celkem HERE volání"
          value={totalHereCalls.toLocaleString("cs-CZ")}
          sublabel="od startu backend workeru"
        />
        <StatCard
          label="Celkem cache hitů"
          value={totalCacheHits.toLocaleString("cs-CZ")}
          sublabel="ušetřená HERE volání"
        />
        <StatCard
          label="Hit rate"
          value={hitRate(totalCacheHits, totalHereCalls)}
          sublabel="čím vyšší, tím lépe"
        />
      </div>

      <ReamarCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Countery podle endpointu</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Process-local — resetuje se při restartu / redeployi backendu.
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Metrika</th>
                <th className="px-3 py-2 text-right font-semibold">Počet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {COUNTER_ORDER.map((key) => {
                const value = counters[key] ?? 0;
                const isCall = key.endsWith("here_call");
                return (
                  <tr key={key}>
                    <td className="px-3 py-2 text-slate-700">
                      {COUNTER_LABELS[key] ?? key}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        isCall && value > 0
                          ? "text-rose-700"
                          : value > 0
                          ? "text-emerald-700"
                          : "text-slate-400"
                      }`}
                    >
                      {value.toLocaleString("cs-CZ")}
                    </td>
                  </tr>
                );
              })}
              {Object.keys(counters)
                .filter((k) => !COUNTER_ORDER.includes(k))
                .map((k) => (
                  <tr key={k}>
                    <td className="px-3 py-2 text-slate-700">{k}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                      {(counters[k] ?? 0).toLocaleString("cs-CZ")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </ReamarCard>

      <ReamarCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Cache v DB</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Persistent cache v Postgresu — přežije restart backendu.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              geocode_cache
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {(data?.cache_size.geocode_cache_rows ?? 0).toLocaleString("cs-CZ")}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {(data?.cache_size.geocode_cache_written_24h ?? 0).toLocaleString("cs-CZ")} zapsáno
              za 24 h · TTL {data?.ttl_days.geocode_cache ?? "—"} dní
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              commute_cache
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {(data?.cache_size.commute_cache_rows ?? 0).toLocaleString("cs-CZ")}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {(data?.cache_size.commute_cache_written_24h ?? 0).toLocaleString("cs-CZ")} zapsáno
              za 24 h · TTL {data?.ttl_days.commute_cache ?? "—"} dní
            </div>
          </div>
        </div>
      </ReamarCard>

      {data?.note && (
        <p className="text-[11px] text-slate-500">{data.note}</p>
      )}
    </div>
  );
}
