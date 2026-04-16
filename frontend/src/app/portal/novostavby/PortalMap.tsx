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

type Feedback = {
  feedback_type: string;
  dislike_reason: string | null;
  note: string | null;
  updated_at: string;
};

type Rec = {
  rec_id: number;
  project_id: number | null;
  project_name: string | null;
  unit_external_id: string | null;
  layout_label: string | null;
  floor_area_m2: number | null;
  price_czk: number | null;
  score: number | null;
  project_lat: number | null;
  project_lng: number | null;
  feedback: Feedback | null;
  pinned_by_broker: boolean;
  shortlist_reason: string | null;
};

type MatchInfo = {
  matched: number;
  total: number;
  matchedKeys: string[];
  missingKeys: string[];
};

type ProjectPin = {
  project_id: number;
  project_name: string;
  lat: number;
  lng: number;
  maxScore: number;
  units: Rec[];
};

function makeScoreIcon(score: number, unitCount: number): DivIcon {
  const color =
    score >= 80 ? "#059669" :
    score >= 60 ? "#2563eb" :
    score >= 40 ? "#d97706" : "#94a3b8";
  const size = unitCount > 1 ? 22 : 16;
  const anchor = size / 2;
  const label = unitCount > 1 ? `${unitCount}` : "";
  const html =
    unitCount > 1
      ? `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;">${label}</div>`
      : `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`;
  return L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [anchor, anchor] });
}

function formatPrice(czk: number): string {
  if (czk >= 1_000_000) return `${(czk / 1_000_000).toFixed(1)} M Kč`;
  return `${czk.toLocaleString("cs-CZ")} Kč`;
}

function buildProjectPins(recs: Rec[]): ProjectPin[] {
  const map = new Map<number, ProjectPin>();
  for (const r of recs) {
    if (r.project_lat == null || r.project_lng == null || r.project_id == null) continue;
    const score = r.score ?? 0;
    const existing = map.get(r.project_id);
    if (!existing) {
      map.set(r.project_id, {
        project_id: r.project_id,
        project_name: r.project_name ?? `Projekt ${r.project_id}`,
        lat: r.project_lat,
        lng: r.project_lng,
        maxScore: score,
        units: [r],
      });
    } else {
      existing.units.push(r);
      if (score > existing.maxScore) existing.maxScore = score;
    }
  }
  return Array.from(map.values());
}

function FitBounds({ pins }: { pins: ProjectPin[] }) {
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

function MapInner({
  pins,
  onFeedback,
  sendingFb,
  getMatch,
}: {
  pins: ProjectPin[];
  onFeedback: (recId: number, feedbackType: string) => void;
  sendingFb: number | null;
  getMatch?: (recId: number) => MatchInfo;
}) {
  return (
    <>
      <FitBounds pins={pins} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {pins.map((pin) => {
        const position: LatLngExpression = [pin.lat, pin.lng];
        const icon = makeScoreIcon(pin.maxScore, pin.units.length);
        return (
          <Marker key={pin.project_id} position={position} icon={icon}>
            <Popup>
              <div className="min-w-[180px] space-y-2 text-sm">
                <p className="font-semibold text-slate-900">{pin.project_name}</p>
                {/* Project-level feedback */}
                {pin.units.length > 0 && (() => {
                  const allLiked = pin.units.every((u) => u.feedback?.feedback_type === "liked");
                  const allDisliked = pin.units.every((u) => u.feedback?.feedback_type === "disliked");
                  const saving = pin.units.some((u) => sendingFb === u.rec_id);
                  return (
                    <div className="flex gap-1">
                      <button
                        onClick={() => { for (const u of pin.units) onFeedback(u.rec_id, "liked"); }}
                        disabled={saving}
                        className={`flex-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors ${allLiked ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                      >
                        ♥ Líbí se projekt
                      </button>
                      <button
                        onClick={() => { for (const u of pin.units) onFeedback(u.rec_id, "disliked"); }}
                        disabled={saving}
                        className={`flex-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors ${allDisliked ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-700 hover:bg-rose-100"}`}
                      >
                        ✕ Nechci projekt
                      </button>
                    </div>
                  );
                })()}
                {pin.units.map((u) => {
                  const match = getMatch ? getMatch(u.rec_id) : null;
                  const fb = u.feedback?.feedback_type;
                  return (
                    <div key={u.rec_id} className="space-y-1 border-t border-slate-100 pt-1.5 text-xs text-slate-600">
                      <p className="font-medium text-slate-800">
                        {u.layout_label ?? "—"}
                        {u.floor_area_m2 != null ? ` · ${u.floor_area_m2} m²` : ""}
                        {u.price_czk != null ? ` · ${formatPrice(u.price_czk)}` : ""}
                      </p>
                      {match && match.total > 0 && (
                        <p className="text-emerald-700">{match.matched}/{match.total} preferencí</p>
                      )}
                      {u.shortlist_reason && (
                        <p className="italic text-slate-500">„{u.shortlist_reason}"</p>
                      )}
                      <div className="flex gap-1 pt-0.5">
                        <button
                          onClick={() => onFeedback(u.rec_id, "liked")}
                          disabled={sendingFb === u.rec_id}
                          className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${fb === "liked" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-emerald-100 hover:text-emerald-700"}`}
                        >
                          ♥ Líbí
                        </button>
                        <button
                          onClick={() => onFeedback(u.rec_id, "disliked")}
                          disabled={sendingFb === u.rec_id}
                          className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${fb === "disliked" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-rose-100 hover:text-rose-700"}`}
                        >
                          ✕ Ne
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

export default function PortalMap({
  recs,
  onFeedback,
  sendingFb,
  getMatch,
}: {
  recs: Rec[];
  onFeedback: (recId: number, feedbackType: string) => void;
  sendingFb: number | null;
  getMatch?: (recId: number) => MatchInfo;
}) {
  const pins = useMemo(() => buildProjectPins(recs), [recs]);

  if (pins.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
        <p className="text-sm text-slate-500">
          {recs.length === 0
            ? "Žádná doporučení k zobrazení na mapě."
            : "Projekty v doporučeních nemají GPS souřadnice."}
        </p>
      </div>
    );
  }

  const defaultCenter: LatLngExpression = [50.0755, 14.4378];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200" style={{ height: 480 }}>
      <MapContainer
        center={defaultCenter}
        zoom={11}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <MapInner pins={pins} onFeedback={onFeedback} sendingFb={sendingFb} getMatch={getMatch} />
      </MapContainer>
    </div>
  );
}
