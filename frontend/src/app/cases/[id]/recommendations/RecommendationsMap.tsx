"use client";

import { useMemo, useRef, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L, { type LatLngExpression, type LatLngBoundsExpression, type DivIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RecommendationItem } from "@/lib/caseTypes";

// Fix default marker icons for bundlers.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - accessing internal default icon options
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

/** Color-coded circle marker based on score. */
function makeScoreIcon(score: number, unitCount: number): DivIcon {
  const color =
    score >= 80 ? "#059669" :
    score >= 60 ? "#2563eb" :
    score >= 40 ? "#d97706" : "#94a3b8";

  const size = unitCount > 1 ? 22 : 16;
  const anchor = size / 2;
  const label = unitCount > 1 ? `${unitCount}` : "";
  const html =
    unitCount > 1
      ? `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;">${label}</div>`
      : `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`;

  return L.divIcon({
    className: "",
    html,
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
}

function formatPrice(czk: number): string {
  if (czk >= 1_000_000) return `${(czk / 1_000_000).toFixed(1)} M Kč`;
  return `${czk.toLocaleString("cs-CZ")} Kč`;
}

// ── Commute helpers ──────────────────────────────────────────────────────────

type ItineraryLeg = {
  mode: string;
  duration_min: number;
  from: string;
  to: string;
  line?: string;
};

type CommuteDetail = {
  label: string;
  mode: string;
  minutes: number;
  max_minutes: number;
  priority: string;
  passed: boolean;
  itinerary?: ItineraryLeg[] | null;
  is_estimated?: boolean;
};

const LEG_MODE_ICON: Record<string, string> = {
  WALK: "🚶",
  BUS: "🚌",
  SUBWAY: "🚇",
  TRAM: "🚋",
  RAIL: "🚆",
  CAR: "🚗",
  FERRY: "⛴️",
};

const MODE_ICON: Record<string, string> = {
  transit: "🚌",
  drive: "🚗",
  park_and_ride: "🅿️",
};

const MODE_LABEL: Record<string, string> = {
  transit: "MHD",
  drive: "Auto",
  park_and_ride: "P+R",
};

/** Haversine distance in km between two GPS points. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

const PRAGUE_CENTER: [number, number] = [50.0755, 14.4378];

/** Commute section shown inside the popup. */
function CommuteSection({ pin }: { pin: ProjectPin }) {
  // commute_details is stored in reason_json — available on first unit
  const details: CommuteDetail[] =
    (pin.units[0]?.reason?.commute_details as CommuteDetail[] | undefined) ?? [];

  // ── case 1: real commute data from scoring ────────────────────────────
  if (details.length > 0) {
    return (
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Dojezd
        </p>
        {details.map((d, i) => {
          const mins = Math.round(d.minutes);
          const ok = d.passed;
          const estimated = d.is_estimated ?? false;
          const hasItinerary = d.itinerary && d.itinerary.length > 0;
          return (
            <div key={i} className="relative group flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1 min-w-0 truncate text-slate-600 cursor-default">
                <span>{MODE_ICON[d.mode] ?? "📍"}</span>
                <span className="truncate">{d.label}</span>
                <span className="shrink-0 text-slate-400">
                  ({MODE_LABEL[d.mode] ?? d.mode})
                </span>
                {hasItinerary && (
                  <span className="text-slate-300 text-[10px]">ⓘ</span>
                )}
                {estimated && (
                  <span className="text-slate-300 text-[10px]" title="Odhad vzdušnou čarou — recompute pro přesné hodnoty">~</span>
                )}
              </span>
              <span
                className={`shrink-0 font-semibold tabular-nums ${
                  estimated ? "text-slate-400" : ok ? "text-emerald-600" : "text-rose-500"
                }`}
                title={estimated ? "Odhad vzdušnou čarou" : undefined}
              >
                {estimated ? "~" : ""}{mins} min
              </span>
              {hasItinerary && (
                <div className="pointer-events-none invisible absolute left-0 bottom-full z-50 mb-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg text-xs group-hover:visible">
                  {d.itinerary!.map((leg, j) => (
                    <div key={j} className="flex items-start gap-1.5 py-0.5">
                      <span className="shrink-0">{LEG_MODE_ICON[leg.mode] ?? "•"}</span>
                      <span className="min-w-0">
                        <span className="font-medium">
                          {leg.line ? `${leg.line} · ` : ""}{leg.duration_min} min
                        </span>
                        {leg.to && (
                          <span className="text-slate-400"> → {leg.to}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── case 2: no commute points → fallback: distance to Prague center ──
  if (pin.lat == null || pin.lng == null) return null;
  const distKm = haversineKm(pin.lat, pin.lng, PRAGUE_CENTER[0], PRAGUE_CENTER[1]);
  const transitEst = Math.round((distKm / 25) * 60);
  const driveEst = Math.round((distKm / 40) * 60);

  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Do centra Prahy (odhad)
      </p>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 text-slate-600">
          <span>🚌</span><span>MHD</span>
        </span>
        <span className="font-semibold tabular-nums text-slate-700">~{transitEst} min</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 text-slate-600">
          <span>🚗</span><span>Auto</span>
        </span>
        <span className="font-semibold tabular-nums text-slate-700">~{driveEst} min</span>
      </div>
      <p className="text-[10px] text-slate-400">vzdušnou čarou · {distKm.toFixed(1)} km</p>
    </div>
  );
}

// ── Project pin types ────────────────────────────────────────────────────────

/** Groups recs by project (same project_id → same pin location).
 *  Returns one entry per project with its best-scored unit. */
type ProjectPin = {
  project_id: number;
  project_name: string;
  lat: number;
  lng: number;
  maxScore: number;
  units: RecommendationItem[];
};

function buildProjectPins(recs: RecommendationItem[]): ProjectPin[] {
  const map = new Map<number, ProjectPin>();
  for (const r of recs) {
    if (r.project_lat == null || r.project_lng == null || r.project_id == null) continue;
    const existing = map.get(r.project_id);
    if (!existing) {
      map.set(r.project_id, {
        project_id: r.project_id,
        project_name: r.project_name ?? `Projekt ${r.project_id}`,
        lat: r.project_lat,
        lng: r.project_lng,
        maxScore: r.score,
        units: [r],
      });
    } else {
      existing.units.push(r);
      if (r.score > existing.maxScore) existing.maxScore = r.score;
    }
  }
  return Array.from(map.values());
}

/** Fits the map view to the given pins once, on mount. */
function FitBounds({ pins }: { pins: ProjectPin[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || pins.length === 0) return;
    fitted.current = true;
    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], 13);
    } else {
      const lats = pins.map((p) => p.lat);
      const lngs = pins.map((p) => p.lng);
      const bounds: LatLngBoundsExpression = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ];
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [pins, map]);
  return null;
}

function UnitRow({ u }: { u: RecommendationItem }) {
  const ext = u.exterior_area_m2;
  return (
    <a
      href={u.unit_external_id ? `/units/${encodeURIComponent(u.unit_external_id)}` : "#"}
      className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-slate-50 transition-colors"
    >
      <span className="min-w-0 truncate">
        {u.layout_label ?? u.layout ?? "—"}
        {u.floor_area_m2 ? ` · ${u.floor_area_m2} m²` : ""}
        {u.price_czk ? ` · ${formatPrice(u.price_czk)}` : ""}
        {ext != null && ext > 0 ? ` · ext ${ext} m²` : ""}
      </span>
      <span className="shrink-0 font-medium text-slate-800">{Math.round(u.score)}</span>
    </a>
  );
}

function MapInner({
  pins,
  onProjectFeedback,
  savingProjectId,
}: {
  pins: ProjectPin[];
  onProjectFeedback: (recIds: number[], feedbackType: "liked" | "disliked") => void;
  savingProjectId: number | null;
}) {
  return (
    <>
      <FitBounds pins={pins} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {pins.map((pin) => {
        const position: LatLngExpression = [pin.lat, pin.lng];
        const icon = makeScoreIcon(pin.maxScore, pin.units.length);
        const completion = pin.units[0]?.construction_completion;
        return (
          <Marker key={pin.project_id} position={position} icon={icon}>
            <Popup minWidth={300} maxWidth={420}>
              <div className="min-w-[300px] max-w-[420px] space-y-2.5 text-sm">
                {/* Project header */}
                <a
                  href={`/projects/${pin.project_id}`}
                  className="block font-semibold text-blue-700 hover:underline"
                >
                  {pin.project_name}
                </a>

                {/* Project meta */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                  <span>
                    {pin.units.length}{" "}
                    {pin.units.length === 1
                      ? "jednotka"
                      : pin.units.length < 5
                      ? "jednotky"
                      : "jednotek"}
                  </span>
                  {completion && <span>Dokončení: {completion}</span>}
                  <span>Skóre: {Math.round(pin.maxScore)}</span>
                </div>

                {/* Commute times */}
                <CommuteSection pin={pin} />

                {/* Divider */}
                <div className="border-t border-slate-100" />

                {/* Project-level feedback */}
                <div className="flex gap-1.5">
                  {(() => {
                    const allLiked = pin.units.every(
                      (u) => u.feedback?.feedback_type === "liked"
                    );
                    const allDisliked = pin.units.every(
                      (u) => u.feedback?.feedback_type === "disliked"
                    );
                    const recIds = pin.units.map((u) => u.rec_id);
                    const saving = savingProjectId === pin.project_id;
                    return (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onProjectFeedback(recIds, "liked");
                          }}
                          disabled={saving}
                          className={`flex-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors ${
                            allLiked
                              ? "bg-emerald-600 text-white"
                              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          }`}
                        >
                          ♥ Líbí se projekt
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onProjectFeedback(recIds, "disliked");
                          }}
                          disabled={saving}
                          className={`flex-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors ${
                            allDisliked
                              ? "bg-rose-600 text-white"
                              : "bg-rose-50 text-rose-700 hover:bg-rose-100"
                          }`}
                        >
                          ✕ Nechci projekt
                        </button>
                      </>
                    );
                  })()}
                </div>

                {/* Unit list */}
                <div className="space-y-0 divide-y divide-slate-100 text-xs text-slate-600">
                  {pin.units.slice(0, 8).map((u) => (
                    <UnitRow key={u.rec_id} u={u} />
                  ))}
                  {pin.units.length > 8 && (
                    <p className="py-0.5 text-slate-400">
                      +{pin.units.length - 8} dalších
                    </p>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

export default function RecommendationsMap({
  recs,
  onProjectFeedback,
  savingProjectId,
}: {
  recs: RecommendationItem[];
  /** Callback to apply feedback to ALL units in a project at once. */
  onProjectFeedback?: (recIds: number[], feedbackType: "liked" | "disliked") => void;
  savingProjectId?: number | null;
}) {
  const pins = useMemo(() => buildProjectPins(recs), [recs]);

  if (pins.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
        <p className="text-sm text-slate-500">
          {recs.length === 0
            ? "Žádná doporučení k zobrazení na mapě."
            : "Projekty v doporučeních nemají GPS souřadnice."}
        </p>
      </div>
    );
  }

  const defaultCenter: LatLngExpression = [50.0755, 14.4378];
  const noop = () => {};

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200" style={{ height: 480 }}>
      <MapContainer
        center={defaultCenter}
        zoom={11}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <MapInner
          pins={pins}
          onProjectFeedback={onProjectFeedback ?? noop}
          savingProjectId={savingProjectId ?? null}
        />
      </MapContainer>
    </div>
  );
}
