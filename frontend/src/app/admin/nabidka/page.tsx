"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

type Thresholds = Record<string, number>;

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
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
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function NabidkaPage() {
  const [thresholds, setThresholds] = useState<Thresholds>({
    strong_pick_min_score: 70,
    review_pick_min_score: 55,
    hide_below_score: 0,
    default_visible_limit: 50,
    hide_stale_reservations: 1,
    not_seen_max_days: 180,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/admin/scoring-thresholds`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { thresholds: Thresholds } | null) => {
        if (data?.thresholds) {
          setThresholds((prev) => ({ ...prev, ...data.thresholds }));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch(`${API_BASE}/admin/scoring-thresholds`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thresholds),
      });
      if (!res.ok) throw new Error(await res.text());
      setToast("✅ Uloženo.");
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setToast(e instanceof Error ? `❌ ${e.message}` : "❌ Nepodařilo se uložit.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-slate-400">Načítám…</div>;
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm ${toast.startsWith("✅") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {toast}
        </div>
      )}

      {/* not_seen_max_days */}
      <ReamarCard className="p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Not seen — max. dní od posledního výskytu</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Jednotky se statusem <code className="text-xs">not_seen</code>, viděné naposledy před méně než N dny, vstoupí do nabídky.
            0 = not_seen vyloučit.
          </p>
        </div>
        <input
          type="range"
          min={0}
          max={730}
          step={30}
          value={thresholds.not_seen_max_days ?? 180}
          onChange={(e) => setThresholds((prev) => ({ ...prev, not_seen_max_days: Number(e.target.value) }))}
          className="w-full"
        />
        <input
          type="number"
          min={0}
          max={730}
          step={30}
          value={thresholds.not_seen_max_days ?? 180}
          onChange={(e) => setThresholds((prev) => ({ ...prev, not_seen_max_days: Number(e.target.value) }))}
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
        />
      </ReamarCard>

      {/* hide_stale_reservations */}
      <ReamarCard className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Skrýt staré rezervace</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Jednotky rezervované déle než 60 dní (dle BuiltMind API) se budou chovat jako prodané —
              nebudou vstupovat do nabídky. V databázi je aktuálně ~827 takových jednotek.
            </p>
          </div>
          <Toggle
            checked={!!thresholds.hide_stale_reservations}
            onChange={(v) => setThresholds((prev) => ({ ...prev, hide_stale_reservations: v ? 1 : 0 }))}
          />
        </div>
      </ReamarCard>

      {/* Summary */}
      <ReamarCard className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">Aktuální pravidla nabídky</h3>
        <ul className="space-y-1 text-sm text-slate-600">
          <li>
            {thresholds.hide_stale_reservations ? (
              <span>
                Staré rezervace (<code className="text-xs">is_stale_reservation=true</code>) jsou{" "}
                <span className="text-rose-600 font-medium">vyloučeny</span> z nabídky
              </span>
            ) : (
              <span>Staré rezervace jsou zahrnuté v nabídce (jako rezervované)</span>
            )}
          </li>
          <li>
            {(thresholds.not_seen_max_days ?? 0) > 0 ? (
              <span>
                Jednotky <code className="text-xs">not_seen</code>, viděné naposledy před méně než{" "}
                <strong>{thresholds.not_seen_max_days}</strong> dny, jsou{" "}
                <span className="text-emerald-700 font-medium">zahrnuty</span> v nabídce
              </span>
            ) : (
              <span>
                Jednotky <code className="text-xs">not_seen</code> jsou z nabídky{" "}
                <span className="text-rose-600 font-medium">vyloučeny</span>
              </span>
            )}
          </li>
        </ul>
      </ReamarCard>

      <div className="flex justify-end">
        <ReamarButton size="sm" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Ukládám…" : "Uložit"}
        </ReamarButton>
      </div>
    </div>
  );
}
