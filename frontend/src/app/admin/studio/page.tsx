"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

// ─── Types ───────────────────────────────────────────────────────────────────

type Group = {
  label: string;
  enabled: boolean;
  weight: number;
  order: number;
};

type FieldRule = {
  field_key: string;
  label: string;
  entity_type: string;
  data_type: string;
  enabled: boolean;
  include_in_score: boolean;
  group_key: string;
  weight: number;
  rule_type: string;
  rule_config: Record<string, any>;
  missing_value_policy: string;
  explanation_template: string;
  client_mode?: "auto" | "wizard" | "hidden";
};

type EligibilityRule = {
  field: string;
  label: string;
  enabled: boolean;
  rule_type: string;
  config: Record<string, any>;
  on_fail: "reject" | "review";
  ui_type?: "simple_toggle" | "slider" | "range";
  ui_description?: string;
  ui_config?: {
    param?: string;
    label?: string;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    params?: Array<{ key: string; label: string; min: number; max: number; step: number; unit?: string }>;
  };
};

type Weights = Record<string, number>;

type Thresholds = {
  strong_pick_min_score: number;
  review_pick_min_score: number;
  hide_below_score: number;
  default_visible_limit: number;
  max_strong_picks?: number;
  max_review_picks?: number;
  hide_stale_reservations: number;  // 1 = hide reserved > 60 days, 0 = keep
  not_seen_max_days: number;        // include not_seen units last seen within N days
};

type StudioConfig = {
  weights: Weights;
  thresholds: Thresholds;
  groups: Record<string, Group>;
  field_rules: FieldRule[];
  eligibility_rules: EligibilityRule[];
};

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS = ["Skupiny", "Pravidla", "Eligibilita", "Viditelnost", "Váhy", "Preview"] as const;
type Tab = (typeof TABS)[number];

const WEIGHT_LABELS: Record<string, string> = {
  budget: "Rozpočet",
  walkability: "Walkabilita",
  location: "Lokalita",
  layout: "Dispozice",
  area: "Plocha",
  outdoor: "Venkovní plocha",
  commute: "Dojíždění",
};

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
  {
    key: "not_seen_max_days",
    label: "Not seen — max. dní od posledního výskytu",
    help: "Jednotky se statusem not_seen, viděné naposledy před méně než N dny, vstoupí do scoringu. 0 = not_seen vyloučit.",
    min: 0,
    max: 730,
    step: 30,
  },
];

const RULE_TYPES = [
  "numeric_target",
  "numeric_thresholds",
  "numeric_linear",
  "enum_map",
  "boolean_bonus",
];

const MISSING_POLICIES = ["neutral", "penalize", "skip", "bonus"];

const PRESETS: Record<string, Weights> = {
  balanced: {
    budget: 0.3,
    walkability: 0.2,
    location: 0.2,
    layout: 0.1,
    area: 0.1,
    outdoor: 0.05,
    commute: 0.05,
  },
  investment: {
    budget: 0.35,
    walkability: 0.05,
    location: 0.2,
    layout: 0.1,
    area: 0.2,
    outdoor: 0.02,
    commute: 0.08,
  },
  family: {
    budget: 0.2,
    walkability: 0.15,
    location: 0.2,
    layout: 0.15,
    area: 0.15,
    outdoor: 0.1,
    commute: 0.05,
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
        checked ? "bg-[#1E3A5F]" : "bg-slate-300"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Toast({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-lg">
      <span>{message}</span>
      <button
        onClick={onClose}
        className="text-slate-400 hover:text-slate-600"
      >
        ✕
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

// ─── Preview Tab Component ───────────────────────────────────────────────────

type PreviewComparison = {
  unit_id: number;
  project_name: string;
  unit_name: string;
  old_score: number;
  new_score: number;
  old_bucket: string;
  new_bucket: string;
  delta: number;
};

type PreviewSummary = {
  total: number;
  strong: number;
  review: number;
  fallback: number;
};

type PreviewResult = {
  client_id: number;
  active_summary: PreviewSummary;
  draft_summary: PreviewSummary;
  comparison: PreviewComparison[];
  top_movers_up: PreviewComparison[];
  top_movers_down: PreviewComparison[];
  newly_visible: PreviewComparison[];
  newly_hidden: PreviewComparison[];
};

type SimpleClient = { id: number; name: string };

function PreviewTab({
  token,
  weights,
  thresholds,
  groups,
  fieldRules,
  eligibilityRules,
}: {
  token: string | null;
  weights: Weights;
  thresholds: Thresholds;
  groups: Record<string, Group>;
  fieldRules: FieldRule[];
  eligibilityRules: EligibilityRule[];
}) {
  const [clients, setClients] = useState<SimpleClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingClients, setLoadingClients] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load clients on mount
  useEffect(() => {
    if (!token) return;
    setLoadingClients(true);
    fetch(`${API_BASE}/clients`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: any[]) => {
        setClients(
          data.map((c) => ({ id: c.id, name: c.name || `Klient #${c.id}` }))
        );
      })
      .finally(() => setLoadingClients(false));
  }, [token]);

  const handleCompare = async () => {
    if (!token || !selectedClient) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/admin/scoring-studio/preview`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: selectedClient,
          draft_config: {
            weights,
            thresholds,
            groups,
            field_rules: fieldRules,
            eligibility_rules: eligibilityRules,
          },
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }
      const data: PreviewResult = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při načítání preview");
    } finally {
      setLoading(false);
    }
  };

  const bucketLabel = (b: string) => {
    switch (b) {
      case "strong": return "Silný";
      case "review": return "Review";
      case "fallback": return "Fallback";
      case "hidden": return "Skrytý";
      default: return b;
    }
  };

  const bucketColor = (b: string) => {
    switch (b) {
      case "strong": return "bg-emerald-100 text-emerald-800";
      case "review": return "bg-amber-100 text-amber-800";
      case "fallback": return "bg-slate-100 text-slate-600";
      case "hidden": return "bg-red-100 text-red-700";
      default: return "bg-slate-100 text-slate-600";
    }
  };

  const deltaColor = (d: number) => {
    if (d > 0) return "text-emerald-600 font-semibold";
    if (d < 0) return "text-red-600 font-semibold";
    return "text-slate-400";
  };

  const renderComparisonRow = (c: PreviewComparison) => (
    <tr key={c.unit_id} className="border-b border-slate-100 hover:bg-slate-50">
      <td className="py-2 px-3 text-sm">{c.project_name}</td>
      <td className="py-2 px-3 text-sm">{c.unit_name}</td>
      <td className="py-2 px-3 text-sm text-right">{c.old_score}</td>
      <td className="py-2 px-3 text-sm text-right">{c.new_score}</td>
      <td className={`py-2 px-3 text-sm text-right ${deltaColor(c.delta)}`}>
        {c.delta > 0 ? "+" : ""}{c.delta}
      </td>
      <td className="py-2 px-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${bucketColor(c.old_bucket)}`}>
          {bucketLabel(c.old_bucket)}
        </span>
      </td>
      <td className="py-2 px-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${bucketColor(c.new_bucket)}`}>
          {bucketLabel(c.new_bucket)}
        </span>
      </td>
    </tr>
  );

  const renderSummaryCard = (title: string, summary: PreviewSummary, accent: string) => (
    <ReamarCard className="flex-1 min-w-[200px]">
      <h3 className={`text-sm font-semibold mb-3 ${accent}`}>{title}</h3>
      <div className="text-2xl font-bold text-slate-800 mb-2">{summary.total} bytů</div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">
          Silný: {summary.strong}
        </span>
        <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
          Review: {summary.review}
        </span>
        <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">
          Fallback: {summary.fallback}
        </span>
      </div>
    </ReamarCard>
  );

  const renderSection = (title: string, items: PreviewComparison[], emptyMsg: string) => {
    if (!items.length) return (
      <p className="text-sm text-slate-400 italic">{emptyMsg}</p>
    );
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="py-2 px-3">Projekt</th>
              <th className="py-2 px-3">Byt</th>
              <th className="py-2 px-3 text-right">Starý</th>
              <th className="py-2 px-3 text-right">Nový</th>
              <th className="py-2 px-3 text-right">Delta</th>
              <th className="py-2 px-3">Starý bucket</th>
              <th className="py-2 px-3">Nový bucket</th>
            </tr>
          </thead>
          <tbody>
            {items.map(renderComparisonRow)}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Client selector + compare button */}
      <ReamarCard>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Klient
            </label>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
              value={selectedClient ?? ""}
              onChange={(e) => setSelectedClient(e.target.value ? Number(e.target.value) : null)}
              disabled={loadingClients}
            >
              <option value="">
                {loadingClients ? "Načítám klienty…" : "— Vyberte klienta —"}
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <ReamarButton
            size="sm"
            variant="primary"
            onClick={handleCompare}
            disabled={!selectedClient || loading}
          >
            {loading ? "Počítám…" : "Porovnat"}
          </ReamarButton>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Porovná aktuální (uloženou) konfiguraci s vaším rozpracovaným draftem.
        </p>
      </ReamarCard>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Summary cards */}
          <div className="flex flex-wrap gap-4">
            {renderSummaryCard("Aktivní konfigurace", result.active_summary, "text-slate-600")}
            {renderSummaryCard("Draft konfigurace", result.draft_summary, "text-[#1E3A5F]")}
          </div>

          {/* Main comparison table */}
          <ReamarCard>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Porovnání ({result.comparison.length} bytů)
            </h3>
            {renderSection("", result.comparison, "Žádné byty k porovnání.")}
          </ReamarCard>

          {/* Top movers up */}
          {result.top_movers_up.length > 0 && (
            <ReamarCard>
              <h3 className="text-sm font-semibold text-emerald-700 mb-3">
                📈 Největší zlepšení
              </h3>
              {renderSection("", result.top_movers_up, "")}
            </ReamarCard>
          )}

          {/* Top movers down */}
          {result.top_movers_down.length > 0 && (
            <ReamarCard>
              <h3 className="text-sm font-semibold text-red-700 mb-3">
                📉 Největší zhoršení
              </h3>
              {renderSection("", result.top_movers_down, "")}
            </ReamarCard>
          )}

          {/* Newly visible */}
          {result.newly_visible.length > 0 && (
            <ReamarCard>
              <h3 className="text-sm font-semibold text-emerald-700 mb-3">
                ✨ Nově viditelné byty ({result.newly_visible.length})
              </h3>
              {renderSection("", result.newly_visible, "")}
            </ReamarCard>
          )}

          {/* Newly hidden */}
          {result.newly_hidden.length > 0 && (
            <ReamarCard>
              <h3 className="text-sm font-semibold text-red-700 mb-3">
                🚫 Nově skryté byty ({result.newly_hidden.length})
              </h3>
              {renderSection("", result.newly_hidden, "")}
            </ReamarCard>
          )}
        </>
      )}
    </div>
  );
}


export default function ScoringStudioPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Skupiny");

  // Config state
  const [groups, setGroups] = useState<Record<string, Group>>({});
  const [fieldRules, setFieldRules] = useState<FieldRule[]>([]);
  const [eligibilityRules, setEligibilityRules] = useState<EligibilityRule[]>(
    []
  );
  const [thresholds, setThresholds] = useState<Thresholds>({
    strong_pick_min_score: 70,
    review_pick_min_score: 55,
    hide_below_score: 0,
    default_visible_limit: 50,
    hide_stale_reservations: 1,
    not_seen_max_days: 180,
  });
  const [weights, setWeights] = useState<Weights>({});

  // New group form
  const [newGroupKey, setNewGroupKey] = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("");

  // Expanded field rows
  const [expandedField, setExpandedField] = useState<string | null>(null);

  // Rules view controls
  const [rulesGroupBy, setRulesGroupBy] = useState<"none" | "group" | "client_mode">("none");

  // ── Auth ──
  useEffect(() => {
    const t =
      typeof window !== "undefined"
        ? localStorage.getItem("broker_token")
        : null;
    setToken(t);
  }, []);

  // ── Load config ──
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${API_BASE}/admin/scoring-studio`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: StudioConfig | null) => {
        if (!data) return;
        setGroups(data.groups || {});
        setFieldRules(data.field_rules || []);
        setEligibilityRules(data.eligibility_rules || []);
        setThresholds((prev) => ({
          ...prev,
          ...data.thresholds,
        }));
        setWeights(data.weights || {});
      })
      .finally(() => setLoading(false));
  }, [token]);

  // ── Save ──
  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setToast(null);
    try {
      const payload: StudioConfig = {
        weights,
        thresholds,
        groups,
        field_rules: fieldRules,
        eligibility_rules: eligibilityRules,
      };
      const res = await fetch(`${API_BASE}/admin/scoring-studio`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setToast("✅ Konfigurace uložena.");
      setTimeout(() => setToast(null), 4000);
    } catch (e) {
      setToast(
        e instanceof Error ? `❌ ${e.message}` : "❌ Nepodařilo se uložit."
      );
    } finally {
      setSaving(false);
    }
  };

  // ── Add group ──
  const handleAddGroup = () => {
    const key = newGroupKey.trim().toLowerCase().replace(/\s+/g, "_");
    if (!key || !newGroupLabel.trim()) return;
    if (groups[key]) {
      setToast("Skupina s tímto klíčem už existuje.");
      return;
    }
    setGroups((prev) => ({
      ...prev,
      [key]: {
        label: newGroupLabel.trim(),
        enabled: true,
        weight: 1.0,
        order: Object.keys(prev).length + 1,
      },
    }));
    setNewGroupKey("");
    setNewGroupLabel("");
  };

  // ── Weight helpers ──
  const weightTotal = useMemo(
    () =>
      Object.values(weights).reduce(
        (sum, value) => sum + Number(value || 0),
        0
      ),
    [weights]
  );

  const normalizedPercent = (key: string) => {
    const value = Number(weights[key] || 0);
    if (!weightTotal) return 0;
    return Math.round((value / weightTotal) * 100);
  };

  // ── Guards ──
  if (!token)
    return <p className="text-sm text-slate-600">Nejste přihlášen.</p>;
  if (loading)
    return <p className="text-sm text-slate-600">Načítání Scoring Studio…</p>;

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Scoring Studio
          </h2>
          <p className="text-sm text-slate-500">
            Kompletní konfigurace scoringového enginu — skupiny, pravidla,
            eligibilita, viditelnost a váhy.
          </p>
        </div>
        <ReamarButton
          size="sm"
          variant="primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Ukládám…" : "Uložit vše"}
        </ReamarButton>
      </div>

      {/* Tab nav */}
      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-[#1E3A5F] text-white shadow-sm"
                : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* ═══════════════════ TAB 1: Groups ═══════════════════ */}
      {activeTab === "Skupiny" && (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Klíč</th>
                  <th className="px-3 py-2">Název</th>
                  <th className="px-3 py-2">Zapnuto</th>
                  <th className="px-3 py-2">Váha (0–3)</th>
                  <th className="px-3 py-2">Pořadí</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(groups)
                  .sort(([, a], [, b]) => a.order - b.order)
                  .map(([key, group]) => (
                    <tr
                      key={key}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {key}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={group.label}
                          onChange={(e) =>
                            setGroups((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], label: e.target.value },
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Toggle
                          checked={group.enabled}
                          onChange={(v) =>
                            setGroups((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], enabled: v },
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="3"
                            step="0.1"
                            value={group.weight}
                            onChange={(e) =>
                              setGroups((prev) => ({
                                ...prev,
                                [key]: {
                                  ...prev[key],
                                  weight: Number(e.target.value),
                                },
                              }))
                            }
                            className="w-24"
                          />
                          <span className="w-10 text-right text-xs text-slate-600">
                            {group.weight.toFixed(1)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="1"
                          max="99"
                          value={group.order}
                          onChange={(e) =>
                            setGroups((prev) => ({
                              ...prev,
                              [key]: {
                                ...prev[key],
                                order: Number(e.target.value),
                              },
                            }))
                          }
                          className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Add new group */}
          <ReamarCard className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              Přidat novou skupinu
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Klíč
                </label>
                <input
                  type="text"
                  placeholder="např. extras"
                  value={newGroupKey}
                  onChange={(e) => setNewGroupKey(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Název
                </label>
                <input
                  type="text"
                  placeholder="např. Doplňkové"
                  value={newGroupLabel}
                  onChange={(e) => setNewGroupLabel(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                />
              </div>
              <ReamarButton size="sm" variant="primary" onClick={handleAddGroup}>
                Přidat
              </ReamarButton>
            </div>
          </ReamarCard>

          <div className="flex justify-end">
            <ReamarButton
              size="sm"
              variant="primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Ukládám…" : "Uložit skupiny"}
            </ReamarButton>
          </div>
        </div>
      )}

      {/* ═══════════════════ TAB 2: Field Rules ═══════════════════ */}
      {activeTab === "Pravidla" && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500 text-xs font-medium uppercase tracking-wide">Uspořádat dle:</span>
            {(["none", "group", "client_mode"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setRulesGroupBy(opt)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  rulesGroupBy === opt
                    ? "bg-[#1E3A5F] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt === "none" ? "Výchozí" : opt === "group" ? "Skupina" : "Režim klienta"}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Pravidlo</th>
                  <th className="px-3 py-2">Zapnuto</th>
                  <th className="px-3 py-2">Ve score</th>
                  <th className="px-3 py-2">Skupina</th>
                  <th className="px-3 py-2">Váha</th>
                  <th className="px-3 py-2">Typ</th>
                  <th className="px-3 py-2">Režim klienta</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  if (rulesGroupBy === "none") return fieldRules.map((rule, idx) => ({ rule, idx, groupHeader: null }));
                  const key = rulesGroupBy === "group" ? "group_key" : "client_mode";
                  const sorted = [...fieldRules].sort((a, b) => {
                    const av = (a[key] ?? "—") as string;
                    const bv = (b[key] ?? "—") as string;
                    return av.localeCompare(bv);
                  });
                  let lastGroup: string | null = null;
                  return sorted.map((rule) => {
                    const groupVal = (rule[key] ?? "—") as string;
                    const header = groupVal !== lastGroup ? groupVal : null;
                    lastGroup = groupVal;
                    const idx = fieldRules.indexOf(rule);
                    return { rule, idx, groupHeader: header };
                  });
                })().map(({ rule, idx, groupHeader }) => (
                  <Fragment key={rule.field_key}>
                    {groupHeader !== null && (
                      <tr>
                        <td colSpan={7} className="px-3 pt-4 pb-1">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{groupHeader}</span>
                        </td>
                      </tr>
                    )}
                    <tr
                      className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${
                        expandedField === rule.field_key ? "bg-slate-50" : ""
                      }`}
                      onClick={() =>
                        setExpandedField(
                          expandedField === rule.field_key
                            ? null
                            : rule.field_key
                        )
                      }
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs transition-transform ${
                              expandedField === rule.field_key
                                ? "rotate-90"
                                : ""
                            }`}
                          >
                            ▶
                          </span>
                          <div>
                            <p className="font-medium text-slate-900">
                              {rule.label}
                            </p>
                            <p className="text-[11px] text-slate-400 font-mono">
                              {rule.field_key}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Toggle
                          checked={rule.enabled}
                          onChange={(v) => {
                            const updated = [...fieldRules];
                            updated[idx] = { ...updated[idx], enabled: v };
                            setFieldRules(updated);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Toggle
                          checked={rule.include_in_score}
                          onChange={(v) => {
                            const updated = [...fieldRules];
                            updated[idx] = {
                              ...updated[idx],
                              include_in_score: v,
                            };
                            setFieldRules(updated);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={rule.group_key}
                          onChange={(e) => {
                            const updated = [...fieldRules];
                            updated[idx] = {
                              ...updated[idx],
                              group_key: e.target.value,
                            };
                            setFieldRules(updated);
                          }}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        >
                          {Object.entries(groups).map(([k, g]) => (
                            <option key={k} value={k}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={rule.weight}
                            onChange={(e) => {
                              const updated = [...fieldRules];
                              updated[idx] = {
                                ...updated[idx],
                                weight: Number(e.target.value),
                              };
                              setFieldRules(updated);
                            }}
                            className="w-20"
                          />
                          <span className="w-8 text-right text-xs text-slate-600">
                            {rule.weight.toFixed(1)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {rule.rule_type}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={rule.client_mode || "auto"}
                          onChange={(e) => {
                            const updated = [...fieldRules];
                            updated[idx] = {
                              ...updated[idx],
                              client_mode: e.target.value as "auto" | "wizard" | "hidden",
                            };
                            setFieldRules(updated);
                          }}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        >
                          <option value="auto">Auto</option>
                          <option value="wizard">Wizard</option>
                          <option value="hidden">Skryté</option>
                        </select>
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {expandedField === rule.field_key && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 px-6 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">
                                Typ pravidla
                              </label>
                              <select
                                value={rule.rule_type}
                                onChange={(e) => {
                                  const updated = [...fieldRules];
                                  updated[idx] = {
                                    ...updated[idx],
                                    rule_type: e.target.value,
                                  };
                                  setFieldRules(updated);
                                }}
                                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                              >
                                {RULE_TYPES.map((rt) => (
                                  <option key={rt} value={rt}>
                                    {rt}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">
                                Chybějící hodnota
                              </label>
                              <select
                                value={rule.missing_value_policy}
                                onChange={(e) => {
                                  const updated = [...fieldRules];
                                  updated[idx] = {
                                    ...updated[idx],
                                    missing_value_policy: e.target.value,
                                  };
                                  setFieldRules(updated);
                                }}
                                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                              >
                                {MISSING_POLICIES.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-xs font-medium text-slate-500 mb-1">
                                Šablona vysvětlení
                              </label>
                              <input
                                type="text"
                                value={rule.explanation_template}
                                onChange={(e) => {
                                  const updated = [...fieldRules];
                                  updated[idx] = {
                                    ...updated[idx],
                                    explanation_template: e.target.value,
                                  };
                                  setFieldRules(updated);
                                }}
                                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-xs font-medium text-slate-500 mb-1">
                                Konfigurace pravidla (JSON)
                              </label>
                              <textarea
                                value={JSON.stringify(
                                  rule.rule_config,
                                  null,
                                  2
                                )}
                                onChange={(e) => {
                                  try {
                                    const parsed = JSON.parse(e.target.value);
                                    const updated = [...fieldRules];
                                    updated[idx] = {
                                      ...updated[idx],
                                      rule_config: parsed,
                                    };
                                    setFieldRules(updated);
                                  } catch {
                                    // allow invalid JSON while typing
                                  }
                                }}
                                rows={4}
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>

            </table>
          </div>

          <div className="flex justify-end">
            <ReamarButton
              size="sm"
              variant="primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Ukládám…" : "Uložit pravidla"}
            </ReamarButton>
          </div>
        </div>
      )}

      {/* ═══════════════════ TAB 3: Eligibility ═══════════════════ */}
      {activeTab === "Eligibilita" && (
        <div className="space-y-4">
          {eligibilityRules.map((rule, idx) => {
            const uiType = rule.ui_type;
            const uiDesc = rule.ui_description;
            const uiConfig = rule.ui_config;

            return (
              <ReamarCard key={rule.field} className="p-4">
                {/* ── Header: toggle + label + on_fail ── */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <Toggle
                      checked={rule.enabled}
                      onChange={(v) => {
                        const updated = [...eligibilityRules];
                        updated[idx] = { ...updated[idx], enabled: v };
                        setEligibilityRules(updated);
                      }}
                    />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {rule.label}
                      </h3>
                      {uiDesc && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {uiDesc}
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Při nesplnění
                    </label>
                    <select
                      value={rule.on_fail}
                      onChange={(e) => {
                        const updated = [...eligibilityRules];
                        updated[idx] = {
                          ...updated[idx],
                          on_fail: e.target.value as "reject" | "review",
                        };
                        setEligibilityRules(updated);
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    >
                      <option value="reject">Zamítnout</option>
                      <option value="review">Ke kontrole</option>
                    </select>
                  </div>
                </div>

                {/* ── Parameters by ui_type ── */}
                {rule.enabled && (
                  <>
                    {/* === slider === */}
                    {uiType === "slider" && uiConfig && uiConfig.param && (
                      <div className="mt-3 pl-10">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          {uiConfig.label}
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={uiConfig.min}
                            max={uiConfig.max}
                            step={uiConfig.step}
                            value={rule.config[uiConfig.param] ?? uiConfig.min}
                            onChange={(e) => {
                              const updated = [...eligibilityRules];
                              updated[idx] = {
                                ...updated[idx],
                                config: {
                                  ...updated[idx].config,
                                  [uiConfig.param!]: Number(e.target.value),
                                },
                              };
                              setEligibilityRules(updated);
                            }}
                            className="flex-1 accent-blue-600"
                          />
                          <span className="text-sm font-medium text-slate-700 min-w-[3.5rem] text-right">
                            {rule.config[uiConfig.param] ?? uiConfig.min}
                            {uiConfig.unit ? ` ${uiConfig.unit}` : ""}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* === range (multiple params) === */}
                    {uiType === "range" && uiConfig?.params && (
                      <div className="mt-3 pl-10 space-y-3">
                        {uiConfig.params?.map(
                          (p) => (
                            <div key={p.key}>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                {p.label}
                              </label>
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min={p.min}
                                  max={p.max}
                                  step={p.step}
                                  value={rule.config[p.key] ?? p.min}
                                  onChange={(e) => {
                                    const updated = [...eligibilityRules];
                                    updated[idx] = {
                                      ...updated[idx],
                                      config: {
                                        ...updated[idx].config,
                                        [p.key]: Number(e.target.value),
                                      },
                                    };
                                    setEligibilityRules(updated);
                                  }}
                                  className="flex-1 accent-blue-600"
                                />
                                <span className="text-sm font-medium text-slate-700 min-w-[3.5rem] text-right">
                                  {rule.config[p.key] ?? p.min}
                                  {p.unit ? ` ${p.unit}` : ""}
                                </span>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {/* === simple_toggle — no extra params === */}
                    {uiType === "simple_toggle" && null}

                    {/* === fallback: JSON textarea for unknown/missing ui_type === */}
                    {uiType !== "simple_toggle" &&
                      uiType !== "slider" &&
                      uiType !== "range" && (
                        <div className="mt-3 pl-10">
                          <label className="block text-xs font-medium text-slate-500 mb-1">
                            Konfigurace pravidla (JSON)
                          </label>
                          <textarea
                            value={JSON.stringify(rule.config, null, 2)}
                            onChange={(e) => {
                              try {
                                const parsed = JSON.parse(e.target.value);
                                const updated = [...eligibilityRules];
                                updated[idx] = { ...updated[idx], config: parsed };
                                setEligibilityRules(updated);
                              } catch {
                                // allow invalid JSON while typing
                              }
                            }}
                            rows={3}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                          />
                        </div>
                      )}
                  </>
                )}
              </ReamarCard>
            );
          })}

          <div className="flex justify-end">
            <ReamarButton
              size="sm"
              variant="primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Ukládám…" : "Uložit eligibilitu"}
            </ReamarButton>
          </div>
        </div>
      )}

      {/* ═══════════════════ TAB 4: Visibility (Thresholds) ═══════════════════ */}
      {activeTab === "Viditelnost" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {THRESHOLD_FIELDS.map(({ key, label, help, min, max, step }) => {
              const value = Number(thresholds[key] ?? 0);
              return (
                <ReamarCard key={key} className="p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {label}
                    </h3>
                    <p className="text-[11px] text-slate-500">{help}</p>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) =>
                      setThresholds((prev) => ({
                        ...prev,
                        [key]: Number(e.target.value),
                      }))
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
                      setThresholds((prev) => ({
                        ...prev,
                        [key]: Number(e.target.value),
                      }))
                    }
                    className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </ReamarCard>
              );
            })}
          </div>

          {/* Stale reservation toggle */}
          <ReamarCard className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Skrýt staré rezervace (is_stale_reservation)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Jednotky rezervované déle než 60 dní (dle BuiltMind API) se budou chovat jako prodané — nebudou vstupovat do scoringu.
                  V databázi je aktuálně ~827 takových jednotek.
                </p>
              </div>
              <Toggle
                checked={!!thresholds.hide_stale_reservations}
                onChange={(v) =>
                  setThresholds((prev) => ({
                    ...prev,
                    hide_stale_reservations: v ? 1 : 0,
                  }))
                }
              />
            </div>
          </ReamarCard>

          {/* Visual summary */}
          <ReamarCard className="p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              Jak to funguje
            </h3>
            <ul className="space-y-1 text-sm text-slate-600">
              <li>
                Byt se score ≥{" "}
                <strong>{thresholds.strong_pick_min_score}</strong> ={" "}
                <span className="text-emerald-700 font-medium">
                  Strong pick
                </span>
              </li>
              <li>
                Byt se score ≥{" "}
                <strong>{thresholds.review_pick_min_score}</strong> a &lt;{" "}
                {thresholds.strong_pick_min_score} ={" "}
                <span className="text-blue-700 font-medium">Review pick</span>
              </li>
              <li>
                Byt se score &lt;{" "}
                <strong>{thresholds.review_pick_min_score}</strong> ={" "}
                <span className="text-slate-500 font-medium">
                  Fallback option
                </span>
              </li>
              {thresholds.hide_below_score > 0 && (
                <li>
                  Byt se score &lt;{" "}
                  <strong>{thresholds.hide_below_score}</strong> ={" "}
                  <span className="text-rose-600 font-medium">Skrytý</span>
                </li>
              )}
              <li>
                Maximálně{" "}
                <strong>
                  {thresholds.default_visible_limit || "neomezeno"}
                </strong>{" "}
                doporučení celkem
              </li>
              <li className="pt-1 border-t border-slate-100 mt-1">
                {thresholds.hide_stale_reservations ? (
                  <span>
                    Staré rezervace (<code className="text-xs">is_stale_reservation=true</code>) jsou{" "}
                    <span className="text-rose-600 font-medium">skryté</span> ze scoringu
                  </span>
                ) : (
                  <span>
                    Staré rezervace jsou zahrnuté ve scoringu (jako rezervované)
                  </span>
                )}
              </li>
              <li>
                {(thresholds.not_seen_max_days ?? 0) > 0 ? (
                  <span>
                    Jednotky <code className="text-xs">not_seen</code>, viděné naposledy před méně než{" "}
                    <strong>{thresholds.not_seen_max_days}</strong> dny, jsou{" "}
                    <span className="text-emerald-700 font-medium">zahrnuty</span> ve scoringu
                  </span>
                ) : (
                  <span>
                    Jednotky <code className="text-xs">not_seen</code> jsou ze scoringu{" "}
                    <span className="text-rose-600 font-medium">vyloučeny</span>
                  </span>
                )}
              </li>
            </ul>
          </ReamarCard>

          <div className="flex justify-end">
            <ReamarButton
              size="sm"
              variant="primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Ukládám…" : "Uložit viditelnost"}
            </ReamarButton>
          </div>
        </div>
      )}

      {/* ═══════════════════ TAB 5: Weights ═══════════════════ */}
      {activeTab === "Váhy" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {Object.entries(PRESETS).map(([name, preset]) => (
              <ReamarButton
                key={name}
                size="sm"
                variant="ghost"
                onClick={() => setWeights(preset)}
              >
                {name.charAt(0).toUpperCase() + name.slice(1)}
              </ReamarButton>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries(WEIGHT_LABELS).map(([key, label]) => {
              const value = Number(weights[key] || 0);
              return (
                <ReamarCard key={key} className="p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {label}
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Aktuálně {normalizedPercent(key)} %
                      </p>
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
                    onChange={(e) =>
                      setWeights((prev) => ({
                        ...prev,
                        [key]: Number(e.target.value),
                      }))
                    }
                    className="w-full"
                  />
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={value}
                    onChange={(e) =>
                      setWeights((prev) => ({
                        ...prev,
                        [key]: Number(e.target.value),
                      }))
                    }
                    className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </ReamarCard>
              );
            })}
          </div>

          <ReamarCard className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Kontrola součtu
                </h3>
                <p className="text-xs text-slate-500">
                  Backend váhy normalizuje na součet 1.0 automaticky.
                </p>
              </div>
              <div
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                  Math.abs(weightTotal - 1) < 0.001
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                Součet: {weightTotal.toFixed(2)}
              </div>
            </div>
          </ReamarCard>

          <div className="flex justify-end">
            <ReamarButton
              size="sm"
              variant="primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Ukládám…" : "Uložit váhy"}
            </ReamarButton>
          </div>
        </div>
      )}

      {/* ═══════════════════ TAB 6: Preview ═══════════════════ */}
      {activeTab === "Preview" && (
        <PreviewTab
          token={token}
          weights={weights}
          thresholds={thresholds}
          groups={groups}
          fieldRules={fieldRules}
          eligibilityRules={eligibilityRules}
        />
      )}

      {/* Toast */}
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
