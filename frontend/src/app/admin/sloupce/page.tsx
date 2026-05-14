"use client";

import { useEffect, useMemo, useState } from "react";

import { API_BASE } from "@/lib/api";

type ColumnDef = {
  key: string;
  label: string;
  group?: string | null;
  data_type?: string | null;
};

type Phase = "loading" | "ready" | "error";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("broker_token");
}

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AdminSloupcePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  // null = no whitelist yet (admin hasn't configured) → all columns are allowed in picker by default.
  const [hasWhitelist, setHasWhitelist] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [colsRes, allowedRes] = await Promise.all([
          fetch(`${API_BASE}/columns?view=projects`, { headers: authHeader() }),
          fetch(`${API_BASE}/admin/columns-allowed?view=projects`, { headers: authHeader() }),
        ]);
        if (!colsRes.ok) throw new Error(`columns: HTTP ${colsRes.status}`);
        if (!allowedRes.ok) throw new Error(`allowed: HTTP ${allowedRes.status}`);
        const cols = (await colsRes.json()) as ColumnDef[];
        const data = (await allowedRes.json()) as { keys?: string[] };
        const keys = Array.isArray(data.keys) ? data.keys : [];
        setColumns(Array.isArray(cols) ? cols : []);
        setAllowed(new Set(keys));
        setHasWhitelist(keys.length > 0);
        setPhase("ready");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Chyba načítání.");
        setPhase("error");
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const matches = (c: ColumnDef) =>
      !f || c.key.toLowerCase().includes(f) || c.label.toLowerCase().includes(f);
    const byGroup = new Map<string, ColumnDef[]>();
    for (const c of columns) {
      if (!matches(c)) continue;
      const g = c.group ?? "Ostatní";
      const arr = byGroup.get(g) ?? [];
      arr.push(c);
      byGroup.set(g, arr);
    }
    return Array.from(byGroup.entries()).sort((a, b) => a[0].localeCompare(b[0], "cs"));
  }, [columns, filter]);

  const toggle = (key: string) => {
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setAllVisible = (visible: boolean) => {
    if (!visible) {
      setAllowed(new Set());
      return;
    }
    setAllowed(new Set(columns.map((c) => c.key)));
  };

  const save = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const keys = columns.map((c) => c.key).filter((k) => allowed.has(k));
      const res = await fetch(`${API_BASE}/admin/columns-allowed`, {
        method: "PUT",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ view: "projects", keys }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHasWhitelist(keys.length > 0);
      setSavedAt(new Date());
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Uložení selhalo.");
    } finally {
      setSaving(false);
    }
  };

  if (phase === "loading") {
    return <p className="text-sm text-slate-500">Načítám…</p>;
  }
  if (phase === "error") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Chyba: {errorMsg}
      </div>
    );
  }

  const totalAllowed = allowed.size;
  const totalColumns = columns.length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Sloupce v Exploreru — projekty</h2>
        <p className="mt-1 text-xs text-slate-500">
          Zaškrtni sloupce, které se mají brokerovi nabízet v pickeru „Sloupce" pod tlačítkem
          akce v <code className="rounded bg-slate-100 px-1">/explorer/projects</code>. Nezaškrtnuté
          sloupce v pickeru úplně zmizí. Pokud nezaškrtneš nic, ukazují se v pickeru všechny
          (žádné omezení).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Hledat sloupec…"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => setAllVisible(true)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Zaškrtnout vše
          </button>
          <button
            type="button"
            onClick={() => setAllVisible(false)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Odškrtnout vše
          </button>
          <span className="ml-auto text-xs text-slate-500">
            Povoleno {totalAllowed} / {totalColumns}
            {!hasWhitelist && allowed.size === 0 && (
              <span className="ml-2 italic text-amber-600">(žádný filter — vše povoleno)</span>
            )}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {grouped.length === 0 && (
          <p className="text-sm text-slate-500">Žádné sloupce neodpovídají filtru.</p>
        )}
        {grouped.map(([group, cols]) => (
          <div
            key={group}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {group}
              </h3>
              <span className="text-[11px] text-slate-500">
                {cols.filter((c) => allowed.has(c.key)).length} / {cols.length}
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {cols.map((c) => (
                <li key={c.key} className="px-3 py-1.5">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={allowed.has(c.key)}
                      onChange={() => toggle(c.key)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-500/30"
                    />
                    <span className="text-slate-900">{c.label}</span>
                    <code className="ml-auto text-[11px] text-slate-400">{c.key}</code>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="sticky bottom-2 z-10 flex items-center justify-end gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur">
        {savedAt && (
          <span className="text-xs text-emerald-600">
            Uloženo {savedAt.toLocaleTimeString("cs-CZ")}
          </span>
        )}
        {errorMsg && <span className="text-xs text-rose-600">{errorMsg}</span>}
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-full bg-[#1E3A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F2B46] disabled:opacity-50"
        >
          {saving ? "Ukládám…" : "Uložit"}
        </button>
      </div>
    </div>
  );
}
