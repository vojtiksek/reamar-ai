"use client";

import Link from "next/link";
import { formatCurrencyCzk } from "@/lib/format";
import type {
  RecommendationDislikeReason,
  RecommendationFeedbackType,
  RecommendationItem,
} from "@/lib/caseTypes";

const POI_LABELS: Record<string, string> = {
  supermarket: "Obchod",
  pharmacy: "Lékárna",
  park: "Park",
  restaurant: "Restaurace",
  cafe: "Kavárna",
  fitness: "Fitness",
  playground: "Hřiště",
  kindergarten: "Školka",
  primary_school: "Základní škola",
};

const MHD_LABELS: Array<{
  key: "metro" | "tram" | "bus" | "train";
  field:
    | "distance_to_metro_station_m"
    | "distance_to_tram_stop_m"
    | "distance_to_bus_stop_m"
    | "distance_to_train_station_m";
  label: string;
}> = [
  { key: "metro", field: "distance_to_metro_station_m", label: "Metro" },
  { key: "tram", field: "distance_to_tram_stop_m", label: "Tramvaj" },
  { key: "bus", field: "distance_to_bus_stop_m", label: "Bus" },
  { key: "train", field: "distance_to_train_station_m", label: "Vlak" },
];

type Props = {
  unit: RecommendationItem;
  onClose: () => void;
  onPin: () => void;
  onFeedback: (
    type: RecommendationFeedbackType,
    options?: {
      dislikeReason?: RecommendationDislikeReason | null;
      note?: string | null;
    },
  ) => void;
  onClearFeedback: () => void;
  saving: boolean;
};

function scoreColor(score: number): string {
  if (score >= 85) return "var(--r-state-success)";
  if (score >= 70) return "var(--r-state-info)";
  if (score >= 55) return "var(--r-state-warning)";
  return "var(--r-text-tertiary)";
}

export function UnitInspectorV2({
  unit,
  onClose,
  onPin,
  onFeedback,
  onClearFeedback,
  saving,
}: Props) {
  const r = unit;
  const fb = r.feedback?.feedback_type;

  return (
    <aside className="rv2-drawer" aria-label="Detail jednotky">
      <header className="rv2-drawer-header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: "var(--r-font-11)",
              color: "var(--r-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "var(--r-tracking-wide)",
              marginBottom: 2,
            }}
          >
            {r.project_name ?? "Projekt"}
          </div>
          <div className="rv2-drawer-title">
            {r.unit_external_id ?? r.layout_label ?? "Jednotka"}
          </div>
          <div className="rv2-drawer-subtitle">
            {r.layout_label && <span>{r.layout_label}</span>}
            {r.floor_area_m2 != null && <span> · {Math.round(r.floor_area_m2)} m²</span>}
            {r.floor != null && <span> · {r.floor}. patro</span>}
            {r.district && <span> · {r.district}</span>}
          </div>
        </div>
        <button
          type="button"
          className="rv2-drawer-close"
          onClick={onClose}
          aria-label="Zavřít detail"
        >
          ×
        </button>
      </header>

      <div className="rv2-drawer-body">
        {/* Score + price */}
        <section className="rv2-drawer-section">
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "var(--r-space-3)",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "var(--r-font-28)",
                  fontWeight: 600,
                  color: scoreColor(r.score),
                  lineHeight: 1,
                }}
              >
                {Math.round(r.score)}
              </div>
              <div
                style={{
                  fontSize: "var(--r-font-11)",
                  color: "var(--r-text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--r-tracking-wide)",
                  marginTop: 2,
                }}
              >
                Celkové skóre
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              {r.price_czk != null && (
                <div style={{ fontSize: "var(--r-font-16)", fontWeight: 600 }}>
                  {formatCurrencyCzk(r.price_czk)}
                </div>
              )}
              {r.price_per_m2_czk != null && (
                <div style={{ fontSize: "var(--r-font-12)", color: "var(--r-text-tertiary)" }}>
                  {r.price_per_m2_czk.toLocaleString("cs-CZ")} Kč/m²
                </div>
              )}
              {r.price_diff_pct != null && (
                <div
                  style={{
                    fontSize: "var(--r-font-12)",
                    fontWeight: 500,
                    marginTop: 2,
                    color:
                      r.price_diff_pct <= -5
                        ? "var(--r-state-success)"
                        : r.price_diff_pct >= 5
                          ? "var(--r-state-danger)"
                          : "var(--r-text-tertiary)",
                  }}
                >
                  {r.price_diff_pct >= 0 ? "+" : ""}
                  {Math.round(r.price_diff_pct)} % vs trh
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Score breakdown */}
        <section className="rv2-drawer-section">
          <div className="rv2-drawer-section-label">Složky skóre</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "Rozpočet", value: r.budget_fit },
              { label: "Lokalita", value: r.location_fit },
              { label: "Dispozice", value: r.layout_fit },
              { label: "Plocha", value: r.area_fit },
              { label: "Venkovní", value: r.outdoor_fit },
              { label: "Docházka / POI", value: r.walkability_fit },
              ...(r.commute_fit != null
                ? [{ label: "Dojíždění", value: r.commute_fit }]
                : []),
            ].map((row) => (
              <div key={row.label} style={{ display: "flex", alignItems: "center", gap: "var(--r-space-2)", fontSize: "var(--r-font-12)" }}>
                <span style={{ width: 100, color: "var(--r-text-tertiary)" }}>{row.label}</span>
                <div
                  style={{
                    flex: 1,
                    height: 4,
                    background: "var(--r-surface-2)",
                    borderRadius: 999,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(0, Math.min(100, Math.round(row.value)))}%`,
                      background: scoreColor(row.value),
                    }}
                  />
                </div>
                <span style={{ width: 32, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--r-text-primary)" }}>
                  {Math.round(row.value)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Strengths */}
        {r.top_strengths && r.top_strengths.length > 0 && (
          <section className="rv2-drawer-section">
            <div className="rv2-drawer-section-label">Proč sedí</div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {r.top_strengths.slice(0, 4).map((s, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: "var(--r-font-13)",
                    color: "var(--r-text-primary)",
                    paddingLeft: 16,
                    position: "relative",
                  }}
                >
                  <span style={{ position: "absolute", left: 0, color: "var(--r-state-success)" }}>✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Compromises */}
        {r.top_compromises && r.top_compromises.length > 0 && (
          <section className="rv2-drawer-section">
            <div className="rv2-drawer-section-label">Kompromisy</div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {r.top_compromises.slice(0, 4).map((s, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: "var(--r-font-13)",
                    color: "var(--r-text-primary)",
                    paddingLeft: 16,
                    position: "relative",
                  }}
                >
                  <span style={{ position: "absolute", left: 0, color: "var(--r-state-warning)" }}>−</span>
                  {s}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Transport */}
        {MHD_LABELS.some(({ field }) => r[field] != null) && (
          <section className="rv2-drawer-section">
            <div className="rv2-drawer-section-label">Dostupnost</div>
            <dl className="rv2-def-list">
              {MHD_LABELS.map(({ key, field, label }) => {
                const d = r[field];
                if (d == null) return null;
                return (
                  <div key={key} style={{ display: "contents" }}>
                    <dt>{label}</dt>
                    <dd>{Math.round(d)} m</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        )}

        {/* POI */}
        {r.poi_counts && Object.keys(r.poi_counts).length > 0 && (
          <section className="rv2-drawer-section">
            <div className="rv2-drawer-section-label">Okolí do 500 m</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {Object.entries(r.poi_counts)
                .filter(([, count]) => count > 0)
                .slice(0, 10)
                .map(([key, count]) => (
                  <span key={key} className="rv2-badge rv2-badge-shortlist">
                    {POI_LABELS[key] ?? key} · {count}
                  </span>
                ))}
            </div>
          </section>
        )}

        {/* Noise */}
        {(r.noise_label || r.noise_day_db != null) && (
          <section className="rv2-drawer-section">
            <div className="rv2-drawer-section-label">Hluk</div>
            <dl className="rv2-def-list">
              {r.noise_label && (
                <div style={{ display: "contents" }}>
                  <dt>Kategorie</dt>
                  <dd>{r.noise_label}</dd>
                </div>
              )}
              {r.noise_day_db != null && (
                <div style={{ display: "contents" }}>
                  <dt>Den</dt>
                  <dd>{Math.round(r.noise_day_db)} dB</dd>
                </div>
              )}
              {r.noise_night_db != null && (
                <div style={{ display: "contents" }}>
                  <dt>Noc</dt>
                  <dd>{Math.round(r.noise_night_db)} dB</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* Confidence */}
        {r.confidence_label && (
          <section className="rv2-drawer-section">
            <div className="rv2-drawer-section-label">Jistota hodnocení</div>
            <div style={{ fontSize: "var(--r-font-13)" }}>
              {r.confidence_label}
              {r.confidence != null && (
                <span style={{ color: "var(--r-text-tertiary)", marginLeft: 6 }}>
                  ({Math.round(r.confidence * 100)} %)
                </span>
              )}
            </div>
            {r.confidence_reasons && r.confidence_reasons.length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
                {r.confidence_reasons.slice(0, 3).map((s, i) => (
                  <li key={i} style={{ fontSize: "var(--r-font-12)", color: "var(--r-text-secondary)" }}>
                    · {s}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <footer className="rv2-drawer-footer" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div style={{ display: "flex", gap: "var(--r-space-2)", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`rv2-button ${r.pinned_by_broker ? "rv2-button-primary" : "rv2-button-secondary"}`}
            onClick={onPin}
            disabled={saving}
            style={{ flex: 1 }}
          >
            {r.pinned_by_broker ? "★ Ve výběru" : "★ Přidat do výběru"}
          </button>
        </div>
        <div style={{ display: "flex", gap: "var(--r-space-2)", flexWrap: "wrap" }}>
          <button
            type="button"
            className="rv2-button rv2-button-secondary"
            onClick={() => (fb === "liked" ? onClearFeedback() : onFeedback("liked"))}
            disabled={saving}
            style={{
              flex: 1,
              background: fb === "liked" ? "var(--r-state-success-soft)" : undefined,
              color: fb === "liked" ? "var(--r-state-success)" : undefined,
              borderColor: fb === "liked" ? "var(--r-state-success-soft)" : undefined,
            }}
          >
            ♥ {fb === "liked" ? "Líbí se" : "Líbí"}
          </button>
          <button
            type="button"
            className="rv2-button rv2-button-secondary"
            onClick={() => (fb === "disliked" ? onClearFeedback() : onFeedback("disliked"))}
            disabled={saving}
            style={{
              flex: 1,
              background: fb === "disliked" ? "var(--r-state-danger-soft)" : undefined,
              color: fb === "disliked" ? "var(--r-state-danger)" : undefined,
              borderColor: fb === "disliked" ? "var(--r-state-danger-soft)" : undefined,
            }}
          >
            ✕ {fb === "disliked" ? "Nechci" : "Vyřadit"}
          </button>
        </div>
        {r.unit_external_id && (
          <Link href={`/units/${encodeURIComponent(r.unit_external_id)}`} target="_blank">
            <button type="button" className="rv2-button rv2-button-ghost" style={{ width: "100%" }}>
              Otevřít celý detail ↗
            </button>
          </Link>
        )}
      </footer>
    </aside>
  );
}
