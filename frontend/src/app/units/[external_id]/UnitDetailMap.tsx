"use client";

import type { FC } from "react";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression } from "leaflet";
import type { DivIcon } from "leaflet";
import "leaflet/dist/leaflet.css";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });

/** Vlastní ikona: tečka (kolečko) místo výchozího markeru, aby se nezobrazovaly otazníky. */
function useDotMarkerIcon(): DivIcon | null {
  const [icon, setIcon] = useState<DivIcon | null>(null);
  useEffect(() => {
    void import("leaflet").then((L) => {
      setIcon(
        L.divIcon({
          className: "unit-detail-marker-dot",
          html: '<span style="display:block;width:14px;height:14px;background:#0ea5e9;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></span>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        })
      );
    });
  }, []);
  return icon;
}

type Props = {
  lat: number;
  lng: number;
  label?: string;
};

const UnitDetailMap: FC<Props> = ({ lat, lng, label }) => {
  const center: LatLngExpression = [lat, lng];
  const markerIcon = useDotMarkerIcon();

  return (
    <div className="h-64 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
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
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};

export default UnitDetailMap;
