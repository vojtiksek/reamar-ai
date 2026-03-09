"use client";

import {
  formatAreaM2,
  formatCurrencyCzk,
  formatCurrencyPerM2,
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

type PendingApiUpdate = { field: string; api_value: string };

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
  original_price_czk?: number | null;
  original_price_per_m2_czk?: number | null;
  equivalent_area_m2?: number | null;
  exterior_area_m2?: number | null;
  data?: Record<string, unknown>;
  pending_api_updates?: PendingApiUpdate[];
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

/** Pole zobrazená v boxu „Data o projektu“. První skupina je na úrovni jednotky (UNITS), zbytek z projektu/agregátů. */
const PROJECT_OVERVIEW_FIELDS: Array<{ key: string; label: string; accessor: string; data_type: string; display_format?: string }> = [
  // Z tabulky UNITS (jednotka) – topení, klimatizace atd. jsou u jednotky
  { key: "heating", label: "Topení", accessor: "heating", data_type: "text" },
  { key: "air_conditioning", label: "Klimatizace", accessor: "air_conditioning", data_type: "boolean" },
  { key: "cooling_ceilings", label: "Chlazení stropem", accessor: "cooling_ceilings", data_type: "boolean" },
  { key: "exterior_blinds", label: "Žaluzie", accessor: "exterior_blinds", data_type: "text" },
  { key: "smart_home", label: "Smart home", accessor: "smart_home", data_type: "boolean" },
  // Podlaha – ze standardů projektu (Project.floors)
  { key: "floors", label: "Podlaha", accessor: "project.floors", data_type: "text" },
  // URL projektu (odvozená z unit URL)
  { key: "project_url", label: "URL projektu", accessor: "project.project_url", data_type: "text" },
  // Z projektu (nebo unit.data po doplnění agregátů na backendu)
  { key: "project.ride_to_center_min", label: "Autem do centra", accessor: "project.ride_to_center_min", data_type: "number", display_format: "duration_minutes" },
  { key: "project.public_transport_to_center_min", label: "MHD do centra", accessor: "project.public_transport_to_center_min", data_type: "number", display_format: "duration_minutes" },
  { key: "total_units", label: "Počet jednotek", accessor: "total_units", data_type: "number" },
  { key: "available_units", label: "Dostupných jednotek", accessor: "available_units", data_type: "number" },
  { key: "availability_ratio", label: "Podíl dostupných", accessor: "availability_ratio", data_type: "number", display_format: "percent" },
  { key: "project_first_seen", label: "First seen", accessor: "project_first_seen", data_type: "date" },
  { key: "max_days_on_market", label: "Dní na trhu", accessor: "max_days_on_market", data_type: "number", display_format: "duration_days" },
];

const UnitDetailMap = dynamic(() => import("./UnitDetailMap"), { ssr: false });

/** Možnosti stavu jednotky (stejné jako ve filtrech). */
const AVAILABILITY_STATUS_OPTIONS = [
  { value: "available", label: "Dostupná" },
  { value: "reserved", label: "Rezervovaná" },
  { value: "sold", label: "Prodaná" },
  { value: "unseen", label: "Neviditelná" },
] as const;

const PENDING_FIELD_LABELS: Record<string, string> = {
  price_czk: "Cena",
  price_per_m2_czk: "Cena za m²",
  availability_status: "Stav",
};

function formatPendingApiValue(field: string, apiValue: string): string {
  if (field === "price_czk") {
    const n = Number(apiValue);
    if (Number.isFinite(n)) return formatCurrencyCzk(n);
  }
  if (field === "price_per_m2_czk") {
    const n = Number(apiValue);
    if (Number.isFinite(n)) return formatCurrencyPerM2(n);
  }
  if (field === "availability_status") {
    const opt = AVAILABILITY_STATUS_OPTIONS.find((o) => o.value === (apiValue || "").toLowerCase());
    return opt?.label ?? (apiValue || "—");
  }
  return apiValue || "—";
}

const ORIENTATION_LETTERS = ["N", "E", "S", "W"] as const;

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
  let fromData: unknown = undefined;
  if (unit.data) {
    if (col.key && col.key in unit.data) {
      fromData = unit.data[col.key];
    } else {
      const keyWithoutProjectPrefix =
        col.key && col.key.startsWith("project.") ? col.key.slice("project.".length) : undefined;
      const accessorWithoutProjectPrefix = accessor.startsWith("project.")
        ? accessor.slice("project.".length)
        : undefined;
      if (keyWithoutProjectPrefix && keyWithoutProjectPrefix in unit.data) {
        fromData = unit.data[keyWithoutProjectPrefix];
      } else if (accessorWithoutProjectPrefix && accessorWithoutProjectPrefix in unit.data) {
        fromData = unit.data[accessorWithoutProjectPrefix];
      }
    }
  }
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
  const [resolvingField, setResolvingField] = useState<string | null>(null);
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
        // API expects "url", catalog key is "unit_url".
        overrideField: c.key === "unit_url" ? "url" : c.key,
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

  const allColumns = columnsState.data ?? [];
  const { projectColumns, unitColumns } = useMemo(() => {
    const list = allColumns;
    const project = list.filter(
      (c) =>
        c.entity === "project" ||
        (c.key && c.key.startsWith("project.")) ||
        (c.accessor && String(c.accessor).startsWith("project."))
    );
    const unit = list.filter((c) => !project.includes(c));
    return { projectColumns: project, unitColumns: unit };
  }, [allColumns]);

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

  const handleAcceptApi = async (field: string) => {
    if (!external_id) return;
    setResolvingField(field);
    const id = decodeURIComponent(external_id);
    try {
      const res = await fetch(
        `${API_BASE}/units/${encodeURIComponent(id)}/accept-api`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field }) }
      );
      if (!res.ok) throw new Error(await res.text());
      const u = (await res.json()) as UnitDetail;
      setUnitState((prev) => ({ ...prev, data: u, error: null }));
      setOriginalUnit(u);
    } catch (e) {
      setUnitState((prev) => ({ ...prev, error: e instanceof Error ? e.message : "Chyba" }));
    } finally {
      setResolvingField(null);
    }
  };

  const handleDismissApi = async (field: string) => {
    if (!external_id) return;
    setResolvingField(field);
    const id = decodeURIComponent(external_id);
    try {
      const res = await fetch(
        `${API_BASE}/units/${encodeURIComponent(id)}/dismiss-api`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field }) }
      );
      if (!res.ok) throw new Error(await res.text());
      const u = (await res.json()) as UnitDetail;
      setUnitState((prev) => ({ ...prev, data: u, error: null }));
      setOriginalUnit(u);
    } catch (e) {
      setUnitState((prev) => ({ ...prev, error: e instanceof Error ? e.message : "Chyba" }));
    } finally {
      setResolvingField(null);
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

  const hasGps =
    (unit.project as { gps_latitude?: number | null; gps_longitude?: number | null })?.gps_latitude != null &&
    (unit.project as { gps_latitude?: number | null; gps_longitude?: number | null })?.gps_longitude != null;
  const gpsLat = (unit.project as { gps_latitude?: number | null })?.gps_latitude as number | undefined;
  const gpsLng = (unit.project as { gps_longitude?: number | null })?.gps_longitude as number | undefined;

  const getOverviewColumnByKey = (key: string): UnitColumn | undefined =>
    (PROJECT_OVERVIEW_FIELDS as UnitColumn[]).find((c) => c.key === key) ??
    projectColumns.find((c) => c.key === key);

  const findProjectStatColumn = (baseKey: string): UnitColumn | undefined => {
    // Nejprve zkusíme explicitně definovaná pole v PROJECT_OVERVIEW_FIELDS
    const fromOverview = getOverviewColumnByKey(baseKey);
    if (fromOverview) return fromOverview;
    // Pak sloupce z /columns (projectColumns) – mohou mít prefix "project." nebo ne
    return (
      projectColumns.find(
        (c) =>
          c.key === baseKey ||
          c.key === `project.${baseKey}` ||
          c.accessor === baseKey ||
          c.accessor === `project.${baseKey}`
      ) ?? undefined
    );
  };

  const overviewStandards: UnitColumn[] = [
    "heating",
    "air_conditioning",
    "cooling_ceilings",
    "exterior_blinds",
    "smart_home",
    "floors",
    "overall_quality",
    "windows",
    "partition_walls",
  ]
    .map(getOverviewColumnByKey)
    .filter(Boolean) as UnitColumn[];

  const overviewFinanceParking: UnitColumn[] = [
    "payment_contract",
    "payment_construction",
    "payment_occupancy",
    "min_parking_outdoor_price_czk",
    "min_parking_indoor_price_czk",
  ]
    .map((key) =>
      projectColumns.find(
        (c) => c.key === key || c.accessor === `project.${key}` || c.accessor === key
      )
    )
    .filter(Boolean) as UnitColumn[];

  const overviewUnitsStats: UnitColumn[] = [
    findProjectStatColumn("total_units"),
    findProjectStatColumn("available_units"),
    findProjectStatColumn("availability_ratio"),
    findProjectStatColumn("project_first_seen"),
    findProjectStatColumn("max_days_on_market"),
    findProjectStatColumn("avg_price_czk"),
    findProjectStatColumn("avg_price_per_m2_czk"),
    findProjectStatColumn("min_price_czk"),
    findProjectStatColumn("max_price_czk"),
    findProjectStatColumn("avg_floor_area_m2"),
    findProjectStatColumn("project_last_seen"),
    findProjectStatColumn("sold_date"),
  ].filter(Boolean) as UnitColumn[];

  const overviewLocation: UnitColumn[] = [
    // Obec, katastr, adresa z data/projectColumns (pokud existují)
    projectColumns.find((c) => c.key === "municipality" || c.accessor === "project.municipality"),
    projectColumns.find(
      (c) =>
        c.key === "cadastral_area_iga" || c.accessor === "project.cadastral_area_iga"
    ),
    projectColumns.find((c) => c.key === "address" || c.accessor === "project.address"),
    getOverviewColumnByKey("project.ride_to_center_min"),
    getOverviewColumnByKey("project.public_transport_to_center_min"),
  ].filter(Boolean) as UnitColumn[];

  const usedOverviewKeys = new Set(
    [
      ...overviewStandards,
      ...overviewFinanceParking,
      ...overviewUnitsStats,
      ...overviewLocation,
    ].map((c) => c.key)
  );

  const hiddenFromOverview = new Set<string>([
    "project.name",
    "name",
    "project",
    "developer",
    "project.developer",
    "city",
    "district",
    "municipal_district_iga",
    "administrative_district_iga",
    "region_iga",
    // Sloupce, které už máme v jiných boxech („Počet jednotek“, „Lokalita“),
    // nechceme znovu v sekci „Ostatní“.
    "total_units",
    "available_units",
    "availability_ratio",
    "project.total_units",
    "project.available_units",
    "project.availability_ratio",
    "ride_to_center_min",
    "public_transport_to_center_min",
    "project.ride_to_center_min",
    "project.public_transport_to_center_min",
    "max_days_on_market",
    "project.max_days_on_market",
    // Tyto statistiky přesouváme do boxu „Statistiky“ a nechceme je v „Ostatní“
    "avg_price_czk",
    "avg_price_per_m2_czk",
    "min_price_czk",
    "max_price_czk",
    "avg_floor_area_m2",
    "project_first_seen",
    "project_last_seen",
    "sold_date",
    "project.avg_price_czk",
    "project.avg_price_per_m2_czk",
    "project.min_price_czk",
    "project.max_price_czk",
    "project.avg_floor_area_m2",
    "project.project_first_seen",
    "project.project_last_seen",
    "project.sold_date",
  ]);

  const hiddenOverviewLabels = new Set<string>([
    "Autem do centra",
    "MHD do centra",
    "Dní na trhu",
  ]);

  const otherOverviewColumns: UnitColumn[] = [
    ...(PROJECT_OVERVIEW_FIELDS as UnitColumn[]),
    ...projectColumns.filter(
      (col) =>
        !(PROJECT_OVERVIEW_FIELDS as UnitColumn[]).some(
          (f) => f.key === col.key || f.accessor === col.accessor
        )
    ),
  ].filter((col) => {
    if (usedOverviewKeys.has(col.key)) return false;
    if (hiddenFromOverview.has(col.key)) return false;
    if (col.accessor && hiddenFromOverview.has(String(col.accessor))) return false;
    if (hiddenOverviewLabels.has(col.label)) return false;
    return true;
  });

  const renderProjectField = (col: UnitColumn) => {
    const raw = getUnitDisplayValue(unit, col);
    const formatted = formatDisplayValue(raw, col);
    const isLink =
      (col.key === "project_url" || col.key === "unit_url" || col.accessor === "project.project_url") &&
      typeof raw === "string" &&
      /^https?:\/\//i.test(raw);
    return (
      <div key={col.key} className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-500">{col.label}</p>
        {isLink ? (
          <a
            href={raw as string}
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
  };

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
        {unit.pending_api_updates && unit.pending_api_updates.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-800">
              API poslalo nové údaje
            </h2>
            <p className="mb-3 text-sm text-amber-900">
              U následujících polí přišly z API jiné hodnoty než aktuálně zobrazené. Zvolte, zda použít data z API, nebo ponechat stávající (ručně zadané).
            </p>
            <ul className="space-y-3">
              {unit.pending_api_updates.map((p) => (
                <li
                  key={p.field}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
                >
                  <span className="font-medium text-slate-700">
                    {PENDING_FIELD_LABELS[p.field] ?? p.field}:
                  </span>
                  <span className="text-slate-600">
                    API: {formatPendingApiValue(p.field, p.api_value)}
                  </span>
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleAcceptApi(p.field)}
                      disabled={resolvingField !== null}
                      className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {resolvingField === p.field ? "…" : "Použít API"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDismissApi(p.field)}
                      disabled={resolvingField !== null}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {resolvingField === p.field ? "…" : "Ponechat moje"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Řádek: Přehled + Mapa vedle sebe */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Přehled
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-500">Projekt</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {unit.project_id ? (
                    <Link
                      href={`/projects/${unit.project_id}`}
                      className="text-slate-900 underline hover:text-slate-700"
                    >
                      {unit.project?.name ?? "—"}
                    </Link>
                  ) : (
                    unit.project?.name ?? "—"
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Developer</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {(unit as { developer?: string | null }).developer ??
                    (unit.project as { developer?: string | null })?.developer ??
                    "—"}
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
                <p className="text-xs font-medium text-slate-500">Venek</p>
                <p className="mt-0.5 font-medium text-slate-900">{formatAreaM2(unit.exterior_area_m2)}</p>
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
                <p className="text-xs font-medium text-slate-500">Původní cena</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(unit.original_price_czk ?? null)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Původní cena m²</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(unit.original_price_per_m2_czk ?? null)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Dostupnost</p>
                <p className={`mt-0.5 font-medium ${(() => {
                  const s = String(unit.availability_status ?? "").toLowerCase();
                  if (s === "sold" || s === "prodané") return "text-red-600";
                  if (s === "reserved" || s === "rezervované") return "text-amber-600";
                  if (s === "available" || s === "volné") return "text-emerald-600";
                  return "text-slate-700";
                })()}`}>
                  {(() => {
                    const s = String(unit.availability_status ?? "").toLowerCase();
                    if (s === "available" || s === "volné") return "Volná";
                    if (s === "reserved" || s === "rezervované") return "Rezervovaná";
                    if (s === "sold" || s === "prodané") return "Prodaná";
                    if (s === "unseen") return "Nezobrazovaná";
                    return unit.available ? "Volná" : "—";
                  })()}
                </p>
              </div>
            </div>
          </section>

          {/* Mapa na stejném řádku jako přehled */}
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
        </div>

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

        {/* Data o projektu */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Data o projektu
          </h2>
          <div className="space-y-4">
            {overviewStandards.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Standardy
                </h3>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {overviewStandards.map(renderProjectField)}
                </div>
              </div>
            )}
            {overviewFinanceParking.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Financování a parkování
                </h3>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {overviewFinanceParking.map(renderProjectField)}
                </div>
              </div>
            )}
            {overviewUnitsStats.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Statistiky
                </h3>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {overviewUnitsStats.map(renderProjectField)}
                </div>
              </div>
            )}
            {overviewLocation.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Lokalita
                </h3>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {overviewLocation.map(renderProjectField)}
                </div>
              </div>
            )}
            {otherOverviewColumns.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Ostatní
                </h3>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {otherOverviewColumns.map(renderProjectField)}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Data o jednotce – zobrazení a při „Editovat“ inline úprava editovatelných polí */}
        {unitColumns.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Data o jednotce
            </h2>
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {unitColumns
                .filter(
                  (col) =>
                    !["heating", "air_conditioning", "cooling_ceilings", "exterior_blinds", "smart_home"].includes(
                      col.key
                    )
                )
                .map((col) => {
                const overrideField = col.key === "unit_url" ? "url" : col.key;
                const editableCol = editableColumns.find(
                  (ec) => ec.key === col.key || ec.overrideField === overrideField
                );
                const raw = getUnitDisplayValue(unit, col);
                if (raw === undefined && col.key !== "project_url" && col.key !== "unit_url") return null;
                const formatted = formatDisplayValue(raw, col);
                const isLink =
                  (col.key === "unit_url" || col.key === "project_url") &&
                  typeof raw === "string" &&
                  /^https?:\/\//i.test(raw);
                const canEdit = editMode && editableCol;
                const draftVal = editableCol ? draftValues[editableCol.overrideField] : undefined;
                const displayVal = canEdit && draftVal !== undefined ? draftVal : raw;

                return (
                  <div key={col.key} className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-500">{col.label}</p>
                    {canEdit ? (
                      editableCol.data_type === "bool" ? (
                        <label className="mt-0.5 flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300"
                            checked={parseBool(draftVal)}
                            onChange={(e) => handleChangeDraft(editableCol.overrideField, e.target.checked)}
                          />
                          <span className="text-sm text-slate-900">{parseBool(draftVal) ? "Ano" : "Ne"}</span>
                        </label>
                      ) : editableCol.key === "availability_status" ? (
                        <select
                          className="mt-0.5 w-full max-w-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
                          value={(draftVal as string | undefined) ?? ""}
                          onChange={(e) => handleChangeDraft(editableCol.overrideField, e.target.value)}
                        >
                          <option value="">—</option>
                          {AVAILABILITY_STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : editableCol.key === "floor" ? (
                        <input
                          type="number"
                          step={1}
                          min={0}
                          className="mt-0.5 w-full max-w-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
                          value={draftVal !== undefined && draftVal !== null && draftVal !== "" ? String(Math.floor(Number(draftVal))) : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") {
                              handleChangeDraft(editableCol.overrideField, "");
                              return;
                            }
                            const n = parseInt(v, 10);
                            if (!Number.isNaN(n) && n >= 0) handleChangeDraft(editableCol.overrideField, n);
                          }}
                        />
                      ) : editableCol.key === "orientation" ? (
                        <div className="mt-0.5 flex flex-wrap gap-3">
                          {ORIENTATION_LETTERS.map((letter) => {
                            const currentStr = (draftVal as string | undefined) ?? (raw as string) ?? "";
                            const selected = currentStr
                              .split(/[,;\s]+/)
                              .map((s) => s.trim().toUpperCase())
                              .filter(Boolean);
                            const checked = selected.includes(letter);
                            return (
                              <label key={letter} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-900">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300"
                                  checked={checked}
                                  onChange={() => {
                                    const nextRaw = checked
                                      ? selected.filter((x) => x !== letter)
                                      : [...selected.filter((x) => ORIENTATION_LETTERS.includes(x as "N" | "E" | "S" | "W")), letter];
                                    const next = [...new Set(nextRaw)].sort(
                                      (a, b) =>
                                        ORIENTATION_LETTERS.indexOf(a as "N" | "E" | "S" | "W") -
                                        ORIENTATION_LETTERS.indexOf(b as "N" | "E" | "S" | "W")
                                    );
                                    handleChangeDraft(editableCol.overrideField, next.join(","));
                                  }}
                                />
                                {letter}
                              </label>
                            );
                          })}
                        </div>
                      ) : editableCol.data_type === "number" ? (
                        <input
                          type="number"
                          className="mt-0.5 w-full max-w-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
                          value={draftVal ?? ""}
                          onChange={(e) => handleChangeDraft(editableCol.overrideField, e.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          className="mt-0.5 w-full max-w-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
                          value={(draftVal as string | undefined) ?? ""}
                          onChange={(e) => handleChangeDraft(editableCol.overrideField, e.target.value)}
                        />
                      )
                    ) : isLink ? (
                      <a
                        href={raw as string}
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

