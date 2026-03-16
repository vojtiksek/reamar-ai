"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/api";

type ClientSummary = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  broker_id: number;
  created_at: string;
  updated_at: string;
  recommendations_count: number;
};

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchCount, setMatchCount] = useState<number>(0);

  useEffect(() => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("broker_token") : null;
    if (!token) {
      setError("Nejste přihlášen – prosím přejděte na /login.");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/clients`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: ClientSummary[]) => {
        setClients(data ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));

    fetch(`${API_BASE}/brokers/match-feed`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((json: Record<string, unknown[]>) => {
        const total = Object.values(json || {}).reduce(
          (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
          0,
        );
        setMatchCount(total);
      })
      .catch(() => {
        // best-effort, ignore
      });
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="mt-2 flex items-center justify-end gap-2 px-4">
          <Link
            href="/clients/new"
            className="glass-pill border border-transparent px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-white/90"
          >
            Nový klient
          </Link>
        </div>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Klientské profily
        </h2>
        {loading ? (
          <p className="text-sm text-slate-600">Načítání…</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : clients.length === 0 ? (
          <p className="text-sm text-slate-600">Zatím žádní klienti. Vytvořte prvního.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/90">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Jméno</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Stav</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Rozpočet</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Doporučení</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Akce</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-sm text-slate-900">
                      <Link href={`/clients/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">{c.status}</td>
                    <td className="px-3 py-2 text-xs text-slate-700">–</td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {c.recommendations_count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <Link
                        href={`/clients/${c.id}`}
                        className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        Otevřít
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

