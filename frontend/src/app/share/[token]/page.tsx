"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { formatCurrencyCzk, formatAreaM2, formatLayout, formatMinutes } from "@/lib/format";
import { API_BASE } from "@/lib/api";

const ShareMap = dynamic(
  () => import("@/app/units/[external_id]/UnitDetailMap"),
  { ssr: false }
);

// ── Types ────────────────────────────────────────────────────────────────────

type ShareUnit = {
  project_name: string;
  developer: string | null;
  layout: string | null;
  floor_area_m2: number | null;
  exterior_area_m2: number | null;
  floor: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  original_price_czk: number | null;
  availability_status: string | null;
  ride_to_center_min: number | null;
  public_transport_to_center_min: number | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  url: string | null;
};

type SharePayload = {
  client_name: string;
  units: ShareUnit[];
  expires_at: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "ok"; payload: SharePayload }
  | { status: "expired" }
  | { status: "invalid" }
  | { status: "error"; message: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

function availInfo(status: string | null | undefined): { label: string; cls: string } {
  const s = String(status ?? "").toLowerCase();
  if (s === "available") return { label: "Volná", cls: "bg-emerald-100 text-emerald-800" };
  if (s === "reserved") return { label: "Rezervovaná", cls: "bg-amber-100 text-amber-800" };
  if (s === "sold") return { label: "Prodaná", cls: "bg-red-100 text-red-700" };
  return { label: status ?? "—", cls: "bg-slate-100 text-slate-600" };
}

// ── Error states ─────────────────────────────────────────────────────────────

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <p className="text-4xl">🔗</p>
        <h1 className="mt-4 text-xl font-semibold text-slate-800">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{body}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SharePage() {
  const params = useParams();
  const token = typeof params?.token === "string" ? params.token : null;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (!token) { setState({ status: "invalid" }); return; }
    fetch(`${API_BASE}/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 404) { setState({ status: "invalid" }); return; }
        if (res.status === 410) { setState({ status: "expired" }); return; }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          setState({ status: "error", message: text || `HTTP ${res.status}` });
          return;
        }
        const data: SharePayload = await res.json();
        setState({ status: "ok", payload: data });
      })
      .catch((err) => setState({ status: "error", message: String(err) }));
  }, [token]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-slate-400 text-sm">
        Načítám výběr…
      </div>
    );
  }
  if (state.status === "invalid") {
    return (
      <ErrorScreen
        title="Odkaz neexistuje"
        body="Tento odkaz je neplatný nebo byl odvolán. Požádejte svého poradce o nový odkaz."
      />
    );
  }
  if (state.status === "expired") {
    return (
      <ErrorScreen
        title="Platnost odkazu vypršela"
        body="Tento sdílený výběr již není dostupný. Požádejte svého poradce o aktuální výběr."
      />
    );
  }
  if (state.status === "error") {
    return (
      <ErrorScreen
        title="Něco se pokazilo"
        body="Nepodařilo se načíst výběr. Zkuste to prosím znovu nebo kontaktujte svého poradce."
      />
    );
  }

  const { payload } = state;
  const units = payload.units;
  const unit = units[selectedIdx] ?? null;
  const hasGps = unit?.gps_latitude != null && unit?.gps_longitude != null;

  const unitCountLabel =
    units.length === 1
      ? "1 jednotka"
      : units.length < 5
      ? `${units.length} jednotky`
      : `${units.length} jednotek`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">

      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-slate-900">Váš výběr nemovitostí</span>
        </div>
        <span className="text-xs text-slate-400">{unitCountLabel} ve výběru</span>
      </header>

      {units.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
          Výběr je prázdný.
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">

          {/* ── Left: shortlist ── */}
          <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Výběr</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {units.map((u, i) => {
                const isSelected = i === selectedIdx;
                const avail = availInfo(u.availability_status);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => setSelectedIdx(i)}
                      className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-violet-500 bg-violet-50"
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <p className={`truncate text-sm font-semibold ${isSelected ? "text-violet-900" : "text-slate-800"}`}>
                        {u.project_name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {formatLayout(u.layout)}
                        {u.floor_area_m2 != null ? ` · ${u.floor_area_m2.toFixed(0)} m²` : ""}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <p className="text-xs font-medium text-slate-700">
                          {formatCurrencyCzk(u.price_czk)}
                        </p>
                        {u.availability_status && u.availability_status !== "available" && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${avail.cls}`}>
                            {avail.label}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* ── Right: detail panel ── */}
          <main className="flex-1 overflow-y-auto">
            {unit === null ? (
              <div className="flex h-full items-center justify-center text-slate-400">
                Vyberte jednotku ze seznamu
              </div>
            ) : (
              <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">

                {/* Identity */}
                <div>
                  {unit.developer && (
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                      {unit.developer}
                    </p>
                  )}
                  <h1 className="mt-1 text-2xl font-bold text-slate-900">{unit.project_name}</h1>
                  {unit.availability_status && (
                    <div className="mt-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${availInfo(unit.availability_status).cls}`}>
                        {availInfo(unit.availability_status).label}
                      </span>
                    </div>
                  )}
                </div>

                {/* Reserved / sold warning */}
                {(unit.availability_status === "reserved" || unit.availability_status === "sold") && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-800">
                      {unit.availability_status === "reserved"
                        ? "Tato jednotka je rezervovaná"
                        : "Tato jednotka je prodaná"}
                    </p>
                    <p className="mt-0.5 text-xs text-amber-700">
                      Pro aktuální informace kontaktujte svého poradce.
                    </p>
                  </div>
                )}

                {/* Key specs */}
                <div className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-medium text-slate-400">Dispozice</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatLayout(unit.layout)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-400">Plocha</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatAreaM2(unit.floor_area_m2)}</p>
                  </div>
                  {(unit.exterior_area_m2 ?? 0) > 0 && (
                    <div>
                      <p className="text-[11px] font-medium text-slate-400">Venkovní</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatAreaM2(unit.exterior_area_m2)}</p>
                    </div>
                  )}
                  {unit.floor != null && (
                    <div>
                      <p className="text-[11px] font-medium text-slate-400">Podlaží</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-900">{unit.floor}. patro</p>
                    </div>
                  )}
                </div>

                {/* Price */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-[11px] font-medium text-slate-400">Cena</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{formatCurrencyCzk(unit.price_czk)}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3">
                    {unit.price_per_m2_czk != null && (
                      <span className="text-sm text-slate-500">{formatCurrencyCzk(unit.price_per_m2_czk)} / m²</span>
                    )}
                    {unit.original_price_czk != null && unit.original_price_czk > (unit.price_czk ?? 0) && (
                      <span className="text-sm text-slate-400 line-through">{formatCurrencyCzk(unit.original_price_czk)}</span>
                    )}
                  </div>
                </div>

                {/* Map */}
                {hasGps && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Poloha</p>
                    <ShareMap
                      lat={unit.gps_latitude!}
                      lng={unit.gps_longitude!}
                      label={unit.project_name}
                    />
                  </div>
                )}

                {/* Transport */}
                {(unit.ride_to_center_min != null || unit.public_transport_to_center_min != null) && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Dostupnost</p>
                    <div className="flex flex-wrap gap-6">
                      {unit.ride_to_center_min != null && (
                        <div>
                          <p className="text-[11px] text-slate-400">Autem do centra</p>
                          <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatMinutes(unit.ride_to_center_min)}</p>
                        </div>
                      )}
                      {unit.public_transport_to_center_min != null && (
                        <div>
                          <p className="text-[11px] text-slate-400">MHD do centra</p>
                          <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatMinutes(unit.public_transport_to_center_min)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Developer link */}
                {unit.url && (
                  <div className="pb-2">
                    <a
                      href={unit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                    >
                      ↗ Otevřít nabídku
                    </a>
                  </div>
                )}

              </div>
            )}
          </main>

        </div>
      )}
    </div>
  );
}
