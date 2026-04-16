"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Polygon, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import L, { type LatLngExpression, type LatLngBoundsExpression, type DivIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationProjectPoint } from "./ClientLocationMap";

// Fix default marker icons so they render correctly in bundlers.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - accessing internal default icon options
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type Point = { lat: number; lng: number };
type Area = Point[];

/** Minimal subset needed for map rendering — keeps this component
 *  independent of wizard-layer types. */
export type CommuteMarkerPoint = {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
};

type EditorProps = {
  areas: Area[];
  onChange: (areas: Area[]) => void;
  activeAreaIndex: number;
  onActiveAreaChange: (index: number) => void;
  projects: LocationProjectPoint[];
  /** Controls click behaviour and which toolbar is shown.
   *  "polygon" (default): clicks add polygon vertices during draw mode.
   *  "commute": clicks call onCommuteClick regardless of draw mode. */
  mapMode?: "polygon" | "commute";
  /** Commute point markers to display on the map. */
  commutePoints?: CommuteMarkerPoint[];
  /** Called when user clicks the map while mapMode === "commute". */
  onCommuteClick?: (lat: number, lng: number) => void;
  /** When true, renders the map at a fixed tall height instead of aspect-[4/3]. */
  tall?: boolean;
};

function FitBounds({ areas, commutePoints }: { areas: Area[]; commutePoints: CommuteMarkerPoint[] }) {
  const map = useMap();
  const hasFit = useRef(false);
  useEffect(() => {
    if (hasFit.current) return;
    // Prefer fitting on polygon areas first
    const allPoints = areas.flat();
    if (allPoints.length) {
      const lats = allPoints.map((p) => p.lat);
      const lngs = allPoints.map((p) => p.lng);
      const bounds: LatLngBoundsExpression = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ];
      map.fitBounds(bounds, { padding: [20, 20] });
      hasFit.current = true;
      return;
    }
    // No polygon — fall back to commute points
    const located = commutePoints.filter((cp) => cp.lat !== null && cp.lng !== null);
    if (!located.length) return;
    if (located.length === 1) {
      map.setView([located[0].lat as number, located[0].lng as number], 13);
    } else {
      const lats = located.map((cp) => cp.lat as number);
      const lngs = located.map((cp) => cp.lng as number);
      const bounds: LatLngBoundsExpression = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ];
      map.fitBounds(bounds, { padding: [60, 60] });
    }
    hasFit.current = true;
  }, [areas, commutePoints, map]);
  return null;
}

const intakeMarkerIconCache = new Map<string, DivIcon>();

function getProjectMarkerIcon(color: string, emphasized: boolean): DivIcon {
  const key = `${color}-${emphasized ? "emph" : "normal"}`;
  const cached = intakeMarkerIconCache.get(key);
  if (cached) return cached;
  const html = emphasized
    ? `<div style="width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid #ffffff;box-shadow:0 0 0 1px rgba(15,23,42,0.4);"></div>`
    : `<div style="width:10px;height:10px;border-radius:9999px;background:${color};border:2px solid #e5e7eb;box-shadow:0 0 0 1px rgba(148,163,184,0.3);"></div>`;
  const icon = L.divIcon({
    className: "",
    html,
    iconSize: emphasized ? [18, 18] : [16, 16],
    iconAnchor: emphasized ? [9, 9] : [8, 8],
  });
  intakeMarkerIconCache.set(key, icon);
  return icon;
}

const vertexIcon = L.divIcon({
  className: "",
  html: `<div style="width:10px;height:10px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.4);"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

/** Numbered pin icon for commute points. Shows first letter of label (or index). */
function getCommuteMarkerIcon(label: string, index: number): DivIcon {
  const letter = label.trim()
    ? label.trim()[0].toUpperCase()
    : String(index + 1);
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:50%;background:#7c3aed;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.35);">${letter}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/** Captures map clicks when in commute mode (always enabled, no draw toggle). */
function CommuteClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function pointInPolygon(point: Point, polygon: Area): boolean {
  if (polygon.length < 3) return false;
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0000001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function priceToColor(value: number | null | undefined, prices: number[]): string {
  if (!prices.length || value == null || !Number.isFinite(value)) {
    return "#9ca3af";
  }
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  if (maxPrice <= minPrice) {
    return "#f97316";
  }
  const tRaw = (value - minPrice) / (maxPrice - minPrice);
  const t = Math.max(0, Math.min(1, tRaw));
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  let h: number, s: number, l: number;
  if (t <= 0.5) {
    const u = t / 0.5;
    h = lerp(140, 30, u);
    s = lerp(70, 90, u);
    l = lerp(45, 50, u);
  } else {
    const u = (t - 0.5) / 0.5;
    h = lerp(30, 0, u);
    s = lerp(90, 80, u);
    l = lerp(50, 50, u);
  }
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Same click-to-add as main map: only captures clicks during drawing mode */
function ClickCapture({ drawing, onClick }: { drawing: boolean; onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (!drawing) return;
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function ClientLocationMapInner({
  areas,
  onChange,
  activeAreaIndex,
  onActiveAreaChange,
  projects,
  mapMode = "polygon",
  commutePoints = [],
  onCommuteClick,
  tall = false,
}: EditorProps) {
  const [drawing, setDrawing] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<Point[]>([]);

  const savedPolygon = areas[activeAreaIndex] ?? [];
  // During drawing show draft; otherwise show saved polygon
  const activePolygon = draftPolygon.length >= 2 ? draftPolygon : savedPolygon;

  const firstPoint = areas.find((a) => a.length > 0)?.[0];
  const center: LatLngExpression = firstPoint
    ? [firstPoint.lat, firstPoint.lng]
    : [50.0755, 14.4378];

  const handleMapClick = (lat: number, lng: number) => {
    setDraftPolygon((prev) => [...prev, { lat, lng }]);
  };

  const handleStartDrawing = () => {
    setDraftPolygon([]);
    setDrawing(true);
  };

  const handleSaveArea = () => {
    if (draftPolygon.length < 3) return;
    const next = areas.slice();
    if (activeAreaIndex >= 0 && activeAreaIndex < next.length) {
      next[activeAreaIndex] = draftPolygon;
    } else {
      next.push(draftPolygon);
      onActiveAreaChange(next.length - 1);
    }
    onChange(next);
    setDrawing(false);
    setDraftPolygon([]);
  };

  const handleCancelDrawing = () => {
    setDrawing(false);
    setDraftPolygon([]);
  };

  const handleClearArea = () => {
    const next = areas.map((a, i) => (i === activeAreaIndex ? [] : a));
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {/* Polygon-mode toolbar (hidden in commute mode) */}
      {mapMode === "polygon" && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!drawing) handleStartDrawing();
              else handleCancelDrawing();
            }}
            className={
              "rounded-full border px-3 py-1.5 text-xs font-medium transition " +
              (drawing
                ? "border-sky-600 bg-sky-600 text-white hover:bg-sky-700"
                : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50")
            }
          >
            {drawing ? "Zrušit kreslení" : "Kreslit oblast"}
          </button>
          {drawing && draftPolygon.length >= 3 && (
            <button
              type="button"
              onClick={handleSaveArea}
              className="rounded-full border border-emerald-500 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Uložit oblast
            </button>
          )}
          {!drawing && savedPolygon.length >= 3 && (
            <button
              type="button"
              onClick={handleClearArea}
              className="text-xs text-slate-600 underline decoration-dotted underline-offset-2 hover:text-slate-900"
            >
              Zrušit oblast
            </button>
          )}
          {drawing && (
            <span className="text-[11px] text-slate-500">
              Klikejte na mapu pro přidání bodů ({draftPolygon.length} bodů)
            </span>
          )}
        </div>
      )}

      {/* Commute-mode hint */}
      {mapMode === "commute" && (
        <p className="text-[11px] text-violet-700">
          Kliknutím na mapu přidáte bod dojíždění s vybraným typem.
        </p>
      )}

      <div className={`relative z-0 ${tall ? "h-[520px]" : "aspect-[4/3]"} overflow-hidden rounded-lg border border-slate-200`}>
        <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          {/* Polygon-mode click capture */}
          {mapMode === "polygon" && (
            <ClickCapture drawing={drawing} onClick={handleMapClick} />
          )}
          {/* Commute-mode click capture */}
          {mapMode === "commute" && onCommuteClick && (
            <CommuteClickCapture onClick={onCommuteClick} />
          )}

          {/* Saved polygons (all areas) */}
          {!drawing &&
            areas.map((area, areaIndex) =>
              area.length >= 3 ? (
                <Polygon
                  key={areaIndex}
                  positions={area.map((p) => [p.lat, p.lng]) as LatLngExpression[]}
                  pathOptions={{
                    color: areaIndex === activeAreaIndex ? "#2563eb" : "#94a3b8",
                    weight: areaIndex === activeAreaIndex ? 3 : 2,
                    fillColor: "#3b82f6",
                    fillOpacity: 0.15,
                  }}
                  eventHandlers={{ click: () => onActiveAreaChange(areaIndex) }}
                />
              ) : null
            )}

          {/* Saved polygon vertex markers (draggable, clickable to delete) — only when NOT drawing */}
          {!drawing &&
            areas.map((area, areaIndex) =>
              area.map((p, pointIndex) => (
                <Marker
                  key={`v-${areaIndex}-${pointIndex}`}
                  position={[p.lat, p.lng]}
                  icon={vertexIcon}
                  draggable
                  eventHandlers={{
                    dragend: (e) => {
                      const { lat, lng } = e.target.getLatLng();
                      const next = areas.map((poly, idx) =>
                        idx === areaIndex
                          ? poly.map((pt, j) => (j === pointIndex ? { lat, lng } : pt))
                          : poly
                      );
                      onChange(next);
                    },
                    dblclick: () => {
                      const next = areas.map((poly, idx) =>
                        idx === areaIndex
                          ? poly.filter((_, j) => j !== pointIndex)
                          : poly
                      );
                      onChange(next);
                    },
                  }}
                />
              ))
            )}

          {/* Draft polygon during drawing */}
          {drawing && activePolygon.length >= 2 && (
            <Polygon
              positions={activePolygon.map((p) => [p.lat, p.lng]) as LatLngExpression[]}
              pathOptions={{ color: "#2563eb", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.15 }}
            />
          )}

          {/* Draft vertex markers during drawing */}
          {drawing &&
            draftPolygon.map((p, i) => (
              <Marker
                key={`draft-${i}`}
                position={[p.lat, p.lng]}
                icon={vertexIcon}
              />
            ))}

          {/* Project markers */}
          {(() => {
            const priced = projects
              .map((p) =>
                typeof p.avg_price_per_m2_czk === "number"
                  ? (p.avg_price_per_m2_czk as number)
                  : null
              )
              .filter((v): v is number => v != null && Number.isFinite(v));

            const checkArea = !drawing && savedPolygon.length >= 3 ? savedPolygon : undefined;

            return projects
              .filter((p) => p.gps_latitude != null && p.gps_longitude != null)
              .map((p) => {
                const pt: Point = {
                  lat: p.gps_latitude as number,
                  lng: p.gps_longitude as number,
                };
                const isInside = checkArea ? pointInPolygon(pt, checkArea) : false;
                const color = priceToColor(p.avg_price_per_m2_czk ?? null, priced);
                const icon = getProjectMarkerIcon(color, isInside);

                return (
                  <Marker
                    key={`project-${p.id}`}
                    position={[pt.lat, pt.lng]}
                    icon={icon}
                  >
                    <Popup>
                      <div className="space-y-0.5 text-xs">
                        <div className="font-semibold text-slate-900">
                          {p.project ?? "Projekt bez názvu"}
                        </div>
                        <div className="text-slate-700">
                          {[p.city, p.municipality].filter(Boolean).join(", ") || "—"}
                        </div>
                        {p.avg_price_per_m2_czk != null && (
                          <div className="text-slate-800">
                            Průměrná cena m²:{" "}
                            {new Intl.NumberFormat("cs-CZ", {
                              maximumFractionDigits: 0,
                              minimumFractionDigits: 0,
                            }).format(p.avg_price_per_m2_czk)}{" "}
                            Kč/m²
                          </div>
                        )}
                        {checkArea && (
                          isInside ? (
                            <div className="text-[10px] text-emerald-600">Uvnitř vybrané oblasti</div>
                          ) : (
                            <div className="text-[10px] text-slate-500">Mimo vybranou oblast</div>
                          )
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              });
          })()}
          {/* Commute point markers — shown in both modes for visual context */}
          {commutePoints
            .filter((cp) => cp.lat !== null && cp.lng !== null)
            .map((cp, idx) => (
              <Marker
                key={`commute-${cp.id}`}
                position={[cp.lat as number, cp.lng as number]}
                icon={getCommuteMarkerIcon(cp.label, idx)}
              >
                <Popup>
                  <div className="space-y-0.5 text-xs">
                    <div className="font-semibold text-violet-800">{cp.label || `Bod ${idx + 1}`}</div>
                  </div>
                </Popup>
              </Marker>
            ))}

          <FitBounds areas={areas} commutePoints={commutePoints} />
        </MapContainer>
      </div>
    </div>
  );
}
