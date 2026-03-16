"use client";

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
  if (!areas.length) return null;
  const allPoints = areas.flat();
  if (!allPoints.length) return null;
  const lats = allPoints.map((p) => p.lat);
  const lngs = allPoints.map((p) => p.lng);
  const bounds: LatLngBoundsExpression = [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
  map.fitBounds(bounds, { padding: [20, 20] });
  return null;
}

const projectMarkerIcon: DivIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:9999px;background:#0f766e;border:2px solid #ffffff;box-shadow:0 0 0 1px rgba(15,23,42,0.35);"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

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
          {projects
            .filter((p) => p.gps_latitude != null && p.gps_longitude != null)
            .map((p) => (
              <Marker
                key={`project-${p.id}`}
                position={[p.gps_latitude as number, p.gps_longitude as number]}
                icon={projectMarkerIcon}
              >
                <Popup>
                  <div className="space-y-0.5 text-xs">
                    <div className="font-semibold text-slate-900">
                      {p.project ?? "Projekt bez názvu"}
                    </div>
                    <div className="text-slate-700">
                      {[p.city, p.municipality].filter(Boolean).join(", ") || "—"}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
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

