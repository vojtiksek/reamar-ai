"use client";

import { MapContainer, Marker, Polygon, Popup, TileLayer, useMapEvent } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/geo";

type ProjectPoint = {
  id: number;
  project: string | null;
  municipality?: string | null;
  city?: string | null;
  district?: string | null;
  avg_price_per_m2_czk?: number | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
};

type Props = {
  projects: ProjectPoint[];
  center: LatLngExpression;
  polygon: LatLng[];
  draftPolygon: LatLng[];
  drawing: boolean;
  onMapClick?: (lat: number, lng: number) => void;
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

function ProjectsLeafletMap({ projects, center, polygon, draftPolygon, drawing, onMapClick }: Props) {
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
    <MapContainer center={center} zoom={11} className="h-full w-full" scrollWheelZoom>
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
      {projects
        .filter((p) => p.gps_latitude != null && p.gps_longitude != null)
        .map((p) => (
          <Marker
            key={p.id}
            position={[p.gps_latitude as number, p.gps_longitude as number]}
            icon={getProjectMarkerIcon(priceToColor(p.avg_price_per_m2_czk ?? null))}
          >
            <Popup>
              <div className="space-y-1 text-xs">
                <div className="font-semibold text-gray-900">
                  {p.project ?? "Projekt bez názvu"}
                </div>
                <div className="text-gray-700">
                  {[p.city, p.municipality, p.district].filter(Boolean).join(", ") || "—"}
                </div>
                {p.avg_price_per_m2_czk != null && (
                  <div className="text-gray-800">
                    Průměrná cena m²:{" "}
                    {new Intl.NumberFormat("cs-CZ", {
                      maximumFractionDigits: 0,
                      minimumFractionDigits: 0,
                    }).format(p.avg_price_per_m2_czk)}{" "}
                    Kč/m²
                  </div>
                )}
                <Link
                  href={`/projects/${p.id}`}
                  className="inline-block text-blue-600 hover:underline"
                >
                  Detail projektu
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
}

export default ProjectsLeafletMap;

