"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarCard } from "@/components/ui/reamar-ui";

type FutureProject = {
  id: number;
  name: string;
  slug: string;
  is_visible: boolean;
  sort_order: number;
  developer: string | null;
  address: string | null;
  stage: string | null;
  total_units: number | null;
  date_sale_start: string | null;
  construction_completion: string | null;
  project_type: string | null;
  url: string | null;
  renovation: boolean | null;
  city: string | null;
  municipal_district: string | null;
  region: string | null;
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
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Připravujeme</p>
        <h1 className="text-xl font-semibold text-slate-900">Budoucí projekty</h1>
        <p className="mt-1 text-sm text-slate-500">Projekty v přípravě — zatím bez detailních parametrů jednotek.</p>
      </div>

      {projects.length === 0 && (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-500">Zatím žádné budoucí projekty.</p>
        </ReamarCard>
      )}

      <div className="grid gap-3">
        {projects.map((fp) => {
          const pub = fp.public_data_json ?? {};
          return (
            <ReamarCard key={fp.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800">{fp.name}</p>
                    {fp.renovation && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Rekonstrukce</span>}
                    {!!pub.cooperative_housing && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Družstevní</span>}
                  </div>
                  {fp.developer && <p className="text-xs text-slate-500">{fp.developer}</p>}

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {fp.city && <span>{fp.city}{fp.municipal_district ? ` — ${fp.municipal_district}` : ""}</span>}
                    {fp.project_type && <span>{fp.project_type}</span>}
                    {fp.total_units != null && <span>{fp.total_units} jednotek</span>}
                    {fp.construction_completion && <span>Dokončení: {fp.construction_completion}</span>}
                    {fp.date_sale_start && <span>Prodej od: {fp.date_sale_start}</span>}
                  </div>

                  {!!(pub.ride_to_center || pub.public_transport_to_center || pub.overall_quality || pub.standards_rating) && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {!!pub.ride_to_center && <span>Autem do centra: {String(pub.ride_to_center)} min</span>}
                      {!!pub.public_transport_to_center && <span>MHD do centra: {String(pub.public_transport_to_center)} min</span>}
                      {!!pub.overall_quality && <span>Kvalita: {String(pub.overall_quality)}</span>}
                      {!!pub.standards_rating && <span>Standardy: {String(pub.standards_rating)}</span>}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    fp.stage === "Výstavba" ? "bg-blue-100 text-blue-700" :
                    fp.stage === "Dokončeno" ? "bg-emerald-100 text-emerald-700" :
                    "bg-slate-100 text-slate-600"
                  }`}>
                    {fp.stage || "V přípravě"}
                  </span>
                  {fp.interest_count > 0 && (
                    <span className="text-[10px] text-slate-400">{fp.interest_count} zájemců</span>
                  )}
                  {fp.url && (
                    <a href={fp.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline">
                      Web projektu
                    </a>
                  )}
                </div>
              </div>
            </ReamarCard>
          );
        })}
      </div>
    </div>
  );
}
