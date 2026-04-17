"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";
import { useUiVersion } from "@/components/v2/useUiVersion";
import { ClientsListV2 } from "./ClientsListV2";

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
  has_profile: boolean;
  priority: "high" | "medium" | "normal";
};

type Filter = "all" | "attention" | "has_recs" | "new";

function stageFromClient(c: DashboardClient): { label: string; cls: string } {
  if (!c.has_profile) return { label: "Nový", cls: "bg-slate-100 text-slate-700" };
  if (c.recommendations_count === 0) return { label: "Zadání hotové", cls: "bg-blue-100 text-blue-800" };
  if (c.recommendations_count > 0 && c.status !== "shortlist") return { label: "Doporučení", cls: "bg-indigo-100 text-indigo-800" };
  return { label: "Užší výběr", cls: "bg-emerald-100 text-emerald-800" };
}

function nextAction(c: DashboardClient): string {
  if (!c.has_profile) return "Doplnit zadání";
  if (c.recommendations_count === 0) return "Vygenerovat doporučení";
  if (c.unseen_matches > 0) return `${c.unseen_matches} nových shod`;
  if (c.days_since_last_note != null && c.days_since_last_note > 14) return "Ozvat se klientovi";
  return "Zkontrolovat výběr";
}


function nextRoute(c: DashboardClient): string {
  if (!c.has_profile) return `/cases/${c.id}/brief`;
  if (c.recommendations_count === 0) return `/cases/${c.id}/recommendations`;
  if (c.status === "shortlist") return `/cases/${c.id}/shortlist`;
  return `/cases/${c.id}/overview`;
}

function priorityIndicator(p: string) {
  if (p === "high") return "border-l-4 border-l-rose-400";
  if (p === "medium") return "border-l-4 border-l-amber-400";
  return "";
}


function priorityLabel(c: DashboardClient): string {
  if (c.priority === "high") return "Teď řešit";
  if (c.priority === "medium") return "Ke kontrole";
  return "Bez urgence";
}

function statusTone(c: DashboardClient): string {
  if (c.priority === "high") return "text-rose-700";
  if (c.priority === "medium") return "text-amber-700";
  return "text-slate-500";
}

function lastTouchLabel(c: DashboardClient): string {
  if (c.last_note_at) return `Poznámka ${new Date(c.last_note_at).toLocaleDateString("cs-CZ")}`;
  return `Vytvořen ${new Date(c.created_at).toLocaleDateString("cs-CZ")}`;
}

function statusLabel(c: DashboardClient): string {
  if (!c.has_profile) return "Čeká na brief";
  if (c.recommendations_count === 0) return "Bez doporučení";
  if (c.unseen_matches > 0) return `Nové shody: ${c.unseen_matches}`;
  return `${statusLabel(c)}`;
}

function isStale(c: DashboardClient): boolean {
  return (c.days_since_last_note ?? 0) > 14;
}

export default function ClientsPage() {
  const uiVersion = useUiVersion();
  if (uiVersion === "v2") return <ClientsListV2 />;
  return <ClientsPageV1 />;
}

function ClientsPageV1() {
  const [clients, setClients] = useState<DashboardClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("broker_token") : null;
    if (!token) { setError("Nejste přihlášen – prosím přejděte na /login."); setLoading(false); return; }
    setLoading(true);
    fetch(`${API_BASE}/clients/dashboard`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: DashboardClient[]) => setClients(data ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (filter === "attention") return clients.filter((c) => c.priority === "high" || c.priority === "medium");
    if (filter === "has_recs") return clients.filter((c) => c.recommendations_count > 0);
    if (filter === "new") return clients.filter((c) => !c.has_profile);
    return clients;
  }, [clients, filter]);

  const highCount = clients.filter((c) => c.priority === "high" || c.priority === "medium").length;

  const sorted = [...filtered].sort((a, b) => {
    const score = (c: DashboardClient) =>
      (c.priority === "high" ? 3 : c.priority === "medium" ? 2 : 1) * 100 +
      (c.unseen_matches || 0) * 10 +
      (c.recommendations_count || 0);
    return score(b) - score(a);
  });

  const grouped = filter === "all"
    ? [
        { title: "Vyžaduje pozornost", items: sorted.filter((c) => c.priority === "high" || c.priority === "medium") },
        { title: "Ostatní případy", items: sorted.filter((c) => c.priority !== "high" && c.priority !== "medium") },
      ].filter((g) => g.items.length > 0)
    : [{ title: null, items: sorted }];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Případy</h1>
          <p className="text-sm text-slate-500">{clients.length} klientů · {highCount} vyžaduje pozornost</p>
        </div>
        <Link href="/clients/new">
          <ReamarButton variant="primary" size="sm">+ Nový případ</ReamarButton>
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap gap-2">
        {([
          ["all", "Všichni"],
          ["attention", "Vyžaduje pozornost"],
          ["has_recs", "S doporučeními"],
          ["new", "Nový"],
        ] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              filter === key
                ? "bg-[#1E3A5F] text-white shadow-sm"
                : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {label}
            {key === "attention" && highCount > 0 ? ` (${highCount})` : ""}
          </button>
        ))}
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <ReamarCard className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Teď řešit</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{clients.filter((c) => c.priority === "high").length}</p>
          <p className="mt-1 text-sm text-slate-500">Případy s novými shodami nebo bez reakce.</p>
        </ReamarCard>
        <ReamarCard className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Ke kontrole</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{clients.filter((c) => c.priority === "medium").length}</p>
          <p className="mt-1 text-sm text-slate-500">Potřebují rychlé rozhodnutí nebo další krok.</p>
        </ReamarCard>
        <ReamarCard className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Aktivní s doporučeními</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{clients.filter((c) => c.recommendations_count > 0).length}</p>
          <p className="mt-1 text-sm text-slate-500">Případy, kde je už z čeho vybírat.</p>
        </ReamarCard>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">Červená = řešit hned</span>
        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">Žlutá = ke kontrole</span>
        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">Bez aktivity = ozvat se klientovi</span>
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-sm text-slate-600">Načítání…</p>
      ) : error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : filtered.length === 0 ? (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-600">V tomto filtru není žádný případ.</p>
        </ReamarCard>
      ) : (
        <div className="space-y-6">
          {grouped.map((group, groupIndex) => (
            <Fragment key={group.title ?? `group-${groupIndex}`}>
              {group.title && <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group.title}</h2>}
              <div className="space-y-3">
                {group.items.map((c) => {
                  const stage = stageFromClient(c);
                  const action = nextAction(c);
                  const href = nextRoute(c);
                  return (
                    <ReamarCard key={c.id} className={`p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] ${priorityIndicator(c.priority)}`}>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/cases/${c.id}/overview`} className="text-base font-semibold text-slate-900 hover:underline">{c.name}</Link>
                            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${stage.cls}`}>{stage.label}</span>
                            {c.unseen_matches > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">{c.unseen_matches} nových</span>}
                            {isStale(c) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Bez aktivity</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                            {c.email && <span>{c.email}</span>}
                            <span>{lastTouchLabel(c)}</span>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[430px] lg:max-w-[430px] lg:flex-none">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Priorita</p>
                            <p className={`mt-1 text-sm font-medium ${statusTone(c)}`}>{priorityLabel(c)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Další krok</p>
                            <p className="mt-1 text-sm font-medium text-slate-900">{action}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stav</p>
                            <p className="mt-1 text-sm font-medium text-slate-900">{statusLabel(c)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                        <Link href={`/cases/${c.id}/overview`}><ReamarButton variant="subtle" size="sm">Otevřít případ</ReamarButton></Link>
                        <Link href={href}><ReamarButton variant="primary" size="sm">{action}</ReamarButton></Link>
                      </div>
                    </ReamarCard>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
