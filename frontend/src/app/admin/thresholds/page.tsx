"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

type Thresholds = {
  strong_pick_min_score: number;
  review_pick_min_score: number;
  hide_below_score: number;
  default_visible_limit: number;
  max_strong_picks: number;
  max_review_picks: number;
};

const FIELDS: { key: keyof Thresholds; label: string; help: string; min: number; max: number; step: number }[] = [
  { key: "strong_pick_min_score", label: "Strong pick — min. score", help: "Byty nad tímto score se zobrazí jako \"Strong picks\" v doporučeních.", min: 0, max: 100, step: 1 },
  { key: "review_pick_min_score", label: "Review pick — min. score", help: "Byty mezi tímto a strong pick score se zobrazí jako \"Review picks\".", min: 0, max: 100, step: 1 },
  { key: "hide_below_score", label: "Skrýt pod score", help: "Byty pod tímto score se ve shodách vůbec nezobrazí. 0 = zobrazit vše.", min: 0, max: 100, step: 1 },
  { key: "default_visible_limit", label: "Max. zobrazených doporučení", help: "Kolik doporučení se maximálně uloží při přepočtu. 0 = bez limitu.", min: 0, max: 500, step: 5 },
  { key: "max_strong_picks", label: "Max. strong picks", help: "Maximální počet strong picks. 0 = bez limitu.", min: 0, max: 100, step: 1 },
  { key: "max_review_picks", label: "Max. review picks", help: "Maximální počet review picks. 0 = bez limitu.", min: 0, max: 100, step: 1 },
];

const DEFAULTS: Thresholds = {
  strong_pick_min_score: 70,
  review_pick_min_score: 55,
  hide_below_score: 0,
  default_visible_limit: 50,
  max_strong_picks: 0,
  max_review_picks: 0,
};

export default function AdminThresholdsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULTS);
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
    fetch(`${API_BASE}/admin/scoring-thresholds`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: any) => {
        if (data?.thresholds) setThresholds({ ...DEFAULTS, ...data.thresholds });
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/scoring-thresholds`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(thresholds),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: any = await res.json();
      if (data?.thresholds) setThresholds({ ...DEFAULTS, ...data.thresholds });
      setMessage("Thresholdy uloženy. Změna se projeví při příštím přepočtu doporučení.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Nepodařilo se uložit.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => setThresholds(DEFAULTS);

  if (!token) return <p className="text-sm text-slate-600">Nejste přihlášen.</p>;
  if (loading) return <p className="text-sm text-slate-600">Načítání...</p>;

  // Validation warnings
  const warnings: string[] = [];
  if (thresholds.review_pick_min_score >= thresholds.strong_pick_min_score) {
    warnings.push("Review pick score by měl být nižší než Strong pick score.");
  }
  if (thresholds.hide_below_score > thresholds.review_pick_min_score) {
    warnings.push("Hide below score je vyšší než Review pick score — některé review picks se nebudou zobrazovat.");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Pravidla viditelnosti doporučení</h2>
          <p className="text-sm text-slate-500">
            Určují, které byty se zobrazí ve shodách a jak se kategorizují.
            Změna se projeví při příštím přepočtu.
          </p>
        </div>
        <div className="flex gap-2">
          <ReamarButton size="sm" variant="ghost" onClick={handleReset}>Výchozí hodnoty</ReamarButton>
          <ReamarButton size="sm" variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Ukládám..." : "Uložit"}
          </ReamarButton>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {FIELDS.map(({ key, label, help, min, max, step }) => {
          const value = thresholds[key];
          return (
            <ReamarCard key={key} className="p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
                <p className="text-[11px] text-slate-500">{help}</p>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => setThresholds((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                className="w-full"
              />
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => setThresholds((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </ReamarCard>
          );
        })}
      </div>

      <ReamarCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">Jak to funguje</h3>
        <ul className="space-y-1 text-sm text-slate-600">
          <li>Byt se score &ge; <strong>{thresholds.strong_pick_min_score}</strong> = <span className="text-emerald-700 font-medium">Strong pick</span></li>
          <li>Byt se score &ge; <strong>{thresholds.review_pick_min_score}</strong> a &lt; {thresholds.strong_pick_min_score} = <span className="text-blue-700 font-medium">Review pick</span></li>
          <li>Byt se score &lt; <strong>{thresholds.review_pick_min_score}</strong> = <span className="text-slate-500 font-medium">Fallback option</span></li>
          {thresholds.hide_below_score > 0 && (
            <li>Byt se score &lt; <strong>{thresholds.hide_below_score}</strong> = <span className="text-rose-600 font-medium">Skrytý</span> (nezobrazí se vůbec)</li>
          )}
          <li>Maximálně <strong>{thresholds.default_visible_limit || "neomezeno"}</strong> doporučení celkem</li>
        </ul>
      </ReamarCard>
    </div>
  );
}
