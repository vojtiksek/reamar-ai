"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE } from "@/lib/api";
import { ReamarCard, ReamarButton } from "@/components/ui/reamar-ui";

type FutureProject = {
  id: number;
  name: string;
  slug: string;
  is_visible: boolean;
  sort_order: number;
  public_data_json: Record<string, unknown> | null;
  internal_data_json: Record<string, unknown> | null;
  interest_count: number;
  created_at: string;
  updated_at: string;
};

export default function FutureProjectsPage() {
  const [projects, setProjects] = useState<FutureProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("broker_token");
    if (!token) { setError("Nepřihlášen"); setLoading(false); return; }
    fetch(`${API_BASE}/future-projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Chyba načítání")))
      .then((data: FutureProject[]) => setProjects(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mx-auto max-w-5xl px-4 py-8"><p className="text-sm text-slate-400">Načítám…</p></div>;
  if (error) return <div className="mx-auto max-w-5xl px-4 py-8"><p className="text-sm text-rose-600">{error}</p></div>;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Připravujeme</p>
          <h1 className="text-xl font-semibold text-slate-900">Budoucí projekty</h1>
          <p className="mt-1 text-sm text-slate-500">Projekty v přípravě — zatím bez detailních parametrů.</p>
        </div>
      </div>

      {projects.length === 0 && (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-500">Zatím žádné budoucí projekty.</p>
        </ReamarCard>
      )}

      <div className="grid gap-3">
        {projects.map((fp) => (
          <ReamarCard key={fp.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-semibold text-slate-800">{fp.name}</p>
              <p className="text-xs text-slate-500">
                {fp.interest_count > 0 && <span className="mr-2">{fp.interest_count} zájemců</span>}
                <span>Přidáno: {new Date(fp.created_at).toLocaleDateString("cs")}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">V přípravě</span>
            </div>
          </ReamarCard>
        ))}
      </div>
    </div>
  );
}
