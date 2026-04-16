"use client";

import { useMemo, useRef, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L, { type LatLngExpression, type LatLngBoundsExpression, type DivIcon } from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icons for bundlers.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - accessing internal default icon options
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export type FutureProjectPin = {
  id: number;
  name: string;
  slug: string;
  lat: number;
  lng: number;
  developer: string | null;
  stage: string | null;
  total_units: number | null;
  date_sale_start: string | null;
  construction_completion: string | null;
};

function stageColor(stage: string | null): string {
  if (stage === "Výstavba") return "#2563eb";
  if (stage === "Dokončeno") return "#059669";
  return "#3b82f6";
}

const iconCache = new Map<string, DivIcon>();

function makeIcon(stage: string | null): DivIcon {
  const key = stage ?? "_";
  const cached = iconCache.get(key);
  if (cached) return cached;
  const color = stageColor(stage);
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  iconCache.set(key, icon);
  return icon;
}

function FitBounds({ pins }: { pins: FutureProjectPin[] }) {
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

export default function FutureProjectsMap({
  pins,
  linkPrefix,
}: {
  pins: FutureProjectPin[];
  /** URL prefix for project links. Set to null for portal (no links). */
  linkPrefix: string | null;
}) {
  if (pins.length === 0) return null;

  const defaultCenter: LatLngExpression = [50.0755, 14.4378];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200" style={{ height: 420 }}>
      <MapContainer center={defaultCenter} zoom={11} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <FitBounds pins={pins} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((pin) => {
          const position: LatLngExpression = [pin.lat, pin.lng];
          return (
            <Marker key={pin.id} position={position} icon={makeIcon(pin.stage)}>
              <Popup>
                <div className="min-w-[180px] space-y-1 text-sm">
                  {linkPrefix ? (
                    <a href={`${linkPrefix}/${pin.slug}`} className="font-semibold text-blue-700 hover:underline">
                      {pin.name}
                    </a>
                  ) : (
                    <p className="font-semibold text-slate-900">{pin.name}</p>
                  )}
                  {pin.developer && <p className="text-xs text-slate-500">{pin.developer}</p>}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                    {pin.total_units != null && <span>{pin.total_units} jednotek</span>}
                    {pin.date_sale_start && <span>Prodej: {pin.date_sale_start}</span>}
                    {pin.construction_completion && <span>Dokončení: {pin.construction_completion}</span>}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
