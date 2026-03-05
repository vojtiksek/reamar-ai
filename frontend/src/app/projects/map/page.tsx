"use client";

import { API_BASE } from "@/lib/api";
import { decodePolygon, encodePolygon, getPolygonBounds, isPointInPolygon, type LatLng } from "@/lib/geo";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { LatLngExpression } from "leaflet";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ProjectMapItem = {
  id: number;
  project: string | null;
  municipality?: string | null;
  city?: string | null;
  district?: string | null;
  avg_price_per_m2_czk?: number | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
   units_available?: number | null;
   units_reserved?: number | null;
};

type ProjectsResponse = {
  items: ProjectMapItem[];
  total: number;
};

const ProjectsLeafletMap = dynamic(() => import("./ProjectsLeafletMap"), {
  ssr: false,
});

export default function ProjectsMapPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<ProjectMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [polygon, setPolygon] = useState<LatLng[]>(() =>
    decodePolygon(searchParams?.get("poly") ?? undefined)
  );
  const [drawing, setDrawing] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<LatLng[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      setError(null);
      try {
        const limit = 500;
        let offset = 0;
        let all: ProjectMapItem[] = [];
        let total = Infinity;
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        params.set("limit", String(limit));
        params.set("sort_by", "avg_price_per_m2_czk");
        params.set("sort_dir", "asc");
        if (polygon.length >= 3) {
          const bounds = getPolygonBounds(polygon);
          if (bounds) {
            params.set("min_latitude", String(bounds.minLat));
            params.set("max_latitude", String(bounds.maxLat));
            params.set("min_longitude", String(bounds.minLng));
            params.set("max_longitude", String(bounds.maxLng));
          }
        }
        while (!cancelled && offset < total) {
          params.set("offset", String(offset));
          const res = await fetch(`${API_BASE}/projects?${params.toString()}`);
          if (!res.ok) {
            throw new Error(res.statusText || `HTTP ${res.status}`);
          }
          const data: ProjectsResponse = await res.json();
          const items = data.items ?? [];
          all = all.concat(items);
          total = data.total ?? items.length;
          if (items.length < limit) break;
          offset += limit;
        }
        if (cancelled) return;
        const withGps = all.filter(
          (p) => p.gps_latitude != null && p.gps_longitude != null
        );
        setProjects(withGps);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Chyba načítání projektů");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [searchParams?.toString(), polygon]);

  const visibleProjects = useMemo(() => {
    let base = projects;
    if (onlyAvailable) {
      base = base.filter((p) => {
        const available = p.units_available ?? 0;
        const reserved = p.units_reserved ?? 0;
        return available + reserved > 0;
      });
    }
    const activePoly = polygon;
    if (activePoly.length >= 3) {
      base = base.filter((p) => {
        if (p.gps_latitude == null || p.gps_longitude == null) return false;
        return isPointInPolygon(p.gps_latitude, p.gps_longitude, activePoly);
      });
    }
    return base;
  }, [projects, onlyAvailable, polygon]);

  const center: LatLngExpression = useMemo(() => {
    const source = visibleProjects.length > 0 ? visibleProjects : projects;
    if (source.length === 0) {
      // Základní centrum na Prahu
      return [50.0755, 14.4378];
    }
    const latSum = source.reduce((s, p) => s + (p.gps_latitude ?? 0), 0);
    const lonSum = source.reduce((s, p) => s + (p.gps_longitude ?? 0), 0);
    return [latSum / source.length, lonSum / source.length] as LatLngExpression;
  }, [projects, visibleProjects]);

  const syncPolygonToUrl = (poly: LatLng[] | null) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (poly && poly.length >= 3) {
      params.set("poly", encodePolygon(poly));
    } else {
      params.delete("poly");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (!drawing) return;
    setDraftPolygon((prev) => [...prev, { lat, lng }]);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Reamar</h1>
          <div className="flex items-center rounded-full border border-slate-200 bg-slate-100/70 p-0.5">
            <Link
              href={(() => {
                const qs = searchParams?.toString() ?? "";
                return qs ? `/units?${qs}` : "/units";
              })()}
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white hover:text-slate-900"
            >
              Jednotky
            </Link>
            <Link
              href={(() => {
                const qs = searchParams?.toString() ?? "";
                return qs ? `/projects?${qs}` : "/projects";
              })()}
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white hover:text-slate-900"
            >
              Projekty
            </Link>
            <Link
              href={(() => {
                const qs = searchParams?.toString() ?? "";
                return qs ? `/projects/map?${qs}` : "/projects/map";
              })()}
              className="rounded-full bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm"
            >
              Mapa
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!drawing) {
                  setDraftPolygon([]);
                  setDrawing(true);
                } else {
                  setDrawing(false);
                  setDraftPolygon([]);
                }
              }}
              className={
                "rounded-full border border-slate-200 px-3 py-1.5 font-medium transition " +
                (drawing
                  ? "border-sky-600 bg-sky-600 text-white hover:bg-sky-700"
                  : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50")
              }
            >
              Výběr oblasti
            </button>
            {polygon.length >= 3 && !drawing && (
              <button
                type="button"
                onClick={() => {
                  setPolygon([]);
                  setDraftPolygon([]);
                  syncPolygonToUrl(null);
                }}
                className="text-xs text-slate-600 underline decoration-dotted underline-offset-2 hover:text-slate-900"
              >
                Zrušit oblast
              </button>
            )}
            {drawing && draftPolygon.length >= 3 && (
              <button
                type="button"
                onClick={() => {
                  setPolygon(draftPolygon);
                  setDrawing(false);
                  syncPolygonToUrl(draftPolygon);
                }}
                className="rounded-full border border-emerald-500 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Uložit oblast
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOnlyAvailable((v) => !v)}
            className={
              "rounded-full border px-3 py-1.5 font-medium transition " +
              (onlyAvailable
                ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
                : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50")
            }
          >
            Jen dostupné
          </button>
          <span className="text-slate-600">
            Zobrazeno projektů s GPS: <span className="font-semibold text-slate-900">{visibleProjects.length}</span>
          </span>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <main className="flex flex-1 overflow-hidden">
        <aside className="hidden w-80 flex-shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
          <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-sm font-semibold text-slate-900">
            Projekty
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2 text-xs sm:text-sm">
            {loading && <div className="text-slate-600">Načítání…</div>}
            {!loading && visibleProjects.length === 0 && (
              <div className="text-slate-600">Žádné projekty s GPS nejsou k dispozici.</div>
            )}
            <ul className="space-y-2">
              {visibleProjects.map((p) => (
                <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-900">
                    {p.project ?? "Projekt bez názvu"}
                  </div>
                  <div className="text-xs text-slate-600">
                    {[p.city, p.municipality, p.district].filter(Boolean).join(", ") || "—"}
                  </div>
                  {p.avg_price_per_m2_czk != null && (
                    <div className="mt-1 text-xs text-slate-700">
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
                    className="mt-1 inline-block text-xs font-medium text-slate-700 underline decoration-slate-400 underline-offset-2 hover:text-slate-900 hover:decoration-slate-600"
                  >
                    Detail projektu
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <section className="relative flex-1 bg-slate-50/50">
          {loading && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm text-slate-700">
              Načítání mapy…
            </div>
          )}
          <ProjectsLeafletMap
            projects={visibleProjects}
            center={center}
            polygon={polygon}
            draftPolygon={draftPolygon}
            drawing={drawing}
            onMapClick={handleMapClick}
          />
        </section>
      </main>
    </div>
  );
}

