"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { isEditableCatalogColumn } from "@/lib/columns";
import { API_BASE } from "@/lib/api";
import { formatCurrencyCzk, formatPercent } from "@/lib/format";

const ProjectDetailMap = dynamic(
  () => import("@/app/units/[external_id]/UnitDetailMap"),
  { ssr: false }
);

type ProjectDetail = Record<string, unknown>;

type ProjectColumn = {
  key: string;
  label: string;
  data_type: string;
  unit?: string | null;
  kind?: "catalog" | "computed";
  editable?: boolean | string | number | null;
  entity?: string | null;
};

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

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "ANO" : "NE";
  return String(value);
}

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const s = String(value ?? "").toLowerCase();
  if (["true", "1", "yes", "ano", "on"].includes(s)) return true;
  if (["false", "0", "no", "ne", "off"].includes(s)) return false;
  return false;
}

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
  const [originalProject, setOriginalProject] = useState<ProjectDetail | null>(null);
  const [columnsState, setColumnsState] = useState<FetchState<ProjectColumn[]>>({
    data: null,
    loading: true,
    error: null,
  });
  const [editMode, setEditMode] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [unitsState, setUnitsState] = useState<FetchState<UnitInProject[]>>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!projectId) return;

    setProjectState({ data: null, loading: true, error: null });
    setColumnsState({ data: null, loading: true, error: null });

    Promise.all([
      fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(res.statusText))
      ),
      fetch(`${API_BASE}/columns?view=projects`).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(res.statusText))
      ),
    ])
      .then(([projectJson, columnsJson]) => {
        setProjectState({ data: projectJson as ProjectDetail, loading: false, error: null });
        setOriginalProject(projectJson as ProjectDetail);
        setColumnsState({
          data: Array.isArray(columnsJson) ? (columnsJson as ProjectColumn[]) : [],
          loading: false,
          error: null,
        });
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Chyba";
        setProjectState({ data: null, loading: false, error: msg });
        setColumnsState({ data: null, loading: false, error: msg });
      });
  }, [projectId]);

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

  const editableColumns = useMemo(() => {
    if (!columnsState.data) return [] as ProjectColumn[];
    const base = columnsState.data.filter((c) => isEditableCatalogColumn(c, { entity: "project" }));

    // Pro financování/parkování chceme pouze jednu hodnotu na projekt (bez "od"/"do").
    // Skryjeme tedy max_* varianty a u min_* přepíšeme label na finální název pole.
    const HIDE_KEYS = new Set<string>([
      "max_parking_indoor_price_czk",
      "max_parking_outdoor_price_czk",
      "max_payment_contract",
      "max_payment_construction",
      "max_payment_occupancy",
    ]);

    const SINGLE_VALUE_LABELS: Record<string, string> = {
      min_parking_indoor_price_czk: "Cena garáže (projekt)",
      min_parking_outdoor_price_czk: "Cena stání (projekt)",
      min_payment_contract: "Platba po SOSBK",
      min_payment_construction: "Platba při výstavbě",
      min_payment_occupancy: "Platba po dokončení",
    };

    const cols = base
      .filter((c) => !HIDE_KEYS.has(c.key))
      .map((c) =>
        SINGLE_VALUE_LABELS[c.key]
          ? { ...c, label: SINGLE_VALUE_LABELS[c.key] }
          : c
      );

    if (process.env.NODE_ENV === "development" && debugMode && columnsState.data.length > 0) {
      // Debug: help diagnose why no editable fields are shown
      // eslint-disable-next-line no-console
      console.log(
        "[ProjectDetail] columns loaded:",
        columnsState.data.length,
        "editable (after single-value filtering):",
        cols.length,
        "sample:",
        columnsState.data[0]
      );
    }

    return cols;
  }, [columnsState.data, debugMode]);

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

  const handleStartEdit = () => {
    if (!project) return;
    const nextDraft: Record<string, unknown> = {};
    editableColumns.forEach((col) => {
      if (col.key in project) {
        const val = project[col.key];
        if (col.data_type === "bool") {
          nextDraft[col.key] = parseBool(val);
        } else {
          nextDraft[col.key] = val ?? "";
        }
      }
    });
    setDraftValues(nextDraft);
    setEditMode(true);
  };

  const handleCancel = () => {
    setEditMode(false);
    setDraftValues({});
    if (originalProject) {
      setProjectState((prev) => ({ ...prev, data: originalProject }));
    }
  };

  const handleChangeDraft = (key: string, value: unknown) => {
    setDraftValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!project || !originalProject || !projectId) return;
    setSaving(true);
    let current: ProjectDetail = project;
    try {
      const changedColumns = editableColumns.filter((col) => {
        const key = col.key;
        if (!(key in draftValues)) return false;
        const nextVal = draftValues[key];
        const prevVal = originalProject[key];
        return String(nextVal ?? "") !== String(prevVal ?? "");
      });

      for (const col of changedColumns) {
        const key = col.key;
        const rawVal = draftValues[key];
        const payloadValue =
          rawVal === undefined || rawVal === null ? "" : col.data_type === "bool" ? String(!!rawVal) : String(rawVal);

        const res = await fetch(
          `${API_BASE}/projects/${encodeURIComponent(projectId)}/overrides/${encodeURIComponent(key)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: payloadValue }),
          }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Failed to save override for ${key}`);
        }
        const updated = (await res.json()) as ProjectDetail;
        current = updated;
      }

      setProjectState((prev) => ({ ...prev, data: current }));
      setOriginalProject(current);
      setEditMode(false);
      setDraftValues({});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chyba při ukládání";
      setProjectState((prev) => ({ ...prev, error: msg }));
    } finally {
      setSaving(false);
    }
  };

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
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Editovat
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Uložit
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
                <p className="text-xs font-medium text-slate-500">Adresa</p>
                <p className="mt-0.5 font-medium text-slate-900">{address}</p>
              </div>
            </div>
          </section>

          {projectGpsLat != null && projectGpsLng != null && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Poloha
              </h2>
              <ProjectDetailMap
                lat={projectGpsLat}
                lng={projectGpsLng}
                label={name || undefined}
              />
            </section>
          )}
        </div>

        {/* Shrnutí financování a parkování */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Shrnutí financování a parkování
          </h2>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Platba po SOSBK</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatPercent(
                  (project["payment_contract"] as number | null | undefined) ?? null,
                  undefined,
                  true
                )}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Platba při výstavbě</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatPercent(
                  (project["payment_construction"] as number | null | undefined) ?? null,
                  undefined,
                  true
                )}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Platba po dokončení</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatPercent(
                  (project["payment_occupancy"] as number | null | undefined) ?? null,
                  undefined,
                  true
                )}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Cena garáže (projekt)</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatCurrencyCzk(
                  ((project["min_parking_indoor_price_czk"] as number | null | undefined) ??
                    (project["max_parking_indoor_price_czk"] as number | null | undefined)) ?? null
                )}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Cena stání (projekt)</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatCurrencyCzk(
                  ((project["min_parking_outdoor_price_czk"] as number | null | undefined) ??
                    (project["max_parking_outdoor_price_czk"] as number | null | undefined)) ?? null
                )}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Dní na trhu (max)</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["max_days_on_market"] != null ? `${project["max_days_on_market"]} dní` : "—"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">První výskyt (projekt)</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["project_first_seen"] as string | undefined) ?? "—"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Poslední výskyt (projekt)</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["project_last_seen"] as string | undefined) ?? "—"}
              </p>
            </div>
          </div>
        </section>

        {/* Data o projektu (upravitelné údaje) */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Data o projektu
          </h2>
          {debugMode && (
            <p className="mb-3 text-xs text-slate-500">
              Sloupců: {columnsState.data?.length ?? 0}, upravitelných: {editableColumns.length}
            </p>
          )}
          {columnsState.loading ? (
            <p className="text-sm text-slate-600">Načítání sloupců…</p>
          ) : editableColumns.length === 0 ? (
            <p className="text-sm text-slate-600">Žádná upravitelná pole.</p>
          ) : (
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {editableColumns.map((col) => {
                const key = col.key;
                if (!(key in project)) return null;
                const currentValue = project[key];
                const draftValue = draftValues[key];

                return (
                  <div key={key} className="min-w-0">
                    <p className="text-xs font-medium text-slate-500">{col.label}</p>
                    {!editMode ? (
                      <p className="mt-0.5 font-medium text-slate-900">{formatValue(currentValue)}</p>
                    ) : col.data_type === "bool" ? (
                      <label className="mt-0.5 flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={parseBool(draftValue)}
                          onChange={(e) => handleChangeDraft(key, e.target.checked)}
                        />
                        <span className="text-sm text-slate-900">
                          {parseBool(draftValue) ? "Ano" : "Ne"}
                        </span>
                      </label>
                    ) : col.data_type === "number" ? (
                      <input
                        type="number"
                        className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        value={(draftValue as number | string) ?? ""}
                        onChange={(e) => handleChangeDraft(key, e.target.value)}
                      />
                    ) : (
                      <input
                        type="text"
                        className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        value={(draftValue as string) ?? ""}
                        onChange={(e) => handleChangeDraft(key, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
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

