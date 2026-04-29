"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function FutureProjectsImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFileChange = useCallback((f: File | null) => {
    setFile(f);
    setError(null);
    setResult(null);
  }, []);

  const submit = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/future-projects/import-csv`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const body = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
      }
      const json = JSON.parse(body) as ImportResult;
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import selhal");
    } finally {
      setLoading(false);
    }
  }, [file]);

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
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            Import budoucích projektů z CSV
          </h2>
          <p className="text-sm text-slate-500">
            Nahraj CSV — backend si rozpozná sloupce, nové projekty založí, existující
            (podle jména) aktualizuje. Prázdné buňky stávající hodnoty nepřepíší.
          </p>
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
            onClick={() => void submit()}
            disabled={!file || loading}
          >
            {loading ? "Importuji…" : "Nahrát a zpracovat"}
          </ReamarButton>
          <p className="text-xs text-slate-500">
            Rozpoznané sloupce: <code>project / name</code>, <code>developer</code>,{" "}
            <code>address</code>, <code>city</code>, <code>region</code>,{" "}
            <code>stage</code>, <code>total_number_of_units</code>,{" "}
            <code>date_sale_start</code>, <code>construction_completion</code>,{" "}
            <code>type</code>, <code>url</code>, <code>renovation</code>,{" "}
            <code>gps_latitude</code>, <code>gps_longitude</code>,{" "}
            <code>municipal_district</code>. Vše ostatní (např.{" "}
            <code>price_with_vat</code>, <code>standards_rating</code>) se uloží do{" "}
            <code>public_data_json</code> pod původním názvem sloupce.
          </p>
        </div>
      </ReamarCard>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {result && (
        <ReamarCard className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Výsledek importu</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            <li>
              Vytvořeno nových: <strong className="text-emerald-700">{result.created}</strong>
            </li>
            <li>
              Aktualizováno existujících:{" "}
              <strong className="text-sky-700">{result.updated}</strong>
            </li>
            <li>
              Přeskočeno (prázdný název):{" "}
              <strong className="text-slate-600">{result.skipped}</strong>
            </li>
          </ul>
          {result.errors.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                Chyby ({result.errors.length})
              </h4>
              <ul className="mt-1 max-h-60 overflow-auto rounded bg-rose-50 p-2 text-xs text-rose-900">
                {result.errors.slice(0, 100).map((err, i) => (
                  <li key={i} className="font-mono">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Link href="/admin/future-projects">
              <ReamarButton variant="secondary">Zpět na seznam</ReamarButton>
            </Link>
            <ReamarButton
              variant="primary"
              onClick={() => {
                setFile(null);
                setResult(null);
              }}
            >
              Nahrát další soubor
            </ReamarButton>
          </div>
        </ReamarCard>
      )}
    </div>
  );
}
