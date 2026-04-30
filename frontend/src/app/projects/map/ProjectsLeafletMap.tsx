"use client";

import { MapContainer, Marker, Polygon, Popup, TileLayer, useMapEvent } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/geo";
import { POI_CATEGORY_COLORS, POI_CATEGORY_LABELS } from "@/lib/poiConfig";
import { formatLayout } from "@/lib/format";

type CheapestUnit = {
  layout: string | null;
  unit_external_id: string | null;
  price_czk: number | null;
  floor_area_m2: number | null;
  exterior_area_m2: number | null;
};

type ProjectPoint = {
  id: number;
  project: string | null;
  developer?: string | null;
  address?: string | null;
  municipality?: string | null;
  city?: string | null;
  district?: string | null;
  avg_price_per_m2_czk?: number | null;
  min_price_czk?: number | null;
  max_price_czk?: number | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  units_total?: number | null;
  units_available?: number | null;
  units_reserved?: number | null;
  max_days_on_market?: number | null;
  completion_date?: string | null;
  construction_completion?: string | null;
  ride_to_center_min?: number | null;
  public_transport_to_center_min?: number | null;
  walkability_score?: number | null;
  walkability_label?: string | null;
  distance_to_metro_station_m?: number | null;
  distance_to_tram_stop_m?: number | null;
  energy_class?: string | null;
  project_url?: string | null;
  cheapest_units_by_layout?: CheapestUnit[];
};

function formatDistance(m: number | null | undefined): string | null {
  if (m == null) return null;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function formatCzk(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M Kč`;
  return `${value.toLocaleString("cs-CZ")} Kč`;
}

function formatCompletion(item: ProjectPoint): string | null {
  if (item.construction_completion) return item.construction_completion;
  if (item.completion_date) {
    // YYYY-MM-DD → YYYY-MM
    return item.completion_date.slice(0, 7);
  }
  return null;
}

function pluralizeUnits(n: number): string {
  if (n === 1) return "jednotka";
  if (n < 5) return "jednotky";
  return "jednotek";
}

export type PoiOverviewItem = {
  name: string | null;
  distance_m: number | null;
  lat: number | null;
  lon: number | null;
};

export type PoiOverview = {
  project: { lat: number; lon: number };
  categories: Record<string, PoiOverviewItem[]>;
} | null;

export { POI_CATEGORY_COLORS, POI_CATEGORY_LABELS } from "@/lib/poiConfig";

const poiIconCache = new Map<string, L.DivIcon>();
function getPoiCategoryIcon(category: string): L.DivIcon {
  const color = POI_CATEGORY_COLORS[category] ?? "#64748b";
  const cached = poiIconCache.get(category);
  if (cached) return cached;
  const icon = L.divIcon({
    className: "poi-category-marker",
    html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:1px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.2);"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
  poiIconCache.set(category, icon);
  return icon;
}

type Props = {
  projects: ProjectPoint[];
  center: LatLngExpression;
  polygon: LatLng[];
  draftPolygon: LatLng[];
  drawing: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  selectedProjectId?: number | null;
  onProjectSelect?: (id: number | null) => void;
  poiOverview?: PoiOverview;
};

// Cache barevně odlišených ikon podle hex/HSL barvy, ať zbytečně nevytváříme
// nové instancie `L.divIcon` pro stejnou barvu.
const markerIconCache = new Map<string, L.DivIcon>();

function getProjectMarkerIcon(color: string): L.DivIcon {
  const key = color || "#2563eb";
  const cached = markerIconCache.get(key);
  if (cached) return cached;
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:9999px;background:${key};border:2px solid #ffffff;box-shadow:0 0 0 1px rgba(15,23,42,0.4);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  markerIconCache.set(key, icon);
  return icon;
}

function ClickCapture(props: { drawing: boolean; onClick?: (lat: number, lng: number) => void }) {
  useMapEvent("click", (e) => {
    if (!props.drawing || !props.onClick) return;
    props.onClick(e.latlng.lat, e.latlng.lng);
  });
  return null;
}

function ProjectsLeafletMap({
  projects,
  center,
  polygon,
  draftPolygon,
  drawing,
  onMapClick,
  selectedProjectId = null,
  onProjectSelect,
  poiOverview = null,
}: Props) {
  const activePolygon = draftPolygon.length >= 2 ? draftPolygon : polygon;

  // Vypočítat rozsah průměrných cen m² pro škálování barev
  // (nejlevnější = zelená, střed = oranžová, nejdražší = červená).
  const prices = projects
    .map((p) => (typeof p.avg_price_per_m2_czk === "number" ? p.avg_price_per_m2_czk : null))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  const priceToColor = (value: number | null | undefined): string => {
    // Šedá pro projekty bez ceny m²
    if (!prices.length || value == null || !Number.isFinite(value)) {
      return "#9ca3af"; // gray-400
    }
    if (minPrice == null || maxPrice == null || maxPrice <= minPrice) {
      // Jediná hodnota – neutrální oranžová
      return "#f97316"; // orange-500
    }
    const tRaw = (value - minPrice) / (maxPrice - minPrice);
    const t = Math.max(0, Math.min(1, tRaw));

    // Interpolace: 0 → zelená, 0.5 → oranžová, 1 → červená.
    const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

    // HSL body (přibližně Tailwind):
    // zelená:  h=140, s=70, l=45  (#22c55e)
    // oranžová: h=30,  s=90, l=50 (#f97316)
    // červená:  h=0,   s=80, l=50 (#dc2626)
    let h: number;
    let s: number;
    let l: number;

    if (t <= 0.5) {
      const u = t / 0.5; // 0–1 mezi zelenou a oranžovou
      h = lerp(140, 30, u);
      s = lerp(70, 90, u);
      l = lerp(45, 50, u);
    } else {
      const u = (t - 0.5) / 0.5; // 0–1 mezi oranžovou a červenou
      h = lerp(30, 0, u);
      s = lerp(90, 80, u);
      l = lerp(50, 50, u);
    }

    return `hsl(${h}, ${s}%, ${l}%)`;
  };

  return (
    <MapContainer
      center={center}
      zoom={11}
      className="h-full w-full z-0"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickCapture drawing={drawing} onClick={onMapClick} />
      {activePolygon.length >= 2 && (
        <Polygon
          positions={activePolygon.map((p) => [p.lat, p.lng]) as [number, number][]}
          pathOptions={{ color: "#2563eb", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.15 }}
        />
      )}
      {/* Markers on each polygon vertex during drawing */}
      {drawing && draftPolygon.map((p, i) => (
        <Marker
          key={`draft-${i}`}
          position={[p.lat, p.lng]}
          icon={L.divIcon({
            className: "",
            html: `<div style="width:10px;height:10px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.4);"></div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 5],
          })}
        />
      ))}
      {projects
        .filter((p) => p.gps_latitude != null && p.gps_longitude != null)
        .map((p) => (
          <Marker
            key={p.id}
            position={[p.gps_latitude as number, p.gps_longitude as number]}
            icon={getProjectMarkerIcon(
              selectedProjectId === p.id ? "#0f172a" : priceToColor(p.avg_price_per_m2_czk ?? null)
            )}
            eventHandlers={
              onProjectSelect
                ? {
                    click: () => onProjectSelect(selectedProjectId === p.id ? null : p.id),
                  }
                : undefined
            }
          >
            <Popup
              minWidth={320}
              maxWidth={400}
              className="reamar-rich-popup"
              autoPan={true}
            >
              <div className="w-[320px] overflow-hidden">
                {/* Header — gradient strip edge-to-edge */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-3 text-white">
                  <Link
                    href={`/projects/${p.id}`}
                    className="block text-[15px] font-semibold leading-tight tracking-tight hover:underline"
                  >
                    {p.project ?? "Projekt bez názvu"}
                  </Link>
                  <div className="mt-0.5 truncate text-[11px] text-slate-300" title={p.address ?? undefined}>
                    {p.developer ||
                      [p.city, p.municipality, p.district].filter(Boolean).join(" · ") ||
                      "—"}
                  </div>
                </div>

                {/* Body */}
                <div className="space-y-3 px-4 py-3">
                  {/* Stat chips */}
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {p.units_available != null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {p.units_available} volných
                        {p.units_total != null && ` z ${p.units_total}`}
                      </span>
                    )}
                    {(() => {
                      const c = formatCompletion(p);
                      return c ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
                          <span>📅</span>
                          {c}
                        </span>
                      ) : null;
                    })()}
                    {p.walkability_score != null && (
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium " +
                          (p.walkability_score > 0
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-500")
                        }
                        title={p.walkability_label ?? undefined}
                      >
                        <span>🚶</span>
                        Walk {p.walkability_score}
                        {p.walkability_label ? ` · ${p.walkability_label}` : ""}
                      </span>
                    )}
                    {p.energy_class && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-lime-50 px-2 py-0.5 font-medium text-lime-700">
                        ⚡ {p.energy_class}
                      </span>
                    )}
                    {p.max_days_on_market != null && p.max_days_on_market <= 30 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                        🆕 {p.max_days_on_market} dní
                      </span>
                    )}
                  </div>

                  {/* Price block: avg + range */}
                  {(p.avg_price_per_m2_czk != null ||
                    (p.min_price_czk != null && p.max_price_czk != null)) && (
                    <div className="grid grid-cols-2 gap-2">
                      {p.avg_price_per_m2_czk != null && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-400">
                            Průměrná cena
                          </div>
                          <div className="text-base font-semibold tabular-nums leading-tight text-slate-900">
                            {new Intl.NumberFormat("cs-CZ", {
                              maximumFractionDigits: 0,
                            }).format(Math.round(p.avg_price_per_m2_czk))}
                          </div>
                          <div className="text-[10px] text-slate-500">Kč/m²</div>
                        </div>
                      )}
                      {p.min_price_czk != null && p.max_price_czk != null && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-400">
                            Rozsah cen
                          </div>
                          <div className="text-[12px] font-semibold tabular-nums leading-tight text-slate-900">
                            {formatCzk(p.min_price_czk)}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            až {formatCzk(p.max_price_czk)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Commute */}
                  {(p.ride_to_center_min != null ||
                    p.public_transport_to_center_min != null) && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400">
                        Do centra Prahy
                      </p>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        {p.public_transport_to_center_min != null && (
                          <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                            <div className="flex items-center gap-1 text-[11px] text-slate-500">
                              <span>🚌</span>
                              <span>MHD</span>
                            </div>
                            <div className="text-sm font-semibold tabular-nums text-slate-800">
                              ~{Math.round(p.public_transport_to_center_min)} min
                            </div>
                          </div>
                        )}
                        {p.ride_to_center_min != null && (
                          <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                            <div className="flex items-center gap-1 text-[11px] text-slate-500">
                              <span>🚗</span>
                              <span>Auto</span>
                            </div>
                            <div className="text-sm font-semibold tabular-nums text-slate-800">
                              ~{Math.round(p.ride_to_center_min)} min
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Public transport stops */}
                  {(p.distance_to_metro_station_m != null ||
                    p.distance_to_tram_stop_m != null) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                      {p.distance_to_metro_station_m != null && (
                        <span>
                          🚇 metro{" "}
                          <span className="font-medium tabular-nums">
                            {formatDistance(p.distance_to_metro_station_m)}
                          </span>
                        </span>
                      )}
                      {p.distance_to_tram_stop_m != null && (
                        <span>
                          🚊 tram{" "}
                          <span className="font-medium tabular-nums">
                            {formatDistance(p.distance_to_tram_stop_m)}
                          </span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Cheapest unit per layout (volné) */}
                  {p.cheapest_units_by_layout && p.cheapest_units_by_layout.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400">
                        Nejlevnější volná
                      </p>
                      <div className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
                        {p.cheapest_units_by_layout.slice(0, 8).map((u) => (
                          <a
                            key={u.unit_external_id ?? u.layout ?? Math.random()}
                            href={
                              u.unit_external_id
                                ? `/units/${encodeURIComponent(u.unit_external_id)}`
                                : "#"
                            }
                            className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 text-xs transition-colors hover:bg-slate-50"
                          >
                            <span className="flex min-w-0 items-baseline gap-1.5 truncate">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                                {formatLayout(u.layout)}
                              </span>
                              {u.floor_area_m2 != null && (
                                <span className="text-slate-600">{u.floor_area_m2} m²</span>
                              )}
                              {u.exterior_area_m2 != null && u.exterior_area_m2 > 0 && (
                                <span className="text-[10px] text-slate-400">
                                  ext {u.exterior_area_m2} m²
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                              {formatCzk(u.price_czk)}
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer actions — edge-to-edge */}
                <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px]">
                  {onProjectSelect && (
                    <button
                      type="button"
                      onClick={() =>
                        onProjectSelect(selectedProjectId === p.id ? null : p.id)
                      }
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 transition-colors hover:bg-slate-100"
                    >
                      {selectedProjectId === p.id ? "Skrýt POI" : "Nejbližší POI"}
                    </button>
                  )}
                  {p.project_url && (
                    <a
                      href={p.project_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                      title="Otevře web developera"
                    >
                      Web developera ↗
                    </a>
                  )}
                  <Link
                    href={`/projects/${p.id}`}
                    className="ml-auto inline-flex items-center gap-0.5 rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white transition-colors hover:bg-slate-700"
                  >
                    Detail
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      {poiOverview?.project && poiOverview.categories && (
        <>
          {Object.entries(poiOverview.categories).map(([category, items]) =>
            (items || [])
              .filter((i): i is PoiOverviewItem & { lat: number; lon: number } => i.lat != null && i.lon != null)
              .map((item, idx) => (
                <Marker
                  key={`${category}-${idx}-${item.lat}-${item.lon}`}
                  position={[item.lat, item.lon]}
                  icon={getPoiCategoryIcon(category)}
                >
                  <Popup>
                    <div className="text-xs">
                      <span className="font-medium text-slate-900">{item.name ?? "—"}</span>
                      <span className="ml-1 text-slate-600">
                        ({POI_CATEGORY_LABELS[category] ?? category})
                        {item.distance_m != null &&
                          ` · ${item.distance_m >= 1000 ? `${(item.distance_m / 1000).toFixed(1)} km` : `${Math.round(item.distance_m)} m`}`}
                      </span>
                    </div>
                  </Popup>
                </Marker>
              ))
          )}
        </>
      )}
    </MapContainer>
  );
}

export default ProjectsLeafletMap;

