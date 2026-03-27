"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { LatLngExpression } from "leaflet";
import type { DivIcon } from "leaflet";
import "leaflet/dist/leaflet.css";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });

export type PoiItem = { name: string | null; distance_m: number | null; lat: number | null; lon: number | null };

type Props = {
  projectLat: number;
  projectLon: number;
  items: PoiItem[];
  highlightIndices?: [number?, number?];
};

function useLeafletIcons() {
  const [icons, setIcons] = useState<{
    project: DivIcon | null;
    poi: DivIcon | null;
    poi1: DivIcon | null;
    poi2: DivIcon | null;
  }>({ project: null, poi: null, poi1: null, poi2: null });
  useEffect(() => {
    void import("leaflet").then((L) => {
      setIcons({
        project: L.divIcon({
          className: "walkability-project-marker",
          html: '<span style="display:block;width:14px;height:14px;background:#0f172a;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></span>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        poi: L.divIcon({
          className: "walkability-poi-marker",
          html: '<span style="display:block;width:12px;height:12px;background:#64748b;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
        poi1: L.divIcon({
          className: "walkability-poi-marker-1",
          html: '<span style="display:block;width:18px;height:18px;background:#22c55e;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 2px #16a34a;font-size:10px;line-height:14px;text-align:center;color:#fff;font-weight:bold;">1</span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        poi2: L.divIcon({
          className: "walkability-poi-marker-2",
          html: '<span style="display:block;width:18px;height:18px;background:#3b82f6;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 2px #2563eb;font-size:10px;line-height:14px;text-align:center;color:#fff;font-weight:bold;">2</span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      });
    });
  }, []);
  return icons;
}

export default function WalkabilityPoiModalMap({ projectLat, projectLon, items, highlightIndices = [0, 1] }: Props) {
  const points = items.filter((i) => i.lat != null && i.lon != null) as (PoiItem & { lat: number; lon: number })[];
  const center: LatLngExpression = [projectLat, projectLon];
  const [h0, h1] = highlightIndices;
  const { project, poi, poi1, poi2 } = useLeafletIcons();

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 md:h-[460px] lg:h-[500px]">
      <MapContainer center={center} zoom={14} className="h-full w-full" scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {project && (
          <Marker position={center} icon={project}>
            <Popup>Projekt</Popup>
          </Marker>
        )}
        {points.map((item, idx) => {
          const icon = idx === h0 ? poi1 : idx === h1 ? poi2 : poi;
          if (!icon) return null;
          return (
            <Marker key={idx} position={[item.lat, item.lon]} icon={icon}>
              <Popup>
                <span className="font-medium">{item.name ?? "—"}</span>
                {item.distance_m != null && (
                  <span className="ml-1 text-slate-600">
                    {item.distance_m >= 1000 ? `${(item.distance_m / 1000).toFixed(1)} km` : `${Math.round(item.distance_m)} m`}
                  </span>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
