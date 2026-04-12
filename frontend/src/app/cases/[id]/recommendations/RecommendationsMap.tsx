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

function MapInner({ pins }: { pins: ProjectPin[] }) {
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
        return (
          <Marker key={pin.project_id} position={position} icon={icon}>
            <Popup>
              <div className="min-w-[160px] space-y-1 text-sm">
                <p className="font-semibold text-slate-900">{pin.project_name}</p>
                {pin.units.length === 1 ? (
                  <div className="space-y-0.5 text-xs text-slate-600">
                    <p>Skóre: <span className="font-medium text-slate-900">{Math.round(pin.units[0].score)}</span></p>
                    {pin.units[0].layout_label && <p>Dispozice: {pin.units[0].layout_label}</p>}
                    {pin.units[0].floor_area_m2 && <p>Plocha: {pin.units[0].floor_area_m2} m²</p>}
                    {pin.units[0].price_czk && <p>Cena: {formatPrice(pin.units[0].price_czk)}</p>}
                  </div>
                ) : (
                  <div className="space-y-1 text-xs text-slate-600">
                    <p>{pin.units.length} jednotek · nejlepší skóre: <span className="font-medium text-slate-900">{Math.round(pin.maxScore)}</span></p>
                    <ul className="space-y-0.5">
                      {pin.units.slice(0, 5).map((u) => (
                        <li key={u.rec_id} className="flex justify-between gap-3">
                          <span>{u.layout_label ?? u.layout ?? "—"}{u.floor_area_m2 ? ` · ${u.floor_area_m2} m²` : ""}</span>
                          <span className="font-medium text-slate-800">{Math.round(u.score)}</span>
                        </li>
                      ))}
                      {pin.units.length > 5 && (
                        <li className="text-slate-400">+{pin.units.length - 5} dalších</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

export default function RecommendationsMap({ recs }: { recs: RecommendationItem[] }) {
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

  // Default center: Prague (fallback before FitBounds fires)
  const defaultCenter: LatLngExpression = [50.0755, 14.4378];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200" style={{ height: 480 }}>
      <MapContainer
        center={defaultCenter}
        zoom={11}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <MapInner pins={pins} />
      </MapContainer>
    </div>
  );
}
