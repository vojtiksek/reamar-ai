"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

// ─── Types ───────────────────────────────────────────────────────────────────

type ScoringV2Config = {
  core_weights: Record<string, number>;
  pref_standard_pool: number;
  pref_amenity_pool: number;
  price_bell_sweet_low: number;
  price_bell_sweet_high: number;
  price_bell_penalty: number;
  price_m2_neutral: number;
  price_m2_cheap_bonus: number;
  price_m2_expensive_penalty: number;
  area_ratio_cap: number;
  commute_primary_weight: number;
  commute_secondary_weight: number;
  commute_sum_penalty_rate: number;
  center_lat: number;
  center_lng: number;
  center_near_full_km: number;
  center_near_mid_km: number;
  center_far_cutoff_km: number;
  poi_gradual_categories: string[];
  poi_gradual_scores: number[];
  pref_match: number;
  pref_miss: number;
  pref_neutral: number;
  noise_quiet_bonus: number;
  noise_medium_penalty: number;
  noise_high_penalty: number;
  noise_very_high_penalty: number;
  noise_road_close_m: number;
  noise_road_penalty: number;
  noise_tram_close_m: number;
  noise_tram_penalty: number;
  noise_rail_close_m: number;
  noise_rail_penalty: number;
  noise_airport_close_m: number;
  noise_airport_penalty: number;
  noise_adj_min: number;
  noise_adj_max: number;
  admin_inside_bonus: number;
  admin_outside_penalty: number;
  tolerance_budget_pct: number;
  tolerance_area_pct: number;
  tolerance_outdoor_pct: number;
  [key: string]: unknown;
};

// ─── Section definitions ────────────────────────────────────────────────────

type ScalarField = {
  key: string;
  label: string;
  help?: string;
  step?: number;
};

const PRICE_BELL_FIELDS: ScalarField[] = [
  { key: "price_bell_sweet_low", label: "Sweet spot - spodní (% úspory)", help: "Pod touto hodnotou se skóre snizuje", step: 1 },
  { key: "price_bell_sweet_high", label: "Sweet spot - horní (% úspory)", help: "Nad touto hodnotou se skóre snizuje (prilis levne)", step: 1 },
  { key: "price_bell_penalty", label: "Penalizace strmost", help: "Jak rychle padá skóre mimo sweet spot", step: 0.1 },
];

const PRICE_M2_FIELDS: ScalarField[] = [
  { key: "price_m2_neutral", label: "Neutrální fit (0% odchylka)", step: 1 },
  { key: "price_m2_cheap_bonus", label: "Bonus strmost (levnější)", step: 0.1 },
  { key: "price_m2_expensive_penalty", label: "Penalizace strmost (dražší)", step: 0.1 },
];

const COMMUTE_FIELDS: ScalarField[] = [
  { key: "commute_primary_weight", label: "Primární bod - váha", step: 0.05 },
  { key: "commute_secondary_weight", label: "Sekundární bod - váha", step: 0.05 },
  { key: "commute_sum_penalty_rate", label: "Celkový penalizační rate", step: 0.1 },
];

const CENTER_FIELDS: ScalarField[] = [
  { key: "center_lat", label: "Latitude centra", step: 0.0001 },
  { key: "center_lng", label: "Longitude centra", step: 0.0001 },
  { key: "center_near_full_km", label: "Plný fit do (km)", step: 1 },
  { key: "center_near_mid_km", label: "Střední fit do (km)", step: 1 },
  { key: "center_far_cutoff_km", label: "Cutoff (km)", step: 1 },
];

const NOISE_FIELDS: ScalarField[] = [
  { key: "noise_quiet_bonus", label: "Tichá oblast bonus", step: 1 },
  { key: "noise_medium_penalty", label: "Střední hluk penalizace", step: 1 },
  { key: "noise_high_penalty", label: "Vysoký hluk penalizace", step: 1 },
  { key: "noise_very_high_penalty", label: "Velmi vysoký hluk penalizace", step: 1 },
  { key: "noise_road_close_m", label: "Silnice blízko (m)", step: 10 },
  { key: "noise_road_penalty", label: "Silnice penalizace", step: 1 },
  { key: "noise_tram_close_m", label: "Tramvaj blízko (m)", step: 10 },
  { key: "noise_tram_penalty", label: "Tramvaj penalizace", step: 1 },
  { key: "noise_rail_close_m", label: "Vlak blízko (m)", step: 10 },
  { key: "noise_rail_penalty", label: "Vlak penalizace", step: 1 },
  { key: "noise_airport_close_m", label: "Letiště blízko (m)", step: 100 },
  { key: "noise_airport_penalty", label: "Letiště penalizace", step: 1 },
  { key: "noise_adj_min", label: "Min. celkový adjustment", step: 1 },
  { key: "noise_adj_max", label: "Max. celkový adjustment", step: 1 },
];

const PREF_FIELDS: ScalarField[] = [
  { key: "pref_match", label: "Match fit hodnota", step: 1 },
  { key: "pref_miss", label: "Miss fit hodnota", step: 1 },
  { key: "pref_neutral", label: "Neutrální fit hodnota", step: 1 },
];

const ADMIN_AREA_FIELDS: ScalarField[] = [
  { key: "admin_inside_bonus", label: "Uvnitř oblasti bonus", step: 0.5 },
  { key: "admin_outside_penalty", label: "Mimo oblast penalizace", step: 0.5 },
];

const TOLERANCE_FIELDS: ScalarField[] = [
  { key: "tolerance_budget_pct", label: "Rozpočet tolerance (%)", step: 1 },
  { key: "tolerance_area_pct", label: "Plocha tolerance (%)", step: 1 },
  { key: "tolerance_outdoor_pct", label: "Venkovní plocha tolerance (%)", step: 1 },
];

const CORE_WEIGHT_LABELS: Record<string, string> = {
  price_savings: "Cena (úspora vs. budget)",
  price_per_m2: "Cena/m2 vs. okolí",
  unit_area: "Velikost bytu",
  outdoor_area: "Venkovní prostor",
  payment_schedule: "Platební podmínky",
  commute_time: "Dojezdové vzdálenosti",
  walkability_poi: "Občanská vybavenost",
  center_distance: "Vzdálenost od centra",
  completion_preference: "Termín nastěhování",
  renovation_preference: "Novostavba / rekonstrukce",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-lg">
      <span>{message}</span>
      <button onClick={onClose} className="text-slate-400 hover:text-slate-600">X</button>
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <ReamarCard className="p-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className={`text-xs text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>
          &#9660;
        </span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </ReamarCard>
  );
}

function ScalarInput({
  label,
  value,
  onChange,
  step = 1,
  help,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  help?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {help && <p className="text-[11px] text-slate-400 mb-1">{help}</p>}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
      />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ScoringV2ConfigPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [config, setConfig] = useState<ScoringV2Config | null>(null);

  // ── Auth ──
  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    setToken(t);
  }, []);

  // ── Load config ──
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${API_BASE}/admin/scoring-v2-config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.config) setConfig(data.config);
      })
      .finally(() => setLoading(false));
  }, [token]);

  // ── Update helpers ──
  const updateScalar = (key: string, value: number) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateCoreWeight = (wKey: string, value: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        core_weights: { ...prev.core_weights, [wKey]: value },
      };
    });
  };

  // ── Save ──
  const handleSave = async (partial: Record<string, unknown>) => {
    if (!token || !config) return;
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch(`${API_BASE}/admin/scoring-v2-config`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data?.config) setConfig(data.config);
      setToast("Konfigurace ulozena (runtime).");
      setTimeout(() => setToast(null), 4000);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Nepodarilo se ulozit.");
    } finally {
      setSaving(false);
    }
  };

  const saveSection = (keys: string[]) => {
    if (!config) return;
    const partial: Record<string, unknown> = {};
    for (const k of keys) {
      partial[k] = config[k];
    }
    handleSave(partial);
  };

  // ── Guards ──
  if (!token) return <p className="text-sm text-slate-600">Nejste prihlasen.</p>;
  if (loading) return <p className="text-sm text-slate-600">Nacitani konfigurace...</p>;
  if (!config) return <p className="text-sm text-slate-600">Konfigurace nenalezena.</p>;

  const coreWeightTotal = Object.values(config.core_weights).reduce((s, v) => s + v, 0);

  // ── Render ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Scoring V2 — konfigurace</h2>
        <p className="text-sm text-slate-500">
          Runtime konstanty scoringoveho enginu. Zmeny se projeví pri dalšim prepoctu, ale resetuji se po restartu backendu.
        </p>
      </div>

      {/* Section 1: How scoring works */}
      <CollapsibleSection title="Jak funguje scoring" defaultOpen={false}>
        <div className="space-y-2 text-sm text-slate-700">
          <p className="font-medium text-slate-900">Scoring pipeline:</p>
          <ol className="list-decimal list-inside space-y-1 pl-2">
            <li><span className="font-medium">Hard filtry</span> — vyradí nevhodne jednotky (score = 0)</li>
            <li><span className="font-medium">Core aspekty</span> (budget ~{coreWeightTotal.toFixed(0)} bodu) — vzdy aktivni</li>
            <li><span className="font-medium">Preference aspekty</span> (budget ~{(config.pref_standard_pool + config.pref_amenity_pool).toFixed(0)} bodu) — jen pokud klient nastavil</li>
            <li><span className="font-medium">Noise adjustment</span> ({config.noise_adj_min} az +{config.noise_adj_max}) — mimo vahy</li>
            <li><span className="font-medium">Admin oblast adjustment</span> ({config.admin_outside_penalty} az +{config.admin_inside_bonus}) — mimo vahy</li>
          </ol>
          <p className="mt-2 font-medium">= Finalni skore (0–100)</p>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p>Core aspekty maji pevne vahy (soucet ~{coreWeightTotal.toFixed(0)} bodu). Pokud klient nevyplnil nektery core aspekt, jeho vahy se prerozdelí mezi ostatni.</p>
            <p className="mt-1">Preference pool ({config.pref_standard_pool} standardy + {config.pref_amenity_pool} amenity) se rovnomerne deli mezi aktivni preference.</p>
          </div>
        </div>
      </CollapsibleSection>

      {/* Section 2: Core weights */}
      <CollapsibleSection title={`Vahy core aspektu (soucet: ${coreWeightTotal.toFixed(1)})`} defaultOpen={true}>
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Aspekt</th>
                  <th className="px-3 py-2">Klic</th>
                  <th className="px-3 py-2 text-right">Vaha (body)</th>
                  <th className="px-3 py-2 text-right">% z core</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(config.core_weights).map(([key, val]) => (
                  <tr key={key} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-900">{CORE_WEIGHT_LABELS[key] || key}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{key}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step={0.5}
                        value={val}
                        onChange={(e) => updateCoreWeight(key, Number(e.target.value))}
                        className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500">
                      {coreWeightTotal > 0 ? ((val / coreWeightTotal) * 100).toFixed(1) : "0"}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${Math.abs(coreWeightTotal - 64) < 2 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              Soucet: {coreWeightTotal.toFixed(1)} (cilova ~64)
            </span>
            <ReamarButton size="sm" variant="primary" onClick={() => saveSection(["core_weights"])} disabled={saving}>
              {saving ? "Ukladam..." : "Ulozit"}
            </ReamarButton>
          </div>
        </div>
      </CollapsibleSection>

      {/* Section 3: Preference pools */}
      <CollapsibleSection title="Preference pooly">
        <div className="grid gap-4 sm:grid-cols-2">
          <ScalarInput label="Standard pool (body)" value={config.pref_standard_pool} onChange={(v) => updateScalar("pref_standard_pool", v)} step={1} help="Budget pro standardni preference (deleny rovnomerne)" />
          <ScalarInput label="Amenity pool (body)" value={config.pref_amenity_pool} onChange={(v) => updateScalar("pref_amenity_pool", v)} step={1} help="Budget pro amenity preference (deleny rovnomerne)" />
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {PREF_FIELDS.map((f) => (
            <ScalarInput key={f.key} label={f.label} value={config[f.key] as number} onChange={(v) => updateScalar(f.key, v)} step={f.step} help={f.help} />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <ReamarButton size="sm" variant="primary" onClick={() => saveSection(["pref_standard_pool", "pref_amenity_pool", "pref_match", "pref_miss", "pref_neutral"])} disabled={saving}>
            {saving ? "Ukladam..." : "Ulozit"}
          </ReamarButton>
        </div>
      </CollapsibleSection>

      {/* Section 4: Price bell curve */}
      <CollapsibleSection title="Cenova krivka">
        <div className="grid gap-4 sm:grid-cols-3">
          {PRICE_BELL_FIELDS.map((f) => (
            <ScalarInput key={f.key} label={f.label} value={config[f.key] as number} onChange={(v) => updateScalar(f.key, v)} step={f.step} help={f.help} />
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {PRICE_M2_FIELDS.map((f) => (
            <ScalarInput key={f.key} label={f.label} value={config[f.key] as number} onChange={(v) => updateScalar(f.key, v)} step={f.step} help={f.help} />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <ReamarButton size="sm" variant="primary" onClick={() => saveSection(["price_bell_sweet_low", "price_bell_sweet_high", "price_bell_penalty", "price_m2_neutral", "price_m2_cheap_bonus", "price_m2_expensive_penalty"])} disabled={saving}>
            {saving ? "Ukladam..." : "Ulozit"}
          </ReamarButton>
        </div>
      </CollapsibleSection>

      {/* Section 5: Noise */}
      <CollapsibleSection title="Hluk">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {NOISE_FIELDS.map((f) => (
            <ScalarInput key={f.key} label={f.label} value={config[f.key] as number} onChange={(v) => updateScalar(f.key, v)} step={f.step} help={f.help} />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <ReamarButton size="sm" variant="primary" onClick={() => saveSection(NOISE_FIELDS.map((f) => f.key))} disabled={saving}>
            {saving ? "Ukladam..." : "Ulozit"}
          </ReamarButton>
        </div>
      </CollapsibleSection>

      {/* Section 6: Commute */}
      <CollapsibleSection title="Dojizdeni">
        <div className="grid gap-4 sm:grid-cols-3">
          {COMMUTE_FIELDS.map((f) => (
            <ScalarInput key={f.key} label={f.label} value={config[f.key] as number} onChange={(v) => updateScalar(f.key, v)} step={f.step} help={f.help} />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <ReamarButton size="sm" variant="primary" onClick={() => saveSection(COMMUTE_FIELDS.map((f) => f.key))} disabled={saving}>
            {saving ? "Ukladam..." : "Ulozit"}
          </ReamarButton>
        </div>
      </CollapsibleSection>

      {/* Section 7: Center distance */}
      <CollapsibleSection title="Vzdalenost od centra">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CENTER_FIELDS.map((f) => (
            <ScalarInput key={f.key} label={f.label} value={config[f.key] as number} onChange={(v) => updateScalar(f.key, v)} step={f.step} help={f.help} />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <ReamarButton size="sm" variant="primary" onClick={() => saveSection(CENTER_FIELDS.map((f) => f.key))} disabled={saving}>
            {saving ? "Ukladam..." : "Ulozit"}
          </ReamarButton>
        </div>
      </CollapsibleSection>

      {/* Section 8: Admin area + area ratio */}
      <CollapsibleSection title="Ostatni">
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin oblast adjustment</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {ADMIN_AREA_FIELDS.map((f) => (
              <ScalarInput key={f.key} label={f.label} value={config[f.key] as number} onChange={(v) => updateScalar(f.key, v)} step={f.step} help={f.help} />
            ))}
          </div>

          <ScalarInput label="Area ratio cap" value={config.area_ratio_cap} onChange={(v) => updateScalar("area_ratio_cap", v)} step={0.1} help="Nad timto pomerem plochy uz neroste fit" />

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Hard filter tolerance</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {TOLERANCE_FIELDS.map((f) => (
              <ScalarInput key={f.key} label={f.label} value={config[f.key] as number} onChange={(v) => updateScalar(f.key, v)} step={f.step} help={f.help} />
            ))}
          </div>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">POI gradual categories</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 font-mono">
            {JSON.stringify(config.poi_gradual_categories)} — scores: {JSON.stringify(config.poi_gradual_scores)}
          </div>

          <div className="mt-4 flex justify-end">
            <ReamarButton size="sm" variant="primary" onClick={() => saveSection([...ADMIN_AREA_FIELDS.map((f) => f.key), "area_ratio_cap", ...TOLERANCE_FIELDS.map((f) => f.key)])} disabled={saving}>
              {saving ? "Ukladam..." : "Ulozit"}
            </ReamarButton>
          </div>
        </div>
      </CollapsibleSection>

      {/* Toast */}
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
