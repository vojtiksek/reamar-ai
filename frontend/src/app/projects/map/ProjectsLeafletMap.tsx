"use client";

import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";

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
};

function ProjectsLeafletMap({ projects, center }: Props) {
  return (
    <MapContainer center={center} zoom={12} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {projects.map((p) =>
        p.gps_latitude != null && p.gps_longitude != null ? (
          <Marker
            key={p.id}
            position={[p.gps_latitude as number, p.gps_longitude as number]}
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

