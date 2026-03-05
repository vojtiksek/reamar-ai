"use client";

import type { FC } from "react";
import { MapContainer, TileLayer, Circle, Marker, Popup } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type ComparableForMap = {
  external_id: string;
  project_name: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  distance_m: number;
  price_per_m2_czk: number | null;
};

type Props = {
  center: { lat: number; lng: number } | null;
  comparables: ComparableForMap[];
};

const LocalDiffDebugMap: FC<Props> = ({ center, comparables }) => {
  const hasCenter = center != null;

  const mapCenter: LatLngExpression = hasCenter
    ? [center.lat, center.lng]
    : ([50.0755, 14.4378] as LatLngExpression); // Praha fallback

  const circles =
    hasCenter &&
    [500, 1000, 2000].map((r) => (
      <Circle
        key={r}
        center={mapCenter}
        radius={r}
        pathOptions={{
          color: r === 500 ? "#0ea5e9" : r === 1000 ? "#22c55e" : "#f97316",
          weight: 1.2,
          fillOpacity: 0.03,
        }}
      />
    ));

  const markers = comparables
    .filter((c) => c.gps_latitude != null && c.gps_longitude != null)
    .map((c) => {
      const pos: LatLngExpression = [c.gps_latitude as number, c.gps_longitude as number];
      let color = "#0ea5e9";
      if (c.distance_m > 1000 && c.distance_m <= 2000) color = "#f97316";
      else if (c.distance_m > 500) color = "#22c55e";

      const iconHtml = `<span style="display:inline-block;width:12px;height:12px;border-radius:999px;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.35);"></span>`;
      const icon = L.divIcon({
        className: "",
        html: iconHtml,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      return (
        <Marker key={c.external_id} position={pos} icon={icon}>
          <Popup>
            <div className="text-xs">
              <div className="font-mono text-gray-900">{c.external_id}</div>
              <div className="text-gray-700">{c.project_name ?? "—"}</div>
              <div className="text-gray-600">
                {Math.round(c.distance_m).toLocaleString("cs-CZ")} m
              </div>
              {c.price_per_m2_czk != null && (
                <div className="text-gray-800">
                  {Math.round(c.price_per_m2_czk).toLocaleString("cs-CZ")} Kč/m²
                </div>
              )}
            </div>
          </Popup>
        </Marker>
      );
    });

  // Ikona pro posuzovanou jednotku – černá tečka
  const centerIcon = L.divIcon({
    className: "",
    html:
      '<span style="display:inline-block;width:14px;height:14px;border-radius:999px;background:#111827;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.45);"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  return (
    <div className="h-80 w-full border-b border-gray-200 overflow-hidden">
      <MapContainer
        center={mapCenter}
        zoom={14}
        scrollWheelZoom={true}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {circles}
        {hasCenter && (
          <Marker position={mapCenter} icon={centerIcon}>
            <Popup>
              <div className="text-xs font-medium text-gray-900">
                Posuzovaná jednotka ({center!.lat.toFixed(5)}, {center!.lng.toFixed(5)})
              </div>
            </Popup>
          </Marker>
        )}
        {markers}
      </MapContainer>
    </div>
  );
};

export default LocalDiffDebugMap;

