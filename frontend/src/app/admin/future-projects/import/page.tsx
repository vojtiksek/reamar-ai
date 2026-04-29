"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

type PreviewResponse = {
  headers: string[];
  sample_rows: string[][];
  total_rows: number;
};

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

const CORE_FIELDS = [
  "name",
  "developer",
  "address",
  "city",
  "municipal_district",
  "region",
  "stage",
  "total_units",
  "date_sale_start",
  "construction_completion",
  "project_type",
  "url",
  "renovation",
  "gps_latitude",
  "gps_longitude",
];

const SKIP = "__skip__";

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function suggestTarget(header: string): string {
  const h = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates: Record<string, string> = {
    name: "name",
    nazev: "name",
    název: "name",
    developer: "developer",
    address: "address",
    adresa: "address",
    city: "city",
    mesto: "city",
    region: "region",
    stage: "stage",
    faze: "stage",
    fáze: "stage",
    totalunits: "total_units",
    pocetjednotek: "total_units",
    pocet: "total_units",
    datesalestart: "date_sale_start",
    salestart: "date_sale_start",
    construction: "construction_completion",
    completion: "construction_completion",
    dokonceni: "construction_completion",
    type: "project_type",
    typ: "project_type",
    url: "url",
    web: "url",
    odkaz: "url",
    renovation: "renovation",
    rekonstrukce: "renovation",
    lat: "gps_latitude",
    latitude: "gps_latitude",
    gpslatitude: "gps_latitude",
    lon: "gps_longitude",
    lng: "gps_longitude",
    longitude: "gps_longitude",
    gpslongitude: "gps_longitude",
    municipaldistrict: "municipal_district",
  };
  for (const [k, v] of Object.entries(candidates)) {
    if (h === k || h.includes(k)) return v;
  }
  return SKIP;
}

export default function FutureProjectsImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFileChange = useCallback((f: File | null) => {
    setFile(f);
    setPreview(null);
    setMapping({});
    setResult(null);
    setError(null);
  }, []);

  const submitPreview = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/future-projects/import-preview`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
      }
      const json = (await res.json()) as PreviewResponse;
      setPreview(json);
      const suggested: Record<string, string> = {};
      for (const h of json.headers) suggested[h] = suggestTarget(h);
      setMapping(suggested);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Načtení preview selhalo");
    } finally {
      setLoading(false);
    }
  }, [file]);

  const targetOptions = useMemo(() => {
    const opts = [
      { value: SKIP, label: "— Přeskočit —" },
      ...CORE_FIELDS.map((f) => ({ value: f, label: `Core: ${f}` })),
    ];
    return opts;
  }, []);

  const customTargetForHeader = (header: string): string | null => {
    const m = mapping[header];
    if (!m) return null;
    if (m === SKIP || CORE_FIELDS.includes(m)) return null;
    return m; // e.g. "public_data_json.foo" or "internal_data_json.bar"
  };

  const submitImport = useCallback(async () => {
    if (!preview) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        headers: preview.headers,
        rows: preview.sample_rows, // BACKEND NOTE: sample_rows is what we have client-side; full import re-reads from upload
        mapping: preview.headers.map((h) => ({
          csv_header: h,
          target_field: mapping[h] ?? SKIP,
        })),
      };
      const res = await fetch(`${API_BASE}/future-projects/import`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${t || res.statusText}`);
      }
      const json = (await res.json()) as ImportResult;
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import selhal");
    } finally {
      setLoading(false);
    }
  }, [preview, mapping]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/future-projects"
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            ← Zpět na budoucí projekty
          </Link>
          <h2 className="text-lg font-semibold text-slate-900">Import budoucích projektů z CSV</h2>
        </div>
      </div>

      <ReamarCard className="p-4">
        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-700">CSV soubor</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
          {file && (
            <p className="text-xs text-slate-500">
              {file.name} · {(file.size / 1024).toFixed(1)} kB
            </p>
          )}
          <ReamarButton
            variant="primary"
            onClick={() => void submitPreview()}
            disabled={!file || loading}
          >
            {loading && !preview ? "Nahrávám…" : "Načíst preview"}
          </ReamarButton>
        </div>
      </ReamarCard>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {preview && (
        <ReamarCard className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Mapování sloupců ({preview.total_rows} řádků)</h3>
          <p className="mb-3 text-xs text-slate-500">
            Pro každý sloupec CSV vyber, kam ho uložit. Sloupce, které tu nemají odpovídající
            pole, můžeš poslat do <code>public_data_json.&lt;klíč&gt;</code> nebo
            <code> internal_data_json.&lt;klíč&gt;</code> — napiš to ručně.
          </p>
          <div className="space-y-2">
            {preview.headers.map((h) => {
              const custom = customTargetForHeader(h);
              return (
                <div key={h} className="flex flex-wrap items-center gap-2 text-sm">
                  <code className="min-w-[200px] rounded bg-slate-100 px-2 py-1 text-xs">{h}</code>
                  <span className="text-slate-400">→</span>
                  <select
                    value={custom ? "__custom__" : mapping[h] ?? SKIP}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__custom__") {
                        setMapping((prev) => ({
                          ...prev,
                          [h]: prev[h] && !CORE_FIELDS.includes(prev[h]) && prev[h] !== SKIP
                            ? prev[h]
                            : `public_data_json.${h.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`,
                        }));
                      } else {
                        setMapping((prev) => ({ ...prev, [h]: v }));
                      }
                    }}
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    {targetOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    <option value="__custom__">Vlastní (public_data_json / internal_data_json)</option>
                  </select>
                  {custom && (
                    <input
                      type="text"
                      value={custom}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [h]: e.target.value }))
                      }
                      placeholder="public_data_json.klíč"
                      className="min-w-[260px] rounded border border-slate-300 px-2 py-1 text-sm font-mono"
                    />
                  )}
                </div>
              );
            })}
          </div>

          <h4 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Náhled (prvních {preview.sample_rows.length} řádků)
          </h4>
          <div className="overflow-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample_rows.map((row, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {row.map((cell, j) => (
                      <td key={j} className="px-2 py-1 align-top">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <ReamarButton
              variant="primary"
              onClick={() => void submitImport()}
              disabled={loading}
            >
              {loading && preview ? "Importuji…" : `Importovat ${preview.sample_rows.length} řádků`}
            </ReamarButton>
            <p className="text-xs text-slate-500">
              Pozn.: Importuje se prvních {preview.sample_rows.length} řádků z náhledu.
              Pro celý soubor je třeba zatím použít backend endpoint přímo s celým CSV.
            </p>
          </div>
        </ReamarCard>
      )}

      {result && (
        <ReamarCard className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Výsledek importu</h3>
          <ul className="text-sm text-slate-700">
            <li>Vytvořeno: <strong>{result.created}</strong></li>
            <li>Aktualizováno: <strong>{result.updated}</strong></li>
            <li>Přeskočeno: <strong>{result.skipped}</strong></li>
          </ul>
          {result.errors.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                Chyby ({result.errors.length})
              </h4>
              <ul className="mt-1 list-inside list-disc text-xs text-rose-800">
                {result.errors.slice(0, 50).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4">
            <Link href="/admin/future-projects">
              <ReamarButton variant="secondary">Hotovo — zpět na seznam</ReamarButton>
            </Link>
          </div>
        </ReamarCard>
      )}
    </div>
  );
}
