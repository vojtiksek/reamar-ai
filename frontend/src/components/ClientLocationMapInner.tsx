"use client";

import { useEffect, useRef } from "react";
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

type EditorProps = {
  areas: Area[];
  onChange: (areas: Area[]) => void;
  activeAreaIndex: number;
  onActiveAreaChange: (index: number) => void;
  projects: LocationProjectPoint[];
};

function FitBounds({ areas }: { areas: Area[] }) {
  const map = useMap();
  const hasFit = useRef(false);
  useEffect(() => {
    if (hasFit.current) return;
    const allPoints = areas.flat();
    if (!allPoints.length) return;
    const lats = allPoints.map((p) => p.lat);
    const lngs = allPoints.map((p) => p.lng);
    const bounds: LatLngBoundsExpression = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
    map.fitBounds(bounds, { padding: [20, 20] });
    hasFit.current = true;
  }, [areas, map]);
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
    return "#9ca3af"; // gray-400
  }
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  if (maxPrice <= minPrice) {
    return "#f97316"; // orange-500
  }
  const tRaw = (value - minPrice) / (maxPrice - minPrice);
  const t = Math.max(0, Math.min(1, tRaw));
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

  // 0 -> green, 0.5 -> orange, 1 -> red
  let h: number;
  let s: number;
  let l: number;

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

export function ClientLocationMapInner({
  areas,
  onChange,
  activeAreaIndex,
  onActiveAreaChange,
  projects,
}: EditorProps) {
  const hasAny = areas.some((a) => a.length >= 3);
  const firstPoint = areas.find((a) => a.length > 0)?.[0];
  const center: LatLngExpression = firstPoint
    ? [firstPoint.lat, firstPoint.lng]
    : [50.0755, 14.4378]; // Praha

  return (
    <div className="space-y-2">
      <div className="aspect-[4/3] overflow-hidden rounded-lg border border-slate-200">
        <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          {areas.map((area, areaIndex) =>
            area.length >= 3 ? (
              <Polygon
                key={areaIndex}
                positions={area.map((p) => [p.lat, p.lng]) as LatLngExpression[]}
                pathOptions={{
                  color: areaIndex === activeAreaIndex ? "#2563eb" : "#94a3b8",
                  weight: areaIndex === activeAreaIndex ? 3 : 2,
                }}
                eventHandlers={{
                  click: () => {
                    onActiveAreaChange(areaIndex);
                  },
                }}
              />
            ) : null
          )}
          {areas.map((area, areaIndex) =>
            area.map((p, pointIndex) => (
              <Marker
                // eslint-disable-next-line react/no-array-index-key
                key={`${areaIndex}-${pointIndex}`}
                position={[p.lat, p.lng]}
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
                  click: () => {
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
          {(() => {
            const priced = projects
              .map((p) =>
                typeof p.avg_price_per_m2_czk === "number"
                  ? (p.avg_price_per_m2_czk as number)
                  : null
              )
              .filter((v): v is number => v != null && Number.isFinite(v));

            return projects
              .filter((p) => p.gps_latitude != null && p.gps_longitude != null)
              .map((p) => {
                const pt: Point = {
                  lat: p.gps_latitude as number,
                  lng: p.gps_longitude as number,
                };
                const activeArea =
                  activeAreaIndex >= 0 && activeAreaIndex < areas.length
                    ? areas[activeAreaIndex]
                    : undefined;
                const isInside =
                  activeArea && activeArea.length >= 3 ? pointInPolygon(pt, activeArea) : false;

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
                        {isInside ? (
                          <div className="text-[10px] text-emerald-600">Uvnitř vybrané oblasti</div>
                        ) : (
                          <div className="text-[10px] text-slate-500">Mimo vybranou oblast</div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              });
          })()}
          <FitBounds areas={areas} />
          <ClickInsert
            areas={areas}
            onChange={onChange}
            activeAreaIndex={activeAreaIndex}
            onActiveAreaChange={onActiveAreaChange}
          />
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
        <span>
          Kliknutím do mapy vložíte nový bod (mezi stávající). Přetažením bodů je můžete upravit.
        </span>
      </div>
    </div>
  );
}

function ClickInsert({
  areas,
  onChange,
  activeAreaIndex,
  onActiveAreaChange,
}: {
  areas: Area[];
  onChange: (areas: Area[]) => void;
  activeAreaIndex: number;
  onActiveAreaChange: (index: number) => void;
}) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      if (!areas.length) {
        onChange([[{ lat, lng }]]);
        onActiveAreaChange(0);
        return;
      }
      const clampedIndex =
        activeAreaIndex >= 0 && activeAreaIndex < areas.length ? activeAreaIndex : 0;
      const area = areas[clampedIndex];
      if (area.length < 1) {
        const next = areas.slice();
        next[clampedIndex] = [{ lat, lng }];
        onChange(next);
        return;
      }
      // find best segment to insert between
      let bestIndex = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < area.length; i++) {
        const j = (i + 1) % area.length;
        const d = segmentDistance(area[i], area[j], { lat, lng });
        if (d < bestDist) {
          bestDist = d;
          bestIndex = j;
        }
      }
      const newArea = [...area.slice(0, bestIndex), { lat, lng }, ...area.slice(bestIndex)];
      const next = areas.map((poly, i) => (i === clampedIndex ? newArea : poly));
      onChange(next);
    },
  });
  return null;
}

function segmentDistance(a: Point, b: Point, p: Point): number {
  const ax = a.lat;
  const ay = a.lng;
  const bx = b.lat;
  const by = b.lng;
  const px = p.lat;
  const py = p.lng;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const dxp = px - ax;
    const dyp = py - ay;
    return Math.sqrt(dxp * dxp + dyp * dyp);
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));
  const cx = ax + tt * dx;
  const cy = ay + tt * dy;
  const dcx = px - cx;
  const dcy = py - cy;
  return Math.sqrt(dcx * dcx + dcy * dcy);
}

