"use client";

/**
 * Minimal fixed-size map used inside hero cards.
 * Unlike UnitDetailMap/ProjectDetailMap which have their own fixed height,
 * HeroMap fills 100% of its parent container (via position:absolute inset:0).
 * The parent must have defined dimensions (width + height) for Leaflet to render.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { DivIcon, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false }
);

function useDotMarkerIcon(): DivIcon | null {
  const [icon, setIcon] = useState<DivIcon | null>(null);
  useEffect(() => {
    void import("leaflet").then((L) => {
      setIcon(
        L.divIcon({
          className: "hero-map-marker-dot",
          html:
            '<span style="display:block;width:14px;height:14px;background:#0f172a;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></span>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        })
      );
    });
  }, []);
  return icon;
}

type Props = {
  lat: number;
  lng: number;
  zoom?: number;
  /** Show Leaflet zoom (+/-) control. Default false (hero) — pass true in modal. */
  zoomControl?: boolean;
  /** Show attribution. Default false. */
  attributionControl?: boolean;
};

export function HeroMap({
  lat,
  lng,
  zoom = 15,
  zoomControl = false,
  attributionControl = false,
}: Props) {
  const center: LatLngExpression = [lat, lng];
  const markerIcon = useDotMarkerIcon();

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={center}
        zoom={zoom}
        className="h-full w-full"
        scrollWheelZoom={true}
        zoomControl={zoomControl}
        dragging={true}
        doubleClickZoom={true}
        attributionControl={attributionControl}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {markerIcon && <Marker position={center} icon={markerIcon} />}
      </MapContainer>
    </div>
  );
}
