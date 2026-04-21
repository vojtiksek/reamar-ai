"use client";

/** Shared walkability sidebar card used on project detail page. */

function scoreBarColor(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-sky-500";
  if (score >= 40) return "bg-amber-400";
  return "bg-rose-500";
}

function ScoreBar({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${scoreBarColor(pct)}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatDistance(v: unknown): string {
  if (v == null) return "—";
  const m = Number(v);
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

const CATEGORIES = [
  { key: "daily_needs", pKey: "walkability_daily_needs_score", label: "Denní potřeby" },
  { key: "transport",   pKey: "walkability_transport_score",   label: "Doprava" },
  { key: "leisure",     pKey: "walkability_leisure_score",     label: "Volný čas" },
  { key: "family",      pKey: "walkability_family_score",      label: "Rodina" },
] as const;

const POI_LIST = [
  { cat: "supermarkets",     label: "Supermarket", dist: "distance_to_supermarket_m",      count: "count_supermarket_500m" },
  { cat: "pharmacies",       label: "Lékárna",     dist: "distance_to_pharmacy_m",          count: "count_pharmacy_500m" },
  { cat: "tram_stops",       label: "Tram",        dist: ["walking_distance_to_tram_stop_m","distance_to_tram_stop_m"] as string[] },
  { cat: "bus_stops",        label: "Bus",         dist: ["walking_distance_to_bus_stop_m","distance_to_bus_stop_m"] as string[] },
  { cat: "metro_stations",   label: "Metro",       dist: ["walking_distance_to_metro_station_m","distance_to_metro_station_m"] as string[] },
  { cat: "parks",            label: "Park",        dist: "distance_to_park_m",              count: "count_park_500m" },
  { cat: "restaurants",      label: "Restaurace",  dist: "distance_to_restaurant_m" },
  { cat: "cafes",            label: "Kavárna",     dist: "distance_to_cafe_m" },
  { cat: "fitness",          label: "Fitness",     dist: "distance_to_fitness_m" },
  { cat: "kindergartens",    label: "Školka",      dist: "distance_to_kindergarten_m" },
  { cat: "primary_schools",  label: "ZŠ",          dist: "distance_to_primary_school_m" },
  { cat: "playgrounds",      label: "Hřiště",      dist: "distance_to_playground_m" },
] as const;

type PersonalizedWalk = Record<string, unknown> | null;

type Props = {
  project: Record<string, unknown>;
  personalizedWalk: PersonalizedWalk;
  personalizedModeEnabled: boolean;
  onSetPersonalizedModeEnabled: (v: boolean) => void;
  onPreferencesOpen: () => void;
  onPoiClick: (cat: string, label: string) => void;
};

export function WalkabilityCard({
  project,
  personalizedWalk,
  personalizedModeEnabled,
  onSetPersonalizedModeEnabled,
  onPreferencesOpen,
  onPoiClick,
}: Props) {
  const effectiveScore =
    personalizedWalk?.score != null
      ? Math.round(personalizedWalk.score as number)
      : project["walkability_score"] != null
      ? Math.round(Number(project["walkability_score"]))
      : null;

  const effectiveLabel =
    (personalizedWalk?.label as string | null | undefined) ??
    (project["walkability_label"] as string | null) ??
    "";

  return (
    <div className="rv2-card">
      <div className="rv2-section-head">
        <h2 className="rv2-section-title">Walkability</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              borderColor: "var(--r-border-default)",
              color: "var(--r-text-secondary)",
              background: "var(--r-surface-1)",
            }}
            onClick={onPreferencesOpen}
          >
            Preference
          </button>
          {personalizedModeEnabled && (
            <button
              type="button"
              className="text-xs underline decoration-dotted hover:opacity-70"
              style={{ color: "var(--r-text-tertiary)" }}
              onClick={() => onSetPersonalizedModeEnabled(false)}
            >
              Vypnout
            </button>
          )}
        </div>
      </div>

      <div className="rv2-section-body">
        {/* Overall score */}
        <div className="flex items-end gap-3 mb-4">
          <div>
            <p className="text-xs font-medium mb-1" style={{ color: "var(--r-text-secondary)" }}>
              Skóre
              {personalizedModeEnabled && (
                <span className="text-emerald-600"> dle preferencí</span>
              )}
            </p>
            <p className="text-3xl font-bold" style={{ color: "var(--r-text-primary)" }}>
              {effectiveScore ?? "—"}
            </p>
            <ScoreBar score={effectiveScore} />
          </div>
          <p className="mb-1 text-sm font-medium" style={{ color: "var(--r-text-secondary)" }}>
            {effectiveLabel}
          </p>
        </div>

        {/* Category scores */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
          {CATEGORIES.map(({ key, pKey, label }) => {
            const score =
              (personalizedWalk as Record<string, unknown> | null)?.[key] != null
                ? Math.round((personalizedWalk as Record<string, unknown>)[key] as number)
                : project[pKey] != null
                ? Number(project[pKey])
                : null;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs" style={{ color: "var(--r-text-secondary)" }}>{label}</p>
                  <p className="text-xs font-semibold" style={{ color: "var(--r-text-primary)" }}>
                    {score != null ? Math.round(score) : "—"}
                  </p>
                </div>
                <ScoreBar score={score} />
              </div>
            );
          })}
        </div>

        {/* POI distances */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {POI_LIST.map(({ cat, label, dist, ...rest }) => {
            const count = "count" in rest ? (rest as { count: string }).count : undefined;
            const distKey = Array.isArray(dist)
              ? dist.find((k) => project[k] != null)
              : dist;
            const distVal = distKey ? project[distKey as string] : null;
            if (distVal == null) return null;
            const countVal = count ? project[count] : null;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onPoiClick(cat, label)}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:opacity-80 transition-opacity text-left"
                style={{ background: "var(--r-surface-0)" }}
              >
                <span style={{ color: "var(--r-text-secondary)" }}>{label}</span>
                <span className="font-medium" style={{ color: "var(--r-text-primary)" }}>
                  {formatDistance(distVal)}
                  {countVal != null && Number(countVal) > 0 && (
                    <span style={{ color: "var(--r-text-tertiary)" }}> ({String(countVal)})</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
