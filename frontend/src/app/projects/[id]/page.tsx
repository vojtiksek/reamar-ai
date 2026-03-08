"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE } from "@/lib/api";
import type { FiltersResponse } from "@/lib/filters";
import { flattenFilterSpecsByKey } from "@/lib/filters";
import {
  formatCurrencyCzk,
  formatMinutes,
  formatPercent,
  formatValue as formatValueLib,
} from "@/lib/format";

const ProjectDetailMap = dynamic(
  () => import("@/app/units/[external_id]/UnitDetailMap"),
  { ssr: false }
);

type ProjectDetail = Record<string, unknown>;

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type UnitInProject = {
  external_id: string;
  unit_name: string | null;
  layout: string | null;
  floor_area_m2: number | null;
  exterior_area_m2?: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  available: boolean;
  project?: { name?: string };
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params?.id as string | undefined;

  const debugMode = searchParams?.get("debug") === "1";

  const [projectState, setProjectState] = useState<FetchState<ProjectDetail>>({
    data: null,
    loading: true,
    error: null,
  });
  const [unitsState, setUnitsState] = useState<FetchState<UnitInProject[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const [filtersState, setFiltersState] = useState<FetchState<FiltersResponse>>({
    data: null,
    loading: false,
    error: null,
  });
  const [editMode, setEditMode] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const filterSpecsByKey = useMemo(
    () => (filtersState.data?.groups ? flattenFilterSpecsByKey(filtersState.data.groups) : new Map()),
    [filtersState.data]
  );

  useEffect(() => {
    if (!projectId) return;

    setProjectState({ data: null, loading: true, error: null });
    fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((projectJson) => {
        setProjectState({ data: projectJson as ProjectDetail, loading: false, error: null });
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Chyba";
        setProjectState({ data: null, loading: false, error: msg });
      });
  }, [projectId]);

  useEffect(() => {
    setFiltersState((prev) => ({ ...prev, loading: true }));
    fetch(`${API_BASE}/filters`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: FiltersResponse) => {
        setFiltersState({ data, loading: false, error: null });
      })
      .catch(() => {
        setFiltersState({ data: null, loading: false, error: null });
      });
  }, []);

  // Načíst jednotky v projektu (podle názvu projektu)
  useEffect(() => {
    const projectName = projectState.data && (
      (projectState.data["project"] as string | undefined) ??
      (projectState.data["name"] as string | undefined)
    );
    if (!projectName || projectState.loading) {
      setUnitsState({ data: null, loading: false, error: null });
      return;
    }
    setUnitsState({ data: null, loading: true, error: null });
    const params = new URLSearchParams();
    params.set("project", projectName);
    params.set("limit", "500");
    fetch(`${API_BASE}/units?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((json: { items?: UnitInProject[] }) => {
        const items = json?.items ?? [];
        setUnitsState({ data: items, loading: false, error: null });
      })
      .catch((e) => {
        setUnitsState({
          data: null,
          loading: false,
          error: e instanceof Error ? e.message : "Chyba načítání jednotek",
        });
      });
  }, [projectState.data, projectState.loading]);

  const project = projectState.data;

  // Name can come from catalog key "project" (alias for name) or "name"
  const name =
    (project && ((project["project"] as string | undefined) ?? (project["name"] as string | undefined))) || "";
  const developer = (project && (project["developer"] as string | undefined)) ?? "—";
  const address = (project && (project["address"] as string | undefined)) ?? "—";
  const projectGpsLat =
    project != null ? ((project["gps_latitude"] as number | null | undefined) ?? null) : null;
  const projectGpsLng =
    project != null ? ((project["gps_longitude"] as number | null | undefined) ?? null) : null;

  const EDITABLE_PREHLED = ["project_url"] as const;
  const EDITABLE_FINANCOVANI = [
    "payment_contract",
    "payment_construction",
    "payment_occupancy",
    "min_parking_indoor_price_czk",
    "min_parking_outdoor_price_czk",
  ] as const;
  const EDITABLE_STANDARDY = [
    "renovation",
    "overall_quality",
    "windows",
    "partition_walls",
    "heating",
    "category",
    "floors",
    "air_conditioning",
    "cooling_ceilings",
    "exterior_blinds",
    "smart_home",
  ] as const;
  const EDITABLE_OSTATNI = ["amenities"] as const;

  const fillDraftFromProject = useCallback((p: ProjectDetail) => {
    const draft: Record<string, unknown> = {};
    for (const key of EDITABLE_PREHLED) {
      const v = p[key];
      draft[key] = v != null && v !== "" ? String(v) : "";
    }
    for (const key of EDITABLE_FINANCOVANI) {
      const v = p[key];
      if (key.startsWith("payment_")) {
        const num = typeof v === "number" ? v : Number(v);
        draft[key] = Number.isNaN(num) ? "" : (num > 1 ? num : num * 100);
      } else {
        draft[key] = v != null && v !== "" ? (typeof v === "number" ? v : Math.round(Number(v)) || "") : "";
      }
    }
    for (const key of EDITABLE_STANDARDY) {
      const v = p[key];
      if (key === "renovation" || key === "air_conditioning" || key === "cooling_ceilings" || key === "exterior_blinds" || key === "smart_home") {
        draft[key] = v === true || v === "true" || v === "1" || String(v).toLowerCase() === "ano";
      } else {
        draft[key] = v != null && v !== "" ? String(v) : "";
      }
    }
    for (const key of EDITABLE_OSTATNI) {
      const v = p[key];
      draft[key] = v != null && v !== "" ? String(v) : "";
    }
    return draft;
  }, []);

  const handleStartEdit = useCallback(() => {
    if (!project) return;
    setDraftValues(fillDraftFromProject(project));
    setEditMode(true);
  }, [project, fillDraftFromProject]);

  const handleCancel = useCallback(() => {
    setEditMode(false);
    setDraftValues({});
  }, []);

  const handleChangeDraft = useCallback((key: string, value: unknown) => {
    setDraftValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!project || !projectId) return;
    setSaving(true);
    const allEditable = [
      ...EDITABLE_PREHLED,
      ...EDITABLE_FINANCOVANI,
      ...EDITABLE_STANDARDY,
      ...EDITABLE_OSTATNI,
    ];
    const changes: { key: string; value: string }[] = [];
    for (const key of allEditable) {
      const draftVal = draftValues[key];
      const currentVal = project[key];
      let isChanged = false;
      let payload = "";

      if (key.startsWith("payment_")) {
        const draftNum = Number(draftVal);
        const draftFraction = Number.isNaN(draftNum) ? null : draftNum > 1 ? draftNum / 100 : draftNum;
        const currentFraction = typeof currentVal === "number" ? currentVal : currentVal != null ? Number(currentVal) : null;
        if (draftFraction != null && draftFraction >= 0 && draftFraction <= 1) {
          const same = currentFraction != null && Math.abs(draftFraction - currentFraction) < 1e-6;
          if (!same) {
            isChanged = true;
            payload = String(Math.round(draftFraction * 10000) / 10000);
          }
        } else if (draftVal === "" && currentVal != null) {
          isChanged = true;
          payload = "";
        }
      } else if (key === "min_parking_indoor_price_czk" || key === "min_parking_outdoor_price_czk") {
        const n = draftVal === "" ? null : Math.round(Number(draftVal));
        const cur = currentVal != null ? Math.round(Number(currentVal)) : null;
        if (String(n ?? "") !== String(cur ?? "")) {
          isChanged = true;
          payload = n != null && !Number.isNaN(n) ? String(n) : "";
        }
      } else if (
        key === "renovation" ||
        key === "air_conditioning" ||
        key === "cooling_ceilings" ||
        key === "exterior_blinds" ||
        key === "smart_home"
      ) {
        const draftBool = draftVal === true || draftVal === "true" || draftVal === "1";
        const curBool = currentVal === true || currentVal === "true" || currentVal === "1";
        if (draftBool !== curBool) {
          isChanged = true;
          payload = draftBool ? "true" : "false";
        }
      } else {
        const draftStr = draftVal == null ? "" : String(draftVal).trim();
        const currentStr = currentVal == null ? "" : String(currentVal).trim();
        if (draftStr !== currentStr) {
          isChanged = true;
          payload = draftStr;
        }
      }

      if (isChanged) {
        changes.push({ key, value: payload });
      }
    }
    try {
      let updated = { ...project };
      for (const { key, value } of changes) {
        const res = await fetch(
          `${API_BASE}/projects/${encodeURIComponent(projectId)}/overrides/${encodeURIComponent(key)}`,
          { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) }
        );
        if (!res.ok) throw new Error(await res.text());
        updated = (await res.json()) as ProjectDetail;
      }
      setProjectState((prev) => ({ ...prev, data: updated }));
      setEditMode(false);
      setDraftValues({});
    } catch (e) {
      setProjectState((prev) => ({
        ...prev,
        error: e instanceof Error ? e.message : "Chyba při ukládání",
      }));
    } finally {
      setSaving(false);
    }
  }, [project, projectId, draftValues]);

  const draft = (key: string) => (editMode && key in draftValues ? draftValues[key] : undefined);
  const displayOrDraft = (key: string, fallback: unknown) =>
    draft(key) !== undefined ? draft(key) : fallback;

  if (projectState.loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl p-4">
          <p className="text-slate-600">Načítání…</p>
        </div>
      </div>
    );
  }

  if (projectState.error) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Zpět
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {projectState.error}
          </div>
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Zpět
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4">
          <p className="text-slate-600">Projekt nenalezen.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Zpět
            </button>
            <h1 className="text-lg font-semibold text-slate-900">{name || "Projekt"}</h1>
          </div>
          <div className="flex items-center gap-2">
            {!editMode ? (
              <button
                type="button"
                onClick={handleStartEdit}
                disabled={saving}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                Editovat
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? "Ukládám…" : "Uložit"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  Zrušit
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4">
        {/* Řádek: Přehled + Mapa vedle sebe */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Přehled
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Název</p>
                <p className="mt-0.5 font-medium text-slate-900">{name || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Developer</p>
                <p className="mt-0.5 font-medium text-slate-900">{developer}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Odkaz projektu</p>
                {editMode ? (
                  <input
                    type="url"
                    className="mt-0.5 w-full max-w-md rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    value={(displayOrDraft("project_url", project["project_url"]) as string) ?? ""}
                    onChange={(e) => handleChangeDraft("project_url", e.target.value)}
                    placeholder="https://…"
                  />
                ) : (project["project_url"] as string | undefined) ? (
                  <p className="mt-0.5 font-medium text-slate-900">
                    <a
                      href={project["project_url"] as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600"
                    >
                      {(project["project_url"] as string).replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                    </a>
                  </p>
                ) : (
                  <p className="mt-0.5 font-medium text-slate-900">—</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Dní na trhu (max)</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["max_days_on_market"] != null ? `${project["max_days_on_market"]} dní` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">První výskyt</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["project_first_seen"] as string | undefined) ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Poslední výskyt</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["project_last_seen"] as string | undefined) ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Datum prodeje</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["sold_date"] as string | undefined) ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Počet jednotek</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["total_units"] != null ? String(project["total_units"]) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Dostupných jednotek</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["available_units"] != null ? String(project["available_units"]) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Podíl dostupných</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatPercent(
                    (project["availability_ratio"] as number | null | undefined) ?? null,
                    undefined,
                    true
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Min cena</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    (project["min_price_czk"] as number | null | undefined) ?? null
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Max cena</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    (project["max_price_czk"] as number | null | undefined) ?? null
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Průměrná cena</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    (project["avg_price_czk"] as number | null | undefined) ?? null
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Průměrná cena/m²</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    (project["avg_price_per_m2_czk"] as number | null | undefined) ?? null
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Průměrná plocha m²</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["avg_floor_area_m2"] != null
                    ? `${Number(project["avg_floor_area_m2"]).toLocaleString("cs-CZ")} m²`
                    : "—"}
                </p>
              </div>
            </div>
          </section>

          {projectGpsLat != null && projectGpsLng != null && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold tracking-wide text-slate-500">
                <span className="uppercase">Poloha</span>:{" "}
                <span className="font-medium normal-case text-slate-900">
                  {address || name || "—"}
                </span>
              </h2>
              <ProjectDetailMap
                lat={projectGpsLat}
                lng={projectGpsLng}
                label={name || undefined}
              />
            </section>
          )}
        </div>

        {/* Financování a parkování – celá šířka */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Financování a parkování
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Platba po SOSBK (%)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="mt-0.5 w-full max-w-[8rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    draft("payment_contract") !== undefined
                      ? String(draft("payment_contract"))
                      : (project["payment_contract"] as number) != null
                        ? ((project["payment_contract"] as number) > 1
                          ? (project["payment_contract"] as number)
                          : (project["payment_contract"] as number) * 100)
                        : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value)));
                    handleChangeDraft("payment_contract", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatPercent(
                    (project["payment_contract"] as number | null | undefined) ?? null,
                    undefined,
                    true
                  )}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Platba při výstavbě (%)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="mt-0.5 w-full max-w-[8rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    draft("payment_construction") !== undefined
                      ? String(draft("payment_construction"))
                      : (project["payment_construction"] as number) != null
                        ? ((project["payment_construction"] as number) > 1
                          ? (project["payment_construction"] as number)
                          : (project["payment_construction"] as number) * 100)
                        : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value)));
                    handleChangeDraft("payment_construction", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatPercent(
                    (project["payment_construction"] as number | null | undefined) ?? null,
                    undefined,
                    true
                  )}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Platba po dokončení (%)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="mt-0.5 w-full max-w-[8rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    draft("payment_occupancy") !== undefined
                      ? String(draft("payment_occupancy"))
                      : (project["payment_occupancy"] as number) != null
                        ? ((project["payment_occupancy"] as number) > 1
                          ? (project["payment_occupancy"] as number)
                          : (project["payment_occupancy"] as number) * 100)
                        : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value)));
                    handleChangeDraft("payment_occupancy", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatPercent(
                    (project["payment_occupancy"] as number | null | undefined) ?? null,
                    undefined,
                    true
                  )}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Cena garáže (Kč)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    (displayOrDraft(
                      "min_parking_indoor_price_czk",
                      (project["min_parking_indoor_price_czk"] ?? project["max_parking_indoor_price_czk"]) ?? ""
                    ) as string) || ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value)));
                    handleChangeDraft("min_parking_indoor_price_czk", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    ((project["min_parking_indoor_price_czk"] as number | null | undefined) ??
                      (project["max_parking_indoor_price_czk"] as number | null | undefined)) ?? null
                  )}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Cena stání (Kč)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    (displayOrDraft(
                      "min_parking_outdoor_price_czk",
                      (project["min_parking_outdoor_price_czk"] ?? project["max_parking_outdoor_price_czk"]) ?? ""
                    ) as string) || ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value)));
                    handleChangeDraft("min_parking_outdoor_price_czk", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    ((project["min_parking_outdoor_price_czk"] as number | null | undefined) ??
                      (project["max_parking_outdoor_price_czk"] as number | null | undefined)) ?? null
                  )}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Standardy – všechna pole upravitelná, enum z filtrů */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Standardy
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Rekonstrukce</p>
              {editMode ? (
                <label className="mt-0.5 flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={draft("renovation") === true || draft("renovation") === "true"}
                    onChange={(e) => handleChangeDraft("renovation", e.target.checked)}
                  />
                  <span className="text-sm text-slate-900">
                    {(draft("renovation") === true || draft("renovation") === "true") ? "Ano" : "Ne"}
                  </span>
                </label>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatValueLib(project["renovation"], { display_format: "boolean", key: "renovation" })}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Kvalita</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("overall_quality", project["overall_quality"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("overall_quality", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("overall_quality")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["overall_quality"] as string | null | undefined) ?? "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Okna</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("windows", project["windows"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("windows", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("windows")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["windows"] as string | null | undefined) ?? "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Příčky</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("partition_walls", project["partition_walls"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("partition_walls", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("partition_walls")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["partition_walls"] as string | null | undefined) ?? "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Topení</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("heating", project["heating"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("heating", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("heating")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["heating"] as string | null | undefined) ?? "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Kategorie</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("category", project["category"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("category", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("category")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["category"] as string | null | undefined) ?? "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Podlaží (budovy)</p>
              {editMode ? (
                (() => {
                  const floorsOpts = filterSpecsByKey.get("floors")?.options as string[] | undefined;
                  if (floorsOpts?.length) {
                    return (
                      <select
                        className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        value={(displayOrDraft("floors", project["floors"]) as string) ?? ""}
                        onChange={(e) => handleChangeDraft("floors", e.target.value)}
                      >
                        <option value="">—</option>
                        {floorsOpts.map((opt) => (
                          <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
                        ))}
                      </select>
                    );
                  }
                  return (
                    <input
                      type="text"
                      className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      value={(displayOrDraft("floors", project["floors"]) as string) ?? ""}
                      onChange={(e) => handleChangeDraft("floors", e.target.value)}
                    />
                  );
                })()
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["floors"] != null && project["floors"] !== "" ? String(project["floors"]) : "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Klimatizace</p>
              {editMode ? (
                <label className="mt-0.5 flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={draft("air_conditioning") === true || draft("air_conditioning") === "true"}
                    onChange={(e) => handleChangeDraft("air_conditioning", e.target.checked)}
                  />
                  <span className="text-sm text-slate-900">
                    {(draft("air_conditioning") === true || draft("air_conditioning") === "true") ? "Ano" : "Ne"}
                  </span>
                </label>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatValueLib(project["air_conditioning"], { display_format: "boolean", key: "air_conditioning" })}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Chlazení stropem</p>
              {editMode ? (
                <label className="mt-0.5 flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={draft("cooling_ceilings") === true || draft("cooling_ceilings") === "true"}
                    onChange={(e) => handleChangeDraft("cooling_ceilings", e.target.checked)}
                  />
                  <span className="text-sm text-slate-900">
                    {(draft("cooling_ceilings") === true || draft("cooling_ceilings") === "true") ? "Ano" : "Ne"}
                  </span>
                </label>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatValueLib(project["cooling_ceilings"], { display_format: "boolean", key: "cooling_ceilings" })}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Žaluzie</p>
              {editMode ? (
                <label className="mt-0.5 flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={draft("exterior_blinds") === true || draft("exterior_blinds") === "true"}
                    onChange={(e) => handleChangeDraft("exterior_blinds", e.target.checked)}
                  />
                  <span className="text-sm text-slate-900">
                    {(draft("exterior_blinds") === true || draft("exterior_blinds") === "true") ? "Ano" : "Ne"}
                  </span>
                </label>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatValueLib(project["exterior_blinds"], { display_format: "boolean", key: "exterior_blinds" })}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Smart home</p>
              {editMode ? (
                <label className="mt-0.5 flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={draft("smart_home") === true || draft("smart_home") === "true"}
                    onChange={(e) => handleChangeDraft("smart_home", e.target.checked)}
                  />
                  <span className="text-sm text-slate-900">
                    {(draft("smart_home") === true || draft("smart_home") === "true") ? "Ano" : "Ne"}
                  </span>
                </label>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatValueLib(project["smart_home"], { display_format: "boolean", key: "smart_home" })}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Lokalita */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Lokalita
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Autem do centra</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatMinutes(
                  (project["ride_to_center_min"] as number | null | undefined) ??
                    (project["ride_to_center"] as number | null | undefined) ??
                    null
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">MHD do centra</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatMinutes(
                  (project["public_transport_to_center_min"] as number | null | undefined) ??
                    (project["public_transport_to_center"] as number | null | undefined) ??
                    null
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Obec</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["municipality"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Město</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["city"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Okres</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["district"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Katastrální území</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["cadastral_area_iga"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Obvod Prahy</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["administrative_district_iga"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Kraj</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["region_iga"] as string | null | undefined) ?? "—"}
              </p>
            </div>
          </div>
        </section>

        {/* Ostatní – Zajímavosti upravitelné */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Ostatní
          </h2>
          <div>
            <p className="text-xs font-medium text-slate-500">Zajímavosti</p>
            {editMode ? (
              <textarea
                className="mt-0.5 w-full max-w-2xl rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                rows={4}
                value={(displayOrDraft("amenities", project["amenities"]) as string) ?? ""}
                onChange={(e) => handleChangeDraft("amenities", e.target.value)}
              />
            ) : (
              <p className="mt-0.5 font-medium text-slate-900 whitespace-pre-wrap">
                {(project["amenities"] as string | null | undefined) ?? "—"}
              </p>
            )}
          </div>
        </section>

        {/* Jednotky v projektu */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Jednotky v projektu
          </h2>
          {unitsState.loading ? (
            <p className="text-sm text-slate-600">Načítání jednotek…</p>
          ) : unitsState.error ? (
            <p className="text-sm text-red-600">{unitsState.error}</p>
          ) : !unitsState.data || unitsState.data.length === 0 ? (
            <p className="text-sm text-slate-600">Žádné jednotky.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Jednotka</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Dispozice</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-700">Plocha</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-700">Venek</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-700">Cena</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-700">Cena/m²</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Stav</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {unitsState.data.map((u) => {
                    const layoutStr =
                      u.layout != null && /^layout_(\d+)(?:_(\d+))?$/i.test(String(u.layout))
                        ? String(u.layout).replace(/^layout_(\d+)(?:_(\d+))?$/i, (_, a, b) =>
                            b ? `${a},${b} kk` : `${a} kk`
                          )
                        : u.layout ?? "—";
                    return (
                      <tr key={u.external_id} className="hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <Link
                            href={`/units/${encodeURIComponent(u.external_id)}`}
                            className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600"
                          >
                            {u.unit_name ?? u.external_id}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-slate-900">{layoutStr}</td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          {u.floor_area_m2 != null ? `${u.floor_area_m2.toFixed(1)} m²` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          {u.exterior_area_m2 != null ? `${u.exterior_area_m2.toFixed(1)} m²` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          {u.price_czk != null ? formatCurrencyCzk(u.price_czk) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          {u.price_per_m2_czk != null ? formatCurrencyCzk(u.price_per_m2_czk) : "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-900">
                          {u.available ? "Dostupná" : "Prodaná/rezervovaná"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

