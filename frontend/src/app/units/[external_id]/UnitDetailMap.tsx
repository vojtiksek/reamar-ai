"use client";

import type { FC } from "react";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression } from "leaflet";
import type { DivIcon } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { POI_CATEGORY_COLORS, POI_CATEGORY_LABELS } from "@/app/projects/map/ProjectsLeafletMap";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });
const Tooltip = dynamic(() => import("react-leaflet").then((m) => m.Tooltip), { ssr: false });

/** Vlastní ikona: tečka (kolečko) místo výchozího markeru, aby se nezobrazovaly otazníky. */
function useDotMarkerIcon(): DivIcon | null {
  const [icon, setIcon] = useState<DivIcon | null>(null);
  useEffect(() => {
    void import("leaflet").then((L) => {
      setIcon(
        L.divIcon({
          className: "unit-detail-marker-dot",
          html: '<span style="display:block;width:16px;height:16px;background:#0f172a;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></span>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        })
      );
    });
  }, []);
  return icon;
}

type PoiOverviewItem = {
  name: string | null;
  distance_m: number | null;
  lat: number | null;
  lon: number | null;
};

type PoiOverview = {
  project: { lat: number; lon: number };
  categories: Record<string, PoiOverviewItem[]>;
} | null;

const POI_CATEGORY_LETTERS: Record<string, string> = {
  supermarkets: "S",
  pharmacies: "L",
  parks: "P",
  restaurants: "R",
  cafes: "C",
  fitness: "F",
  playgrounds: "H",
  kindergartens: "Š",
  primary_schools: "Z",
  tram_stops: "T",
  bus_stops: "B",
  metro_stations: "M",
};

const poiIconCache = new Map<string, DivIcon>();

function getPoiIcon(category: string): DivIcon {
  const cached = poiIconCache.get(category);
  if (cached) return cached;
  const color = POI_CATEGORY_COLORS[category] ?? "#64748b";
  const letter = POI_CATEGORY_LETTERS[category] ?? "";
  const created = L.divIcon({
    className: "walkability-poi-marker",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:9999px;background:${color};border:2px solid #ffffff;box-shadow:0 1px 3px rgba(15,23,42,0.4);font-size:11px;font-weight:600;color:#ffffff;">${letter}</span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  poiIconCache.set(category, created);
  return created;
}

type Props = {
  lat: number;
  lng: number;
  label?: string;
  poiOverview?: PoiOverview;
};

const UnitDetailMap: FC<Props> = ({ lat, lng, label, poiOverview }) => {
  const center: LatLngExpression = [lat, lng];
  const markerIcon = useDotMarkerIcon();

  const categoriesWithPoints = poiOverview
    ? Object.entries(poiOverview.categories).filter(
        ([, items]) => items && items.some((i) => i.lat != null && i.lon != null)
      )
    : [];

  return (
    <div className="w-full">
      <div className="h-64 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 md:h-72">
        <MapContainer
          center={center}
          zoom={15}
          className="h-full w-full"
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {markerIcon && (
            <Marker position={center} icon={markerIcon}>
              {label ? <Popup>{label}</Popup> : null}
              {label ? (
                <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                  <span className="text-xs font-medium text-slate-900">{label}</span>
                </Tooltip>
              ) : null}
            </Marker>
          )}

          {categoriesWithPoints.map(([category, items]) =>
            (items ?? [])
              .filter((i): i is PoiOverviewItem & { lat: number; lon: number } => i.lat != null && i.lon != null)
              .slice(0, 2)
              .map((item, idx) => {
                const icon = getPoiIcon(category);
                const distanceText =
                  item.distance_m != null
                    ? item.distance_m >= 1000
                      ? `${(item.distance_m / 1000).toFixed(1)} km`
                      : `${Math.round(item.distance_m)} m`
                    : "—";
                const labelText = POI_CATEGORY_LABELS[category] ?? category;
                return (
                  <Marker
                    key={`${category}-${idx}-${item.lat}-${item.lon}`}
                    position={[item.lat, item.lon]}
                    icon={icon}
                  >
                    <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                      <div className="space-y-0.5 text-xs">
                        <div className="font-semibold text-slate-900">{labelText}</div>
                        <div className="text-slate-800">{item.name ?? "—"}</div>
                        <div className="text-slate-600">{distanceText}</div>
                      </div>
                    </Tooltip>
                    <Popup>
                      <div className="space-y-0.5 text-xs">
                        <div className="font-semibold text-slate-900">{labelText}</div>
                        <div className="text-slate-800">{item.name ?? "—"}</div>
                        <div className="text-slate-600">{distanceText}</div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })
          )}
        </MapContainer>
      </div>
      {categoriesWithPoints.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-700">
          {categoriesWithPoints
            .filter(([category]) =>
              [
                "supermarkets",
                "pharmacies",
                "parks",
                "restaurants",
                "tram_stops",
                "bus_stops",
                "metro_stations",
              ].includes(category)
            )
            .map(([category]) => (
              <div key={category} className="flex items-center gap-1.5">
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white shadow-sm"
                  style={{ backgroundColor: POI_CATEGORY_COLORS[category] ?? "#64748b" }}
                >
                  <span className="text-[9px] font-semibold text-white">
                    {POI_CATEGORY_LETTERS[category] ?? ""}
                  </span>
                </span>
                <span>{POI_CATEGORY_LABELS[category] ?? category}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default UnitDetailMap;
