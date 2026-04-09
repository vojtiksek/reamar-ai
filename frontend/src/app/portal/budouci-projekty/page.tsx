"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE } from "@/lib/api";
import { ReamarCard } from "@/components/ui/reamar-ui";

type FutureProject = {
  id: number;
  name: string;
  slug: string;
  developer: string | null;
  city: string | null;
  municipal_district: string | null;
  stage: string | null;
  total_units: number | null;
  construction_completion: string | null;
  project_type: string | null;
  interest_count: number;
};

export default function PortalFutureProjectsPage() {
  const [projects, setProjects] = useState<FutureProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("portal_token");
    if (!token) return;

    fetch(`${API_BASE}/future-projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.status === 401) throw new Error("Neplatná session");
        if (!r.ok) throw new Error("Chyba načítání");
        return r.json();
      })
      .then((data) => setProjects(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-slate-400">Načítám projekty...</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Budoucí projekty</h2>
        <p className="text-sm text-slate-500">Projekty v přípravě. Zanechte nezávazný zájem.</p>
      </div>

      {projects.length === 0 && (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-500">Zatím žádné budoucí projekty.</p>
        </ReamarCard>
      )}

      <div className="grid gap-3">
        {projects.map((fp) => (
          <Link key={fp.id} href={`/future-projects/${fp.slug}`} className="block">
            <ReamarCard className="p-4 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">{fp.name}</p>
                  {fp.developer && <p className="text-xs text-slate-500">{fp.developer}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {fp.city && <span>{fp.city}{fp.municipal_district ? ` \u2014 ${fp.municipal_district}` : ""}</span>}
                    {fp.project_type && <span>{fp.project_type}</span>}
                    {fp.total_units != null && <span>{fp.total_units} jednotek</span>}
                    {fp.construction_completion && <span>Dokončení: {fp.construction_completion}</span>}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  fp.stage === "Výstavba" ? "bg-blue-100 text-blue-700" :
                  fp.stage === "Dokončeno" ? "bg-emerald-100 text-emerald-700" :
                  "bg-slate-100 text-slate-600"
                }`}>
                  {fp.stage || "V přípravě"}
                </span>
              </div>
            </ReamarCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
