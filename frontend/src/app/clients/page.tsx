"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/api";

type DashboardClient = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  recommendations_count: number;
  unseen_matches: number;
  last_note_at?: string | null;
  days_since_last_note?: number | null;
  share_link_expires_at?: string | null;
  share_link_expired: boolean;
  has_profile: boolean;
  priority: "high" | "medium" | "normal";
};

const STATUS_LABELS: Record<string, string> = {
  new: "Nový",
  active: "Aktivní",
  shortlist: "Shortlist",
  closed: "Ukončen",
};

const PRIORITY_BADGE: Record<string, { bg: string; label: string }> = {
  high: { bg: "bg-rose-100 text-rose-700", label: "Vyžaduje pozornost" },
  medium: { bg: "bg-amber-100 text-amber-700", label: "Ke kontrole" },
  normal: { bg: "bg-slate-100 text-slate-500", label: "" },
};

export default function ClientsPage() {
  const [clients, setClients] = useState<DashboardClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem("broker_token")
        : null;
    if (!token) {
      setError("Nejste přihlášen – prosím přejděte na /login.");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/clients/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(res.statusText))
      )
      .then((data: DashboardClient[]) => setClients(data ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, []);

  const highCount = clients.filter((c) => c.priority === "high").length;
  const mediumCount = clients.filter((c) => c.priority === "medium").length;

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
          Dashboard klientů
        </h2>

        {/* Summary cards */}
        {!loading && !error && clients.length > 0 && (
          <div className="mb-4 flex gap-3">
            <div className="rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
              <p className="text-2xl font-bold text-slate-900">
                {clients.length}
              </p>
              <p className="text-[11px] text-slate-500">Celkem klientů</p>
            </div>
            {highCount > 0 && (
              <div className="rounded-lg bg-rose-50 px-4 py-3 shadow-sm ring-1 ring-rose-200">
                <p className="text-2xl font-bold text-rose-700">{highCount}</p>
                <p className="text-[11px] text-rose-600">Vyžaduje pozornost</p>
              </div>
            )}
            {mediumCount > 0 && (
              <div className="rounded-lg bg-amber-50 px-4 py-3 shadow-sm ring-1 ring-amber-200">
                <p className="text-2xl font-bold text-amber-700">
                  {mediumCount}
                </p>
                <p className="text-[11px] text-amber-600">Ke kontrole</p>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-600">Načítání…</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : clients.length === 0 ? (
          <p className="text-sm text-slate-600">
            Zatím žádní klienti. Vytvořte prvního.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/90">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Klient
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Stav
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Priorita
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-700">
                    Dopor.
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-700">
                    Nové shody
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Poslední poznámka
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">
                    Akce
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c) => {
                  const badge = PRIORITY_BADGE[c.priority] ?? PRIORITY_BADGE.normal;
                  return (
                    <tr
                      key={c.id}
                      className={
                        c.priority === "high"
                          ? "bg-rose-50/40 hover:bg-rose-50/70"
                          : c.priority === "medium"
                            ? "bg-amber-50/30 hover:bg-amber-50/60"
                            : "hover:bg-slate-50"
                      }
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/clients/${c.id}`}
                          className="text-sm font-medium text-slate-900 hover:underline"
                        >
                          {c.name}
                        </Link>
                        {c.email && (
                          <p className="text-[10px] text-slate-400">
                            {c.email}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                          {STATUS_LABELS[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {badge.label ? (
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.bg}`}
                          >
                            {badge.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                        {/* Reason hints */}
                        <div className="mt-0.5 space-y-0.5">
                          {c.unseen_matches > 0 && (
                            <p className="text-[10px] text-rose-600">
                              {c.unseen_matches} nových shod
                            </p>
                          )}
                          {!c.has_profile && c.status === "new" && (
                            <p className="text-[10px] text-amber-600">
                              Bez profilu
                            </p>
                          )}
                          {c.share_link_expired && (
                            <p className="text-[10px] text-amber-600">
                              Sdílený odkaz vypršel
                            </p>
                          )}
                          {c.days_since_last_note != null &&
                            c.days_since_last_note > 14 && (
                              <p className="text-[10px] text-amber-600">
                                {c.days_since_last_note}d od poslední poznámky
                              </p>
                            )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-slate-700">
                        {c.recommendations_count}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {c.unseen_matches > 0 ? (
                          <span className="inline-block min-w-[20px] rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                            {c.unseen_matches}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">
                        {c.last_note_at
                          ? new Date(c.last_note_at).toLocaleDateString(
                              "cs-CZ"
                            )
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link
                          href={`/clients/${c.id}`}
                          className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                        >
                          Otevřít
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
