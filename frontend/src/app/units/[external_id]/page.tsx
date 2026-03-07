"use client";

import {
  formatAreaM2,
  formatCurrencyCzk,
  formatLayout,
  formatValue,
  type FormatValueMeta,
} from "@/lib/format";
import { isEditableCatalogColumn } from "@/lib/columns";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type UnitDetail = {
  external_id: string;
  project_id: number;
  project: { name: string; gps_latitude?: number | null; gps_longitude?: number | null; [k: string]: unknown };
  unit_name: string | null;
  layout: string | null;
  floor_area_m2: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  available: boolean;
  availability_status?: string | null;
  equivalent_area_m2?: number | null;
  exterior_area_m2?: number | null;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type PriceHistoryEntry = {
  captured_at: string;
  price_czk: number | null;
};

type UnitColumn = {
  key: string;
  label: string;
  data_type: string;
  entity?: string | null;
  editable?: boolean | string | number | null;
  kind?: string | null;
  accessor?: string;
  display_format?: string;
};

const UnitDetailMap = dynamic(() => import("./UnitDetailMap"), { ssr: false });

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type EditableUnitColumn = UnitColumn & { overrideField: string };

type DebugLog = {
  label: string;
  url: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  bodySnippet?: string;
  errorMessage?: string;
};

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const s = String(value ?? "").toLowerCase();
  if (["true", "1", "yes", "ano", "on"].includes(s)) return true;
  if (["false", "0", "no", "ne", "off"].includes(s)) return false;
  return false;
}

function getUnitDisplayValue(unit: UnitDetail, col: UnitColumn): unknown {
  const u = unit as Record<string, unknown>;
  const accessor = col.accessor ?? col.key;
  if (col.key === "unit_url") {
    return (unit as { url?: string }).url ?? unit.data?.unit_url;
  }
  if (col.key === "project_url" || accessor === "project.project_url") {
    const raw = (unit as { url?: string }).url ?? unit.data?.unit_url;
    if (raw && typeof raw === "string") {
      try {
        const parsed = new URL(raw);
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        const i = raw.indexOf(".cz/");
        if (i !== -1) return raw.slice(0, i + 3);
        return raw;
      }
    }
    return undefined;
  }
  const fromData = unit.data && col.key in unit.data ? unit.data[col.key] : undefined;
  if (fromData !== undefined) return fromData;
  const parts = accessor.split(".");
  let v: unknown = u;
  for (const p of parts) {
    if (v == null) return undefined;
    v = (v as Record<string, unknown>)[p];
  }
  return v;
}

function formatDisplayValue(value: unknown, col: UnitColumn): string {
  const meta: FormatValueMeta = {
    display_format: col.display_format ?? col.data_type,
    key: col.key,
  };
  return formatValue(value, meta);
}

export default function UnitDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const external_id = params.external_id as string;

  const debugMode = searchParams?.get("debug") === "1";

  const [unitState, setUnitState] = useState<FetchState<UnitDetail>>({
    data: null,
    loading: true,
    error: null,
  });
  const [originalUnit, setOriginalUnit] = useState<UnitDetail | null>(null);
  const [history, setHistory] = useState<PriceHistoryEntry[]>([]);
  const [columnsState, setColumnsState] = useState<FetchState<UnitColumn[]>>({
    data: null,
    loading: true,
    error: null,
  });
  const [editMode, setEditMode] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);

  const appendDebugLog = (log: DebugLog) => {
    setDebugLogs((prev) => [...prev, log]);
  };

  async function fetchJsonWithDebug<T>(url: string, label: string): Promise<T> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        const bodySnippet = text.slice(0, 200);
        let detail: string | undefined;
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.detail === "string") {
            detail = parsed.detail;
          }
        } catch {
          // ignore JSON parse errors
        }

        appendDebugLog({
          label,
          url,
          ok: false,
          status: res.status,
          statusText: res.statusText,
          bodySnippet,
        });

        let userMessage: string;
        if (res.status === 404 && detail) {
          userMessage = detail;
        } else if (res.status >= 500) {
          userMessage = `Server error (${res.status})`;
        } else {
          userMessage = detail ?? (res.statusText || `HTTP ${res.status}`);
        }

        throw new Error(userMessage);
      }

      appendDebugLog({
        label,
        url,
        ok: true,
        status: res.status,
        statusText: res.statusText,
      });

      return (await res.json()) as T;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      appendDebugLog({
        label,
        url,
        ok: false,
        errorMessage: message,
      });
      throw e;
    }
  }

  useEffect(() => {
    if (!external_id) return;
    const id = decodeURIComponent(external_id);

    setUnitState({ data: null, loading: true, error: null });
    setColumnsState({ data: null, loading: true, error: null });
    setHistory([]);
    setDebugLogs([]);

    const unitUrl = `${API_BASE}/units/${encodeURIComponent(id)}`;
    const columnsUrl = `${API_BASE}/columns?view=units`;
    const historyUrl = `${API_BASE}/units/${encodeURIComponent(id)}/price-history`;

    void (async () => {
      try {
        // Required: unit + columns
        const [u, cols] = await Promise.all([
          fetchJsonWithDebug<UnitDetail>(unitUrl, "unit"),
          fetchJsonWithDebug<UnitColumn[]>(columnsUrl, "columns"),
        ]);

        setUnitState({ data: u, loading: false, error: null });
        setOriginalUnit(u);
        setColumnsState({
          data: Array.isArray(cols) ? cols : [],
          loading: false,
          error: null,
        });

        // Optional: price history – do not fail the whole page if it errors
        try {
          const h = await fetchJsonWithDebug<PriceHistoryEntry[]>(historyUrl, "price-history");
          setHistory(Array.isArray(h) ? h : []);
        } catch {
          // leave history empty; error is visible in debugLogs
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Chyba";
        setUnitState({ data: null, loading: false, error: msg });
        setColumnsState({ data: null, loading: false, error: msg });
      }
    })();
  }, [external_id]);

  const unit = unitState.data;

  const editableColumns = useMemo<EditableUnitColumn[]>(() => {
    if (!columnsState.data) return [];

    const cols: EditableUnitColumn[] = columnsState.data
      .filter((c) => isEditableCatalogColumn({ ...c, key: c.key }, { entity: "unit" }))
      .map((c) => ({
        ...c,
        // For units view, backend already exposes attr-keyed fields (e.g. price_czk),
        // which are exactly what UnitOverride expects.
        overrideField: c.key,
      }));

    if (process.env.NODE_ENV === "development" && debugMode && columnsState.data.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        "[UnitDetail] columns loaded:",
        columnsState.data.length,
        "editable unit overrideable:",
        cols.length,
        "sample:",
        columnsState.data[0]
      );
    }

    return cols;
  }, [columnsState.data, debugMode]);

  const handleStartEdit = () => {
    if (!unit) return;
    const nextDraft: Record<string, unknown> = {};
    editableColumns.forEach((col) => {
      const field = col.overrideField;
      if (field in unit) {
        const val = unit[field];
        if (col.data_type === "bool") {
          nextDraft[field] = parseBool(val);
        } else {
          nextDraft[field] = val ?? "";
        }
      }
    });
    setDraftValues(nextDraft);
    setEditMode(true);
  };

  const handleCancel = () => {
    setEditMode(false);
    setDraftValues({});
    if (originalUnit) {
      setUnitState((prev) => ({ ...prev, data: originalUnit }));
    }
  };

  const handleChangeDraft = (field: string, value: unknown) => {
    setDraftValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!unit || !originalUnit || !external_id) return;
    setSaving(true);
    let current: UnitDetail = unit;
    const id = decodeURIComponent(external_id);
    try {
      const changedColumns = editableColumns.filter((col) => {
        const field = col.overrideField;
        if (!(field in draftValues)) return false;
        const nextVal = draftValues[field];
        const prevVal = originalUnit[field];
        return String(nextVal ?? "") !== String(prevVal ?? "");
      });

      for (const col of changedColumns) {
        const field = col.overrideField;
        const rawVal = draftValues[field];
        const payloadValue =
          rawVal === undefined || rawVal === null
            ? ""
            : col.data_type === "bool"
              ? String(!!rawVal)
              : String(rawVal);

        const res = await fetch(
          `${API_BASE}/units/${encodeURIComponent(id)}/overrides/${encodeURIComponent(field)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: payloadValue }),
          }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Failed to save unit override for ${field}`);
        }
        const updated = (await res.json()) as UnitDetail;
        current = updated;
      }

      setUnitState((prev) => ({ ...prev, data: current }));
      setOriginalUnit(current);
      setEditMode(false);
      setDraftValues({});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chyba při ukládání";
      setUnitState((prev) => ({ ...prev, error: msg }));
    } finally {
      setSaving(false);
    }
  };

  if (unitState.loading) return <div className="p-4">Načítání…</div>;
  if (unitState.error) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-red-600">
          {unitState.error === "Unit not found" ? "Jednotka nenalezena." : `Chyba: ${unitState.error}`}
        </div>
        {debugMode && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
            <div className="mb-1 font-semibold">Debug</div>
            <p>API_BASE: {API_BASE}</p>
            <p>external_id: {external_id}</p>
            <ul className="mt-1 space-y-1">
              {debugLogs.map((log, idx) => (
                <li key={`${log.label}-${idx}`}>
                  <div>
                    <span className="font-semibold">{log.label}</span>: {log.url}
                  </div>
                  {!log.ok && (
                    <div className="ml-2">
                      {log.status && (
                        <span>
                          status {log.status} {log.statusText ?? ""}
                        </span>
                      )}
                      {log.errorMessage && <div>error: {log.errorMessage}</div>}
                      {log.bodySnippet && (
                        <div className="truncate">body: {log.bodySnippet}</div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (!unit) return null;

  const chartData = history
    .filter((e) => e.price_czk != null)
    .map((e) => ({
      captured_at: new Date(e.captured_at).toLocaleDateString("cs-CZ", {
        month: "short",
        day: "numeric",
        year: "2-digit",
      }),
      price_czk: e.price_czk,
    }))
    .reverse();

  const allColumns = columnsState.data ?? [];
  const hasGps =
    (unit.project as { gps_latitude?: number | null; gps_longitude?: number | null })?.gps_latitude != null &&
    (unit.project as { gps_latitude?: number | null; gps_longitude?: number | null })?.gps_longitude != null;
  const gpsLat = (unit.project as { gps_latitude?: number | null })?.gps_latitude as number | undefined;
  const gpsLng = (unit.project as { gps_longitude?: number | null })?.gps_longitude as number | undefined;

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
            <h1 className="text-lg font-semibold text-slate-900">
              {unit.unit_name ?? unit.external_id}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {!editMode ? (
              <button
                type="button"
                onClick={handleStartEdit}
                disabled={saving}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Editovat
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
        {/* Hlavní přehled */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Přehled
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Projekt</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {unit.project?.name ?? "—"}
                {unit.project_id ? (
                  <Link
                    href={`/projects/${unit.project_id}`}
                    className="ml-2 text-sm text-slate-600 underline hover:text-slate-900"
                  >
                    Upravit projekt
                  </Link>
                ) : null}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Dispozice</p>
              <p className="mt-0.5 font-medium text-slate-900">{formatLayout(unit.layout)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Podlahová plocha</p>
              <p className="mt-0.5 font-medium text-slate-900">{formatAreaM2(unit.floor_area_m2)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Cena</p>
              <p className="mt-0.5 font-medium text-slate-900">{formatCurrencyCzk(unit.price_czk)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Cena za m²</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatCurrencyCzk(unit.price_per_m2_czk)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Dostupnost</p>
              <p
                className={`mt-0.5 font-medium ${unit.available ? "text-green-600" : "text-red-600"}`}
              >
                {unit.available ? "ANO" : "NE"}
              </p>
            </div>
          </div>
        </section>

        {/* Odkazy na nabídku a web projektu */}
        {(() => {
          const unitUrl =
            (unit as { url?: string }).url ?? (unit.data?.unit_url as string | undefined);
          let projectUrl: string | undefined;
          const raw = unitUrl ?? (unit.data?.unit_url as string | undefined);
          if (raw && typeof raw === "string") {
            try {
              const parsed = new URL(raw);
              projectUrl = `${parsed.protocol}//${parsed.host}`;
            } catch {
              const i = raw.indexOf(".cz/");
              if (i !== -1) projectUrl = raw.slice(0, i + 3);
            }
          }
          if (!unitUrl && !projectUrl) return null;
          return (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Odkazy
              </h2>
              <div className="flex flex-wrap gap-3">
                {unitUrl && (
                  <a
                    href={unitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800 no-underline shadow-sm transition hover:bg-slate-100 hover:border-slate-300"
                  >
                    <span aria-hidden>↗</span>
                    Otevřít nabídku jednotky
                  </a>
                )}
                {projectUrl && (
                  <a
                    href={projectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800 no-underline shadow-sm transition hover:bg-slate-100 hover:border-slate-300"
                  >
                    <span aria-hidden>↗</span>
                    Otevřít web projektu
                  </a>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Fotografie a další detaily nabídky uvidíte po otevření odkazu na nabídku jednotky.
              </p>
            </section>
          );
        })()}

        {/* Všechna data jednotky */}
        {allColumns.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Všechna data jednotky
            </h2>
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {allColumns.map((col) => {
                const raw = getUnitDisplayValue(unit, col);
                if (raw === undefined && col.key !== "project_url") return null;
                const formatted = formatDisplayValue(raw, col);
                const isLink =
                  (col.key === "unit_url" || col.key === "project_url") &&
                  typeof raw === "string" &&
                  /^https?:\/\//i.test(raw);
                return (
                  <div key={col.key} className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-500">{col.label}</p>
                    {isLink ? (
                      <a
                        href={raw}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 block truncate text-sm font-medium text-slate-900 underline decoration-slate-400 underline-offset-2 hover:text-slate-700 hover:decoration-slate-600"
                      >
                        {formatted}
                      </a>
                    ) : (
                      <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{formatted}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Mapa */}
        {hasGps && gpsLat != null && gpsLng != null && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Poloha
            </h2>
            <UnitDetailMap
              lat={gpsLat}
              lng={gpsLng}
              label={[unit.project?.name, unit.unit_name ?? unit.external_id].filter(Boolean).join(" – ")}
            />
          </section>
        )}

        {/* Upravitelné údaje */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Upravitelné údaje
          </h2>
          {debugMode && (
            <div className="mb-3 space-y-1 text-xs text-slate-500">
              <p>
                Sloupců: {columnsState.data?.length ?? 0}, upravitelných: {editableColumns.length}
              </p>
            </div>
          )}
          {columnsState.loading ? (
            <p className="text-sm text-slate-600">Načítání sloupců…</p>
          ) : editableColumns.length === 0 ? (
            <p className="text-sm text-slate-600">Žádná upravitelná pole.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-700">Pole</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-700">Hodnota</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {editableColumns.map((col) => {
                    const field = col.overrideField;
                    if (!(field in unit)) return null;
                    const currentValue = unit[field];
                    const draftValue = draftValues[field];

                    return (
                      <tr key={col.key}>
                        <td className="px-4 py-2.5 align-top font-medium text-slate-800">
                          {col.label}
                        </td>
                        <td className="px-4 py-2.5">
                          {!editMode ? (
                            (() => {
                              const formatted = formatDisplayValue(currentValue, col);
                              const linkUrl =
                                (col.key === "unit_url" || col.key === "project_url") &&
                                getUnitDisplayValue(unit, col);
                              if (
                                typeof linkUrl === "string" &&
                                /^https?:\/\//i.test(linkUrl)
                              ) {
                                return (
                                  <a
                                    href={linkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-slate-900 underline decoration-slate-400 underline-offset-2 hover:text-slate-700"
                                  >
                                    {formatted}
                                  </a>
                                );
                              }
                              return <span className="text-slate-900">{formatted}</span>;
                            })()
                          ) : col.data_type === "bool" ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              checked={parseBool(draftValue)}
                              onChange={(e) => handleChangeDraft(field, e.target.checked)}
                            />
                          ) : col.data_type === "number" ? (
                            <input
                              type="number"
                              className="max-w-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
                              value={draftValue ?? ""}
                              onChange={(e) => handleChangeDraft(field, e.target.value)}
                            />
                          ) : (
                            <input
                              type="text"
                              className="max-w-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
                              value={(draftValue as string | undefined) ?? ""}
                              onChange={(e) => handleChangeDraft(field, e.target.value)}
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

        {/* Historie ceny */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Historie ceny
          </h2>
          <div className="h-72 w-full">
            {chartData.length === 0 ? (
              <p className="text-sm text-slate-500">Žádná historie cen.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: 10, bottom: 30 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="captured_at"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickMargin={8}
                  />
                  <YAxis
                    tickFormatter={(v) =>
                      Number.isFinite(v)
                        ? `${(Number(v) / 1_000_000).toFixed(1)} mil. Kč`
                        : ""
                    }
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    width={56}
                    tickMargin={4}
                  />
                  <Tooltip
                    formatter={(v) => [formatCurrencyCzk(v as number), "Cena"]}
                    contentStyle={{ fontSize: "12px" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="price_czk"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

