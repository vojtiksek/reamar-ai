"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

const LABELS: Record<string, string> = {
  budget: "Rozpočet",
  walkability: "Walkabilita",
  location: "Lokalita",
  layout: "Dispozice",
  area: "Plocha",
  outdoor: "Venkovní plocha",
  commute: "Dojíždění",
};

type Weights = Record<string, number>;

export default function AdminScoringPage() {
  const [token, setToken] = useState<string | null>(null);
  const [weights, setWeights] = useState<Weights>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    setToken(t);
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${API_BASE}/admin/scoring-weights`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: any) => setWeights((data?.weights || data || {}) as Weights))
      .finally(() => setLoading(false));
  }, [token]);

  const total = useMemo(
    () => Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0),
    [weights]
  );

  const normalizedPercent = (key: string) => {
    const value = Number(weights[key] || 0);
    if (!total) return 0;
    return Math.round((value / total) * 100);
  };

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/scoring-weights`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(weights),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: any = await res.json();
      setWeights((data?.weights || data || {}) as Weights);
      setMessage("Globální váhy scoringu uloženy.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Nepodařilo se uložit váhy.");
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (preset: "balanced" | "investment" | "family") => {
    if (preset === "balanced") {
      setWeights({ budget: 0.3, walkability: 0.2, location: 0.2, layout: 0.1, area: 0.1, outdoor: 0.05, commute: 0.05 });
    }
    if (preset === "investment") {
      setWeights({ budget: 0.35, walkability: 0.05, location: 0.2, layout: 0.1, area: 0.2, outdoor: 0.02, commute: 0.08 });
    }
    if (preset === "family") {
      setWeights({ budget: 0.2, walkability: 0.15, location: 0.2, layout: 0.15, area: 0.15, outdoor: 0.1, commute: 0.05 });
    }
  };

  if (!token) return <p className="text-sm text-slate-600">Nejste přihlášen.</p>;
  if (loading) return <p className="text-sm text-slate-600">Načítání…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Globální scoring weights</h2>
          <p className="text-sm text-slate-500">Výchozí váhy pro celý systém. Per-client override má přednost.</p>
        </div>
        <div className="flex gap-2">
          <ReamarButton size="sm" variant="ghost" onClick={() => applyPreset("balanced")}>Balanced</ReamarButton>
          <ReamarButton size="sm" variant="ghost" onClick={() => applyPreset("investment")}>Investment</ReamarButton>
          <ReamarButton size="sm" variant="ghost" onClick={() => applyPreset("family")}>Family</ReamarButton>
          <ReamarButton size="sm" variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit"}
          </ReamarButton>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(LABELS).map(([key, label]) => {
          const value = Number(weights[key] || 0);
          return (
            <ReamarCard key={key} className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
                  <p className="text-[11px] text-slate-500">Aktuálně {normalizedPercent(key)} %</p>
                </div>
                <div className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {value.toFixed(2)}
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={value}
                onChange={(e) => setWeights((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                className="w-full"
              />
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={value}
                onChange={(e) => setWeights((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </ReamarCard>
          );
        })}
      </div>

      <ReamarCard className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Kontrola součtu</h3>
            <p className="text-xs text-slate-500">Backend váhy normalizuje na součet 1.0 automaticky.</p>
          </div>
          <div className={`rounded-full px-3 py-1 text-sm font-semibold ${Math.abs(total - 1) < 0.001 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            Součet: {total.toFixed(2)}
          </div>
        </div>
      </ReamarCard>
    </div>
  );
}
