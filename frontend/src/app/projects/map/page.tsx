"use client";

import { API_BASE } from "@/lib/api";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

type ProjectMapItem = {
  id: number;
  project: string | null;
  municipality?: string | null;
  city?: string | null;
  district?: string | null;
  avg_price_per_m2_czk?: number | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
};

type ProjectsResponse = {
  items: ProjectMapItem[];
  total: number;
};

export default function ProjectsMapPage() {
  const [projects, setProjects] = useState<ProjectMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Backend aktuálně podporuje limity 100 / 300 / 500, proto použijeme 500.
    fetch(`${API_BASE}/projects?limit=500`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: ProjectsResponse) => {
        if (cancelled) return;
        const withGps = (data.items ?? []).filter(
          (p) => p.gps_latitude != null && p.gps_longitude != null
        );
        setProjects(withGps);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Chyba načítání projektů");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const center: LatLngExpression = useMemo(() => {
    if (projects.length === 0) {
      // Základní centrum na Prahu
      return [50.0755, 14.4378];
    }
    const latSum = projects.reduce((s, p) => s + (p.gps_latitude ?? 0), 0);
    const lonSum = projects.reduce((s, p) => s + (p.gps_longitude ?? 0), 0);
    return [latSum / projects.length, lonSum / projects.length] as LatLngExpression;
  }, [projects]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">Reamar – mapa projektů</h1>
          <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50/50 p-0.5">
            <Link
              href="/units"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white hover:text-gray-900"
            >
              Jednotky
            </Link>
            <Link
              href="/projects"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white hover:text-gray-900"
            >
              Projekty – tabulka
            </Link>
            <Link
              href="/projects/map"
              className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-900"
            >
              Mapa
            </Link>
          </div>
        </div>
        <div className="text-xs text-gray-600">
          Zobrazeno projektů s GPS: <span className="font-semibold">{projects.length}</span>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <main className="flex flex-1 overflow-hidden">
        <aside className="hidden w-80 flex-shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
          <div className="border-b border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900">
            Projekty
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2 text-xs sm:text-sm">
            {loading && <div className="text-gray-600">Načítání…</div>}
            {!loading && projects.length === 0 && (
              <div className="text-gray-600">Žádné projekty s GPS nejsou k dispozici.</div>
            )}
            <ul className="space-y-2">
              {projects.map((p) => (
                <li key={p.id} className="rounded-lg border border-gray-200 p-2">
                  <div className="text-sm font-semibold text-gray-900">
                    {p.project ?? "Projekt bez názvu"}
                  </div>
                  <div className="text-xs text-gray-600">
                    {[p.city, p.municipality, p.district].filter(Boolean).join(", ") || "—"}
                  </div>
                  {p.avg_price_per_m2_czk != null && (
                    <div className="mt-1 text-xs text-gray-700">
                      Průměrná cena m²:{" "}
                      <span className="font-medium">
                        {new Intl.NumberFormat("cs-CZ", {
                          maximumFractionDigits: 0,
                          minimumFractionDigits: 0,
                        }).format(p.avg_price_per_m2_czk)}{" "}
                        Kč/m²
                      </span>
                    </div>
                  )}
                  <Link
                    href={`/projects/${p.id}`}
                    className="mt-1 inline-block text-xs font-medium text-blue-600 hover:underline"
                  >
                    Detail projektu
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <section className="relative flex-1">
          {loading && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/60 text-sm text-gray-700">
              Načítání mapy…
            </div>
          )}
          <MapContainer
            center={center}
            zoom={12}
            className="h-full w-full"
            scrollWheelZoom
          >
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
        </section>
      </main>
    </div>
  );
}

