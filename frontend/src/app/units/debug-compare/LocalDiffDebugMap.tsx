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
  total_price_czk: number | null;
  floor_area_m2: number | null;
  exterior_area_m2: number | null;
  layout: string | null;
  floor: number | null;
};

type UnitInfo = {
  total_price_czk: number | null;
  layout: string | null;
  floor_area_m2: number | null;
  exterior_area_m2: number | null;
  floor: number | null;
  price_per_m2_czk: number | null;
};

type Props = {
  center: { lat: number; lng: number } | null;
  unitInfo: UnitInfo;
  unitExternalId: string;
  comparables: ComparableForMap[];
};

function formatLayout(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const m = /^layout_(\d+)(?:_(\d+))?$/i.exec(String(raw));
  if (m) {
    const whole = m[1];
    const frac = m[2];
    return frac ? `${whole},${frac} kk` : `${whole} kk`;
  }
  return String(raw);
}

const LocalDiffDebugMap: FC<Props> = ({ center, unitInfo, unitExternalId, comparables }) => {
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
            <div className="min-w-[180px] space-y-1 text-xs">
              <div className="font-mono font-medium text-gray-900">{c.external_id}</div>
              <div className="text-gray-700">{c.project_name ?? "—"}</div>
              {c.total_price_czk != null && (
                <div>
                  <span className="text-gray-500">Cena:</span>{" "}
                  {Math.round(c.total_price_czk).toLocaleString("cs-CZ")} Kč
                </div>
              )}
              {c.layout != null && c.layout !== "" && (
                <div>
                  <span className="text-gray-500">Dispozice:</span> {formatLayout(c.layout)}
                </div>
              )}
              {c.floor_area_m2 != null && (
                <div>
                  <span className="text-gray-500">Plocha:</span> {c.floor_area_m2.toFixed(1)} m²
                </div>
              )}
              {c.exterior_area_m2 != null && (
                <div>
                  <span className="text-gray-500">Plocha venku:</span> {c.exterior_area_m2.toFixed(1)} m²
                </div>
              )}
              {c.floor != null && (
                <div>
                  <span className="text-gray-500">Patro:</span> {c.floor}
                </div>
              )}
              {c.price_per_m2_czk != null && (
                <div className="text-gray-800">
                  {Math.round(c.price_per_m2_czk).toLocaleString("cs-CZ")} Kč/m²
                </div>
              )}
              <div className="text-gray-600">
                Vzdálenost: {Math.round(c.distance_m).toLocaleString("cs-CZ")} m
              </div>
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
              <div className="min-w-[180px] space-y-1 text-xs">
                <div className="font-semibold text-gray-900">Posuzovaná jednotka</div>
                <div className="font-mono text-gray-800">{unitExternalId}</div>
                {unitInfo.total_price_czk != null && (
                  <div>
                    <span className="text-gray-500">Cena:</span>{" "}
                    {Math.round(unitInfo.total_price_czk).toLocaleString("cs-CZ")} Kč
                  </div>
                )}
                {unitInfo.layout != null && unitInfo.layout !== "" && (
                  <div>
                    <span className="text-gray-500">Dispozice:</span> {formatLayout(unitInfo.layout)}
                  </div>
                )}
                {unitInfo.floor_area_m2 != null && (
                  <div>
                    <span className="text-gray-500">Plocha:</span> {unitInfo.floor_area_m2.toFixed(1)} m²
                  </div>
                )}
                {unitInfo.exterior_area_m2 != null && (
                  <div>
                    <span className="text-gray-500">Plocha venku:</span> {unitInfo.exterior_area_m2.toFixed(1)} m²
                  </div>
                )}
                {unitInfo.floor != null && (
                  <div>
                    <span className="text-gray-500">Patro:</span> {unitInfo.floor}
                  </div>
                )}
                {unitInfo.price_per_m2_czk != null && (
                  <div className="text-gray-800">
                    {Math.round(unitInfo.price_per_m2_czk).toLocaleString("cs-CZ")} Kč/m²
                  </div>
                )}
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

