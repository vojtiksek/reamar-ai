"use client";

import { formatAreaM2, formatCurrencyCzk, formatLayout } from "@/lib/format";
import { isEditableCatalogColumn } from "@/lib/columns";
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

const API = "http://127.0.0.1:8001";

type UnitDetail = {
  external_id: string;
  project: { name: string };
  unit_name: string | null;
  layout: string | null;
  floor_area_m2: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  available: boolean;
  availability_status?: string | null;
  equivalent_area_m2?: number | null;
  exterior_area_m2?: number | null;
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
};

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type EditableUnitColumn = UnitColumn & { overrideField: string };

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

  useEffect(() => {
    if (!external_id) return;
    const id = decodeURIComponent(external_id);

    setUnitState({ data: null, loading: true, error: null });
    setColumnsState({ data: null, loading: true, error: null });

    Promise.all([
      fetch(`${API}/units/${encodeURIComponent(id)}`).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(res.statusText))
      ),
      fetch(`${API}/units/${encodeURIComponent(id)}/price-history`).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(res.statusText))
      ),
      fetch(`${API}/columns?view=units`).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(res.statusText))
      ),
    ])
      .then(([u, h, cols]) => {
        setUnitState({ data: u as UnitDetail, loading: false, error: null });
        setOriginalUnit(u as UnitDetail);
        setHistory(Array.isArray(h) ? h : []);
        setColumnsState({
          data: Array.isArray(cols) ? (cols as UnitColumn[]) : [],
          loading: false,
          error: null,
        });
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Chyba";
        setUnitState({ data: null, loading: false, error: msg });
        setColumnsState({ data: null, loading: false, error: msg });
      });
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
          `${API}/units/${encodeURIComponent(id)}/overrides/${encodeURIComponent(field)}`,
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
  if (unitState.error) return <div className="p-4 text-red-600">Chyba: {unitState.error}</div>;
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

  return (
    <div className="p-4">
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-4 text-sm text-gray-600 underline hover:text-gray-800"
      >
        ← Zpět
      </button>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{unit.unit_name ?? unit.external_id}</h1>
        <div className="flex items-center gap-2">
          {!editMode ? (
            <button
              type="button"
              onClick={handleStartEdit}
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Editovat
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
      <dl className="mb-6 grid gap-2 text-sm">
        <div>
          <dt className="font-medium text-gray-500">Projekt</dt>
          <dd>{unit.project?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Název jednotky</dt>
          <dd>{unit.unit_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Dispozice</dt>
          <dd>{formatLayout(unit.layout)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Podlahová plocha</dt>
          <dd>{formatAreaM2(unit.floor_area_m2)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Cena</dt>
          <dd>{formatCurrencyCzk(unit.price_czk)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Cena za m²</dt>
          <dd>{formatCurrencyCzk(unit.price_per_m2_czk)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Dostupnost</dt>
          <dd className={unit.available ? "text-green-600" : "text-red-600"}>
            {unit.available ? "ANO" : "NE"}
          </dd>
        </div>
      </dl>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">Upravitelné údaje</h2>
        {debugMode && (
          <div className="mb-3 space-y-1 text-xs text-gray-500">
            <p>
              Loaded columns: {columnsState.data?.length ?? 0}, editable: {editableColumns.length}
            </p>
            <p>Unit keys: {unit ? Object.keys(unit).slice(0, 20).join(", ") : "—"}</p>
            <p>
              Sample columns:{" "}
              {columnsState.data
                ?.slice(0, 10)
                .map((c) => `${c.key}${unit && c.key in unit ? "✓" : "✗"}`)
                .join(", ") || "—"}
            </p>
          </div>
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
                  const field = col.overrideField;
                  if (!(field in unit)) return null;
                  const currentValue = unit[field];
                  const draftValue = draftValues[field];

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
                            onChange={(e) => handleChangeDraft(field, e.target.checked)}
                          />
                        ) : col.data_type === "number" ? (
                          <input
                            type="number"
                            className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
                            value={draftValue ?? ""}
                            onChange={(e) => handleChangeDraft(field, e.target.value)}
                          />
                        ) : (
                          <input
                            type="text"
                            className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
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

      <h2 className="mb-2 text-lg font-medium">Historie ceny</h2>
      <div className="h-80 w-full max-w-2xl">
        {chartData.length === 0 ? (
          <p className="text-gray-500">Žádná historie cen.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="captured_at" />
              <YAxis tickFormatter={(v) => formatCurrencyCzk(v)} />
              <Tooltip formatter={(v) => [formatCurrencyCzk(v as number), "Cena"]} />
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
    </div>
  );
}

