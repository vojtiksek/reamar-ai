"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { isEditableCatalogColumn } from "@/lib/columns";

const API_BASE = "http://127.0.0.1:8001";

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

  const editableColumns = useMemo(() => {
    if (!columnsState.data) return [] as ProjectColumn[];
    const cols = columnsState.data.filter((c) => isEditableCatalogColumn(c, { entity: "project" }));

    if (process.env.NODE_ENV === "development" && debugMode && columnsState.data.length > 0) {
      // Debug: help diagnose why no editable fields are shown
      // eslint-disable-next-line no-console
      console.log(
        "[ProjectDetail] columns loaded:",
        columnsState.data.length,
        "editable:",
        cols.length,
        "sample:",
        columnsState.data[0]
      );
    }

    return cols;
  }, [columnsState.data, debugMode]);

  const project = projectState.data;

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

  const name = (project && (project["name"] as string | undefined)) ?? "";
  const developer = (project && (project["developer"] as string | undefined)) ?? "—";
  const address = (project && (project["address"] as string | undefined)) ?? "—";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5 shadow-sm sm:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">Reamar</h1>
          <div className="relative z-10 flex shrink-0 items-center rounded-lg border border-gray-200 bg-gray-50/50 p-0.5">
            <Link
              href="/units"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white hover:text-gray-900"
            >
              Jednotky
            </Link>
            <Link
              href="/projects"
              className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-900"
            >
              Projekty
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!editMode ? (
            <button
              type="button"
              onClick={handleStartEdit}
              disabled={!project || saving}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Editovat
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Uložit
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Zrušit
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {projectState.error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {projectState.error}
          </div>
        )}

        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-base font-semibold text-gray-900">Projekt</h2>
            {projectState.loading ? (
              <p className="text-sm text-gray-600">Načítání…</p>
            ) : !project ? (
              <p className="text-sm text-gray-600">Projekt nenalezen.</p>
            ) : (
              <dl className="grid gap-2 text-sm text-gray-900 sm:grid-cols-3">
                <div>
                  <dt className="font-medium text-gray-500">Název</dt>
                  <dd>{name || "—"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">Developer</dt>
                  <dd>{developer}</dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">Adresa</dt>
                  <dd>{address}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-gray-900">Upravitelné údaje</h2>
            {debugMode && (
              <p className="mb-2 text-xs text-gray-500">
                Loaded columns: {columnsState.data?.length ?? 0}, editable: {editableColumns.length}
              </p>
            )}
            {columnsState.loading ? (
              <p className="text-sm text-gray-600">Načítání sloupců…</p>
            ) : editableColumns.length === 0 ? (
              <p className="text-sm text-gray-600">Žádná upravitelná pole.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">Pole</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">Hodnota</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {editableColumns.map((col) => {
                      const key = col.key;
                      if (!project || !(key in project)) {
                        return null;
                      }
                      const currentValue = project[key];
                      const draftValue = draftValues[key];

                      return (
                        <tr key={key}>
                          <td className="px-4 py-2 align-top text-gray-900">{col.label}</td>
                          <td className="px-4 py-2">
                            {!editMode ? (
                              <span className="text-gray-900">{formatValue(currentValue)}</span>
                            ) : col.data_type === "bool" ? (
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={parseBool(draftValue)}
                                onChange={(e) => handleChangeDraft(key, e.target.checked)}
                              />
                            ) : col.data_type === "number" ? (
                              <input
                                type="number"
                                className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
                                value={draftValue ?? ""}
                                onChange={(e) => handleChangeDraft(key, e.target.value)}
                              />
                            ) : (
                              <input
                                type="text"
                                className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
                                value={(draftValue as string | undefined) ?? ""}
                                onChange={(e) => handleChangeDraft(key, e.target.value)}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

