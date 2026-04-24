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
  { key: "presentation", label: "Prezentace", suffix: "/presentation" },
  { key: "activity", label: "Poznámky", suffix: "/activity" },
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

    fetch(`${API_BASE}/clients/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((client) => {
        if (!client) return;
        setData({
          name: client.name ?? `Case #${id}`,
          status: client.status ?? "new",
          recommendations_count: client.recommendations_count ?? 0,
          budget_min: null,
          budget_max: null,
          has_profile: true,
          shortlist_count: 0,
          last_activity: client.created_at ?? null,
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
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-2">
      {/* Main bar: Klient + tabs */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 border-r border-slate-200 pr-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Klient</span>
            <span className="text-sm font-semibold text-slate-900">{data?.name ?? `Case #${String(id)}`}</span>
          </div>
          <nav className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {TABS.map((tab) => {
              const href = `/cases/${id}${tab.suffix}`;
              const active = pathname === href;
              return (
                <Link
                  key={tab.key}
                  href={href}
                  className={active
                    ? "rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-900 shadow-sm"
                    : "rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
          {/* Portal target for page-specific filters (right-aligned) */}
          <div id="case-tabs-slot" className="ml-auto flex flex-wrap items-center gap-1.5" />
        </div>
        {/* Portal target for page-specific stats row (Doporučení, Ve výběru, ...) */}
        <div id="case-stats-slot" className="flex flex-wrap items-center gap-2 empty:hidden mt-2 border-t border-slate-100 pt-2" />
      </div>

      <div className="mb-2" />

      {children}
    </div>
  );
}
