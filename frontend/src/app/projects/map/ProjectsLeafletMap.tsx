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

const projectMarkerIcon = L.divIcon({
  className: "",
  html:
    '<div style="width:14px;height:14px;border-radius:9999px;background:#2563eb;border:2px solid #ffffff;box-shadow:0 0 0 1px rgba(15,23,42,0.4);"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function ClickCapture(props: { drawing: boolean; onClick?: (lat: number, lng: number) => void }) {
  useMapEvent("click", (e) => {
    if (!props.drawing || !props.onClick) return;
    props.onClick(e.latlng.lat, e.latlng.lng);
  });
  return null;
}

function ProjectsLeafletMap({ projects, center, polygon, draftPolygon, drawing, onMapClick }: Props) {
  const activePolygon = draftPolygon.length >= 2 ? draftPolygon : polygon;

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
      {projects.map((p) =>
        p.gps_latitude != null && p.gps_longitude != null ? (
          <Marker
            key={p.id}
            position={[p.gps_latitude as number, p.gps_longitude as number]}
            icon={projectMarkerIcon}
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
        ) : null
      )}
    </MapContainer>
  );
}

export default ProjectsLeafletMap;

