"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarCard } from "@/components/ui/reamar-ui";

type Recommendation = {
  id: number;
  unit_id: number;
  project_id: number;
  project_name: string | null;
  unit_external_id: string | null;
  layout: string | null;
  area_m2: number | null;
  price_czk: number | null;
  floor: number | null;
  score: number | null;
  top_strengths: string[];
};

export default function PortalNovostavbyPage() {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("portal_token");
    const clientId = localStorage.getItem("portal_client_id");
    if (!token || !clientId) return;

    fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.status === 401) throw new Error("Neplatná session");
        if (!r.ok) throw new Error("Chyba načítání");
        return r.json();
      })
      .then((data) => setRecs(data.items ?? data ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-slate-400">Načítám doporučení...</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Novostavby</h2>
        <p className="text-sm text-slate-500">Jednotky vybrané na základě vašich preferencí.</p>
      </div>

      {recs.length === 0 && (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-500">Zatím žádná doporučení. Váš makléř připravuje nabídku.</p>
        </ReamarCard>
      )}

      <div className="grid gap-2">
        {recs.map((r) => (
          <ReamarCard key={r.id} className="flex items-center justify-between p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800 truncate">
                {r.project_name ?? "Projekt"} — {r.unit_external_id ?? `#${r.unit_id}`}
              </p>
              <p className="text-xs text-slate-500">
                {r.layout && <span className="mr-2">{r.layout}</span>}
                {r.area_m2 != null && <span className="mr-2">{r.area_m2} m²</span>}
                {r.price_czk != null && <span className="mr-2">{(r.price_czk / 1_000_000).toFixed(1)} mil. Kč</span>}
                {r.floor != null && <span>{r.floor}. patro</span>}
              </p>
              {r.top_strengths?.length > 0 && (
                <p className="mt-1 text-[11px] text-emerald-600">
                  {r.top_strengths.slice(0, 3).join(" · ")}
                </p>
              )}
            </div>
            {r.score != null && (
              <span className="ml-3 shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {r.score}%
              </span>
            )}
          </ReamarCard>
        ))}
      </div>
    </div>
  );
}
