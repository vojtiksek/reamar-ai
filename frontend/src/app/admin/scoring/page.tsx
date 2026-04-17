"use client";

/**
 * Unified scoring configuration screen.
 *
 * Merges the legacy Scoring Studio (only its Thresholds tab — the other tabs
 * targeted the legacy compute_match() pipeline which is no longer invoked
 * in production) with the Scoring V2 config (numerical parameters of the
 * active compute_flat_match() engine). Both now persist to DB:
 * - Thresholds: ScoringConfig.thresholds_json (endpoint: /admin/scoring-thresholds)
 * - V2 params:  ScoringConfig.scoring_v2_json   (endpoint: /admin/scoring-v2-config)
 */

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

type Thresholds = {
  strong_pick_min_score: number;
  review_pick_min_score: number;
  hide_below_score: number;
  default_visible_limit: number;
  max_strong_picks?: number;
  max_review_picks?: number;
  [k: string]: number | undefined;
};

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

// ─── Thresholds section definition ──────────────────────────────────────────

const THRESHOLD_FIELDS: {
  key: keyof Thresholds;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
}[] = [
  {
    key: "strong_pick_min_score",
    label: "Strong pick — min. score",
    help: "Byty nad tímto score se zobrazí jako \"Strong picks\".",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "review_pick_min_score",
    label: "Review pick — min. score",
    help: "Byty mezi tímto a strong pick score se zobrazí jako \"Review picks\".",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "hide_below_score",
    label: "Skrýt pod score",
    help: "Byty pod tímto score se nezobrazí. 0 = zobrazit vše.",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "default_visible_limit",
    label: "Max. zobrazených doporučení",
    help: "Kolik doporučení se maximálně uloží při přepočtu. 0 = bez limitu.",
    min: 0,
    max: 500,
    step: 5,
  },
];

// ─── V2 section definitions ─────────────────────────────────────────────────

type ScalarField = { key: string; label: string; help?: string; step?: number };

const PRICE_BELL_FIELDS: ScalarField[] = [
  { key: "price_bell_sweet_low", label: "Sweet spot — spodní (% úspory)", help: "Pod touto hodnotou se skóre snižuje", step: 1 },
  { key: "price_bell_sweet_high", label: "Sweet spot — horní (% úspory)", help: "Nad touto hodnotou se skóre snižuje (příliš levné)", step: 1 },
  { key: "price_bell_penalty", label: "Penalizace — strmost", help: "Jak rychle padá skóre mimo sweet spot", step: 0.1 },
];

const PRICE_M2_FIELDS: ScalarField[] = [
  { key: "price_m2_neutral", label: "Neutrální fit (0% odchylka)", step: 1 },
  { key: "price_m2_cheap_bonus", label: "Bonus strmost (levnější)", step: 0.1 },
  { key: "price_m2_expensive_penalty", label: "Penalizace strmost (dražší)", step: 0.1 },
];

const COMMUTE_FIELDS: ScalarField[] = [
  { key: "commute_primary_weight", label: "Primární bod — váha", step: 0.05 },
  { key: "commute_secondary_weight", label: "Sekundární bod — váha", step: 0.05 },
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
  { key: "noise_quiet_bonus", label: "Tichá oblast — bonus", step: 1 },
  { key: "noise_medium_penalty", label: "Střední hluk — penalizace", step: 1 },
  { key: "noise_high_penalty", label: "Vysoký hluk — penalizace", step: 1 },
  { key: "noise_very_high_penalty", label: "Velmi vysoký — penalizace", step: 1 },
  { key: "noise_road_close_m", label: "Silnice blízko (m)", step: 10 },
  { key: "noise_road_penalty", label: "Silnice — penalizace", step: 1 },
  { key: "noise_tram_close_m", label: "Tramvaj blízko (m)", step: 10 },
  { key: "noise_tram_penalty", label: "Tramvaj — penalizace", step: 1 },
  { key: "noise_rail_close_m", label: "Vlak blízko (m)", step: 10 },
  { key: "noise_rail_penalty", label: "Vlak — penalizace", step: 1 },
  { key: "noise_airport_close_m", label: "Letiště blízko (m)", step: 100 },
  { key: "noise_airport_penalty", label: "Letiště — penalizace", step: 1 },
  { key: "noise_adj_min", label: "Min. celkový adjustment", step: 1 },
  { key: "noise_adj_max", label: "Max. celkový adjustment", step: 1 },
];

const PREF_FIELDS: ScalarField[] = [
  { key: "pref_match", label: "Match fit hodnota", step: 1 },
  { key: "pref_miss", label: "Miss fit hodnota", step: 1 },
  { key: "pref_neutral", label: "Neutrální fit hodnota", step: 1 },
];

const ADMIN_AREA_FIELDS: ScalarField[] = [
  { key: "admin_inside_bonus", label: "Uvnitř oblasti — bonus", step: 0.5 },
  { key: "admin_outside_penalty", label: "Mimo oblast — penalizace", step: 0.5 },
];

const TOLERANCE_FIELDS: ScalarField[] = [
  { key: "tolerance_budget_pct", label: "Rozpočet tolerance (%)", step: 1 },
  { key: "tolerance_area_pct", label: "Plocha tolerance (%)", step: 1 },
  { key: "tolerance_outdoor_pct", label: "Venkovní plocha tolerance (%)", step: 1 },
];

const CORE_WEIGHT_LABELS: Record<string, string> = {
  price_savings: "Cena (úspora vs. budget)",
  price_per_m2: "Cena/m² vs. okolí",
  unit_area: "Velikost bytu",
  outdoor_area: "Venkovní prostor",
  payment_schedule: "Platební podmínky",
  commute_time: "Dojezdové vzdálenosti",
  walkability_poi: "Občanská vybavenost",
  center_distance: "Vzdálenost od centra",
  completion_preference: "Termín nastěhování",
  renovation_preference: "Novostavba / rekonstrukce",
};

// ─── UI helpers ─────────────────────────────────────────────────────────────

function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-lg">
      <span>{message}</span>
      <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
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
        <span className={`text-xs text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
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

// ─── Main component ─────────────────────────────────────────────────────────

type Tab = "thresholds" | "v2";

export default function ScoringPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("thresholds");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    setToken(t);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([
          ["thresholds", "Prahy viditelnosti"],
          ["v2", "Parametry V2 engine"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "rounded-full bg-[#1E3A5F] px-3 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "thresholds" && <ThresholdsTab token={token} onToast={setToast} />}
      {tab === "v2" && <V2ConfigTab token={token} onToast={setToast} />}

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}

// ─── Thresholds tab ─────────────────────────────────────────────────────────

function ThresholdsTab({
  token,
  onToast,
}: {
  token: string | null;
  onToast: (msg: string) => void;
}) {
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/admin/scoring-thresholds`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.thresholds) setThresholds(data.thresholds);
      })
      .catch(() => onToast("Nepodařilo se načíst prahy."));
  }, [token, onToast]);

  const handleSave = async () => {
    if (!token || !thresholds) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/scoring-thresholds`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(thresholds),
      });
      if (!res.ok) throw new Error(await res.text());
      onToast("Prahy uloženy.");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Nepodařilo se uložit.");
    } finally {
      setSaving(false);
    }
  };

  if (!thresholds) {
    return <p className="text-sm text-slate-500">Načítání…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
        <p className="font-medium">Prahy viditelnosti doporučení</p>
        <p className="mt-0.5 text-xs text-blue-800/80">
          Určují, co se ukáže brokerovi jako „Strong pick" / „Review pick" a co se skryje.
          Nemění samotné skóre, jen jeho prezentaci.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {THRESHOLD_FIELDS.map(({ key, label, help, min, max, step }) => {
          const value = Number(thresholds[key] ?? 0);
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
                onChange={(e) =>
                  setThresholds((prev) => prev && { ...prev, [key]: Number(e.target.value) })
                }
                className="w-full"
              />
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) =>
                  setThresholds((prev) => prev && { ...prev, [key]: Number(e.target.value) })
                }
                className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </ReamarCard>
          );
        })}
      </div>

      <ReamarCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">Jak to funguje</h3>
        <ul className="space-y-1 text-sm text-slate-600">
          <li>
            Byt se score ≥ <strong>{thresholds.strong_pick_min_score}</strong> ={" "}
            <span className="text-emerald-700 font-medium">Strong pick</span>
          </li>
          <li>
            Byt se score ≥ <strong>{thresholds.review_pick_min_score}</strong> a &lt;{" "}
            {thresholds.strong_pick_min_score} ={" "}
            <span className="text-blue-700 font-medium">Review pick</span>
          </li>
          <li>
            Byt se score &lt; <strong>{thresholds.review_pick_min_score}</strong> ={" "}
            <span className="text-slate-500 font-medium">Fallback option</span>
          </li>
          {(thresholds.hide_below_score ?? 0) > 0 && (
            <li>
              Byt se score &lt; <strong>{thresholds.hide_below_score}</strong> ={" "}
              <span className="text-rose-600 font-medium">Skrytý</span>
            </li>
          )}
          <li>
            Maximálně <strong>{thresholds.default_visible_limit || "neomezeno"}</strong> doporučení celkem
          </li>
        </ul>
      </ReamarCard>

      <div className="flex justify-end">
        <ReamarButton size="sm" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Ukládám…" : "Uložit prahy"}
        </ReamarButton>
      </div>
    </div>
  );
}

// ─── V2 config tab ──────────────────────────────────────────────────────────

function V2ConfigTab({
  token,
  onToast,
}: {
  token: string | null;
  onToast: (msg: string) => void;
}) {
  const [config, setConfig] = useState<ScoringV2Config | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/admin/scoring-v2-config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.config) setConfig(data.config);
      })
      .catch(() => onToast("Nepodařilo se načíst V2 config."));
  }, [token, onToast]);

  const updateScalar = (key: string, value: number) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateCoreWeight = (wKey: string, value: number) => {
    setConfig((prev) =>
      prev ? { ...prev, core_weights: { ...prev.core_weights, [wKey]: value } } : prev,
    );
  };

  const saveSection = async (keys: string[]) => {
    if (!token || !config) return;
    setSaving(true);
    try {
      const partial: Record<string, unknown> = {};
      for (const k of keys) partial[k] = (config as Record<string, unknown>)[k];
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
      onToast("V2 parametry uloženy.");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Nepodařilo se uložit.");
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <p className="text-sm text-slate-500">Načítání…</p>;
  }

  const scalarFieldSection = (title: string, fields: ScalarField[], defaultOpen = false) => (
    <CollapsibleSection title={title} defaultOpen={defaultOpen}>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <ScalarInput
            key={f.key}
            label={f.label}
            help={f.help}
            step={f.step}
            value={Number((config as Record<string, unknown>)[f.key] ?? 0)}
            onChange={(v) => updateScalar(f.key, v)}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <ReamarButton size="sm" variant="secondary" onClick={() => saveSection(fields.map((f) => f.key))} disabled={saving}>
          {saving ? "Ukládám…" : "Uložit sekci"}
        </ReamarButton>
      </div>
    </CollapsibleSection>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
        <p className="font-medium">Parametry V2 scoring engine</p>
        <p className="mt-0.5 text-xs text-emerald-800/80">
          Reálně ovlivňují skóre jednotek a projektů (používá je{" "}
          <code className="rounded bg-emerald-100/60 px-1 text-[11px]">compute_flat_match()</code>).
          Od fáze 12 jsou persistentní — přežijí restart backendu.
        </p>
      </div>

      <CollapsibleSection title="Váhy klíčových aspektů" defaultOpen>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Object.keys(config.core_weights).map((wKey) => (
            <ScalarInput
              key={wKey}
              label={CORE_WEIGHT_LABELS[wKey] ?? wKey}
              step={1}
              value={config.core_weights[wKey]}
              onChange={(v) => updateCoreWeight(wKey, v)}
            />
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <ReamarButton size="sm" variant="secondary" onClick={() => saveSection(["core_weights"])} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit váhy"}
          </ReamarButton>
        </div>
      </CollapsibleSection>

      {scalarFieldSection("Pool preferencí (standardy + vybavení)", [
        { key: "pref_standard_pool", label: "Pool standardů", step: 1 },
        { key: "pref_amenity_pool", label: "Pool vybavení domu", step: 1 },
      ])}

      {scalarFieldSection("Cena — bell curve (% úspory)", PRICE_BELL_FIELDS)}
      {scalarFieldSection("Cena/m² vs. okolí", PRICE_M2_FIELDS)}
      {scalarFieldSection("Dojezdové vzdálenosti", COMMUTE_FIELDS)}
      {scalarFieldSection("Centrum Prahy", CENTER_FIELDS)}
      {scalarFieldSection("Hluk a zdroje hluku", NOISE_FIELDS)}
      {scalarFieldSection("Preference — hodnoty fitu", PREF_FIELDS)}
      {scalarFieldSection("Oblast zájmu (polygon / admin)", ADMIN_AREA_FIELDS)}
      {scalarFieldSection("Tolerance (% od tvrdých limitů)", TOLERANCE_FIELDS)}
    </div>
  );
}
