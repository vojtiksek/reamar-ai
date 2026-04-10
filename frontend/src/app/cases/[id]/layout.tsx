"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { formatCurrencyCzk } from "@/lib/format";

const TABS = [
  { key: "overview", label: "Přehled", suffix: "/overview" },
  { key: "brief", label: "Zadání", suffix: "/brief" },
  { key: "recommendations", label: "Doporučení", suffix: "/recommendations" },
  { key: "shortlist", label: "Výběr", suffix: "/shortlist" },
  { key: "presentation", label: "Prezentace", suffix: "/presentation" },
  { key: "activity", label: "Aktivita", suffix: "/activity" },
  { key: "notes", label: "Poznámky", suffix: "/notes" },
];

type CaseShellData = {
  name: string;
  status: string;
  recommendations_count: number;
  budget_min?: number | null;
  budget_max?: number | null;
  has_profile: boolean;
  shortlist_count: number;
  last_activity: string | null;
};

function stageLabel(d: CaseShellData): string {
  if (!d.has_profile) return "Nový";
  if (d.recommendations_count === 0) return "Zadání hotové";
  if (d.shortlist_count > 0) return "Výběr připraven";
  return "Doporučení";
}

function nextAction(d: CaseShellData): string {
  if (!d.has_profile) return "→ Doplnit zadání";
  if (d.recommendations_count === 0) return "→ Vygenerovat doporučení";
  if (d.shortlist_count === 0) return "→ Připravit výběr";
  return "→ Připravit klientskou prezentaci";
}

export default function CaseLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const id = params?.id;
  const [data, setData] = useState<CaseShellData | null>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    if (!token || !id) return;

    Promise.all([
      fetch(`${API_BASE}/clients/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/clients/${id}/profile`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/clients/${id}/recommendations`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_BASE}/clients/${id}/notes`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : [])),
    ]).then(([client, profile, recs, notes]) => {
      if (!client) return;
      const recsArr = Array.isArray(recs) ? recs : [];
      const notesArr = Array.isArray(notes) ? notes : [];
      const lastNote = notesArr[0]?.created_at ?? null;
      setData({
        name: client.name ?? `Case #${id}`,
        status: client.status ?? "new",
        recommendations_count: client.recommendations_count ?? recsArr.length,
        budget_min: profile?.budget_min ?? null,
        budget_max: profile?.budget_max ?? null,
        has_profile: Boolean(profile && (profile.budget_min != null || profile.budget_max != null || profile.layouts?.values?.length)),
        shortlist_count: recsArr.filter((r: any) => r.pinned_by_broker).length,
        last_activity: lastNote ?? client.created_at ?? null,
      });
    }).catch(() => {});
  }, [id]);

  const stage = data ? stageLabel(data) : "—";
  const action = data ? nextAction(data) : "—";
  const budgetStr = data?.budget_max ? `do ${formatCurrencyCzk(data.budget_max)}` : "—";

  // Fullscreen wizard — skip case shell entirely
  if (pathname?.includes("/wizard")) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-4">
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Případ</p>
            <h1 className="text-xl font-semibold text-slate-900">{data?.name ?? `Case #${String(id)}`}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[#1E3A5F] px-2.5 py-1 font-medium text-white">{stage}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">Majitel: Vojta</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">{action}</span>
            {data?.last_activity && (
              <span className="text-slate-400">Poslední aktivita: {new Date(data.last_activity).toLocaleDateString("cs-CZ")}</span>
            )}
          </div>
        </div>
      </div>

      <nav className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const href = `/cases/${id}${tab.suffix}`;
          const active = pathname === href;
          return (
            <Link
              key={tab.key}
              href={href}
              className={active
                ? "rounded-full bg-[#1E3A5F] px-3 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
