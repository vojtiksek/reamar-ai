"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { API_BASE } from "@/lib/api";
import { ReamarCard } from "@/components/ui/reamar-ui";
import type { FutureProjectPin } from "./FutureProjectsMap";

const FutureProjectsMap = dynamic(() => import("./FutureProjectsMap"), { ssr: false });

type FutureProject = {
  id: number;
  name: string;
  slug: string;
  is_visible: boolean;
  sort_order: number;
  developer: string | null;
  address: string | null;
  stage: string | null;
  total_units: number | null;
  date_sale_start: string | null;
  construction_completion: string | null;
  project_type: string | null;
  url: string | null;
  renovation: boolean | null;
  city: string | null;
  municipal_district: string | null;
  region: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  public_data_json: Record<string, unknown> | null;
  internal_data_json: Record<string, unknown> | null;
  interest_count: number;
  created_at: string;
  updated_at: string;
};

type SortKey = "name" | "total_units" | "date_sale_start";
type ViewMode = "projects" | "developers";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Název" },
  { value: "total_units", label: "Počet jednotek" },
  { value: "date_sale_start", label: "Spuštění prodeje" },
];

function sortProjects(projects: FutureProject[], key: SortKey, dir: "asc" | "desc"): FutureProject[] {
  const sorted = [...projects].sort((a, b) => {
    if (key === "name") return (a.name ?? "").localeCompare(b.name ?? "", "cs");
    if (key === "total_units") return (a.total_units ?? 0) - (b.total_units ?? 0);
    if (key === "date_sale_start") return (a.date_sale_start ?? "").localeCompare(b.date_sale_start ?? "");
    return 0;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

type DevGroup = { developer: string; projects: FutureProject[]; totalUnits: number };

function groupByDeveloper(projects: FutureProject[]): DevGroup[] {
  const map = new Map<string, FutureProject[]>();
  for (const fp of projects) {
    const dev = fp.developer || "Neznámý developer";
    const list = map.get(dev) ?? [];
    list.push(fp);
    map.set(dev, list);
  }
  return Array.from(map.entries())
    .map(([developer, projects]) => ({
      developer,
      projects,
      totalUnits: projects.reduce((sum, fp) => sum + (fp.total_units ?? 0), 0),
    }))
    .sort((a, b) => b.totalUnits - a.totalUnits);
}

function ProjectCard({ fp }: { fp: FutureProject }) {
  const pub = fp.public_data_json ?? {};
  return (
    <Link href={`/future-projects/${fp.slug}`} className="block">
      <ReamarCard className="p-4 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-800">{fp.name}</p>
              {fp.renovation && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Rekonstrukce</span>}
              {!!pub.cooperative_housing && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Družstevní</span>}
            </div>
            {fp.developer && <p className="text-xs text-slate-500">{fp.developer}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              {fp.city && <span>{fp.city}{fp.municipal_district ? ` \u2014 ${fp.municipal_district}` : ""}</span>}
              {fp.project_type && <span>{fp.project_type}</span>}
              {fp.total_units != null && <span>{fp.total_units} jednotek</span>}
              {fp.construction_completion && <span>Dokončení: {fp.construction_completion}</span>}
              {fp.date_sale_start && <span>Prodej od: {fp.date_sale_start}</span>}
            </div>
            {!!(pub.ride_to_center || pub.public_transport_to_center || pub.overall_quality || pub.standards_rating) && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {!!pub.ride_to_center && <span>Autem do centra: {String(pub.ride_to_center)} min</span>}
                {!!pub.public_transport_to_center && <span>MHD do centra: {String(pub.public_transport_to_center)} min</span>}
                {!!pub.overall_quality && <span>Kvalita: {String(pub.overall_quality)}</span>}
                {!!pub.standards_rating && <span>Standardy: {String(pub.standards_rating)}</span>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              fp.stage === "Výstavba" ? "bg-blue-100 text-blue-700" :
              fp.stage === "Dokončeno" ? "bg-emerald-100 text-emerald-700" :
              "bg-slate-100 text-slate-600"
            }`}>
              {fp.stage || "V přípravě"}
            </span>
            {fp.interest_count > 0 && (
              <span className="text-[10px] text-slate-400">{fp.interest_count} zájemců</span>
            )}
            {fp.url && (
              <span className="text-[10px] text-blue-500">{`Web \u2197`}</span>
            )}
          </div>
        </div>
      </ReamarCard>
    </Link>
  );
}

export default function FutureProjectsPage() {
  const [projects, setProjects] = useState<FutureProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("projects");

  useEffect(() => {
    const token = localStorage.getItem("broker_token");
    if (!token) { setError("Nepřihlášen"); setLoading(false); return; }
    fetch(`${API_BASE}/future-projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Chyba načítání")))
      .then((data: FutureProject[]) => setProjects(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const pins = useMemo<FutureProjectPin[]>(() =>
    projects
      .filter((fp) => fp.gps_latitude != null && fp.gps_longitude != null)
      .map((fp) => ({
        id: fp.id, name: fp.name, slug: fp.slug,
        lat: fp.gps_latitude!, lng: fp.gps_longitude!,
        developer: fp.developer, stage: fp.stage, total_units: fp.total_units,
        date_sale_start: fp.date_sale_start, construction_completion: fp.construction_completion,
      })),
    [projects],
  );

  const sorted = useMemo(() => sortProjects(projects, sortKey, sortDir), [projects, sortKey, sortDir]);
  const devGroups = useMemo(() => groupByDeveloper(projects), [projects]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "total_units" ? "desc" : "asc");
    }
  };

  if (loading) return <div className="mx-auto max-w-5xl px-4 py-8"><p className="text-sm text-slate-400">Načítám…</p></div>;
  if (error) return <div className="mx-auto max-w-5xl px-4 py-8"><p className="text-sm text-rose-600">{error}</p></div>;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Připravujeme</p>
        <h1 className="text-xl font-semibold text-slate-900">Budoucí projekty</h1>
        <p className="mt-1 text-sm text-slate-500">
          {projects.length} projektů v přípravě — zatím bez detailních parametrů jednotek.
        </p>
      </div>

      {pins.length > 0 && <FutureProjectsMap pins={pins} linkPrefix="/future-projects" />}

      {/* Toolbar: view toggle + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "projects" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            onClick={() => setViewMode("projects")}
          >
            Projekty
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "developers" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            onClick={() => setViewMode("developers")}
          >
            Dle developera
          </button>
        </div>

        {viewMode === "projects" && (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-400">Řadit:</span>
            {SORT_OPTIONS.map((opt) => {
              const active = sortKey === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleSort(opt.value)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {opt.label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {projects.length === 0 && (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-500">Zatím žádné budoucí projekty.</p>
        </ReamarCard>
      )}

      {/* Projects view */}
      {viewMode === "projects" && (
        <div className="grid gap-3">
          {sorted.map((fp) => <ProjectCard key={fp.id} fp={fp} />)}
        </div>
      )}

      {/* Developer aggregation view */}
      {viewMode === "developers" && (
        <div className="space-y-4">
          {devGroups.map((group) => (
            <div key={group.developer}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-slate-800">{group.developer}</h3>
                <span className="text-xs text-slate-500">
                  {group.projects.length} {group.projects.length === 1 ? "projekt" : group.projects.length < 5 ? "projekty" : "projektů"}
                  {" · "}{group.totalUnits} jednotek
                </span>
              </div>
              <div className="grid gap-2">
                {group.projects.map((fp) => <ProjectCard key={fp.id} fp={fp} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
