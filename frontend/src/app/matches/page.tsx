"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/api";

type BrokerMatchItem = {
  id: number;
  client_id: number;
  client_name: string;
  unit_external_id: string;
  project_name?: string | null;
  layout_label?: string | null;
  price_czk?: number | null;
  score: number;
};

type MatchFeedResponse = Record<string, BrokerMatchItem[]>;

export default function MatchesPage() {
  const [feed, setFeed] = useState<MatchFeedResponse>({});
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
    fetch(`${API_BASE}/brokers/match-feed`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((json: MatchFeedResponse) => {
        setFeed(json || {});
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, []);

  const clientIds = Object.keys(feed).map((id) => Number(id));

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Nové příležitosti
        </h2>
        {loading ? (
          <p className="text-sm text-slate-600">Načítání…</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : clientIds.length === 0 ? (
          <p className="text-sm text-slate-600">
            Zatím žádné nové matches. Po přepočtu a při přidání nových jednotek se zde objeví
            nové příležitosti.
          </p>
        ) : (
          <div className="space-y-4">
            {clientIds.map((cid) => {
              const items = feed[String(cid)] ?? [];
              if (!items.length) return null;
              const clientName = items[0]?.client_name ?? `Klient ${cid}`;
              return (
                <section
                  key={cid}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Klient: {clientName}
                    </h3>
                    <Link
                      href={`/clients/${cid}`}
                      className="text-xs font-medium text-slate-700 underline"
                    >
                      Otevřít klienta
                    </Link>
                  </div>
                  <ul className="space-y-1 text-xs">
                    {items.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-slate-800">{m.unit_external_id}</span>
                        <span className="text-slate-700">
                          {m.project_name ?? "Neznámý projekt"}
                        </span>
                        <span className="text-slate-700">
                          {m.layout_label ?? "—"}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {m.price_czk != null
                            ? `${m.price_czk.toLocaleString("cs-CZ")} Kč`
                            : "—"}
                        </span>
                        <span className="ml-auto text-[11px] font-semibold text-emerald-700">
                          Skóre {Math.round(m.score)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

