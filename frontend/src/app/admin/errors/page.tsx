"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";
import { readLocalErrors, clearLocalErrors, type LocalErrorRecord } from "@/lib/errorReporter";

type ErrorItem = {
  id: number;
  ts: string | null;
  source: "server" | "client" | "probe" | string;
  level: string;
  status: number | null;
  method: string | null;
  path: string | null;
  query: string | null;
  message: string;
  user_agent: string | null;
  request_id: string | null;
  resolved_at: string | null;
};

type ErrorDetail = ErrorItem & {
  traceback: string | null;
  broker_id: number | null;
  extra: Record<string, unknown> | null;
};

type ErrorsListResponse = {
  items: ErrorItem[];
  counts: Record<string, number>;
  unresolved: number;
  since_hours: number;
};

const SINCE_OPTIONS = [
  { hours: 1, label: "1 h" },
  { hours: 24, label: "24 h" },
  { hours: 24 * 7, label: "7 d" },
  { hours: 24 * 14, label: "14 d" },
];

const SOURCE_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: "Vše" },
  { value: "server", label: "Backend" },
  { value: "client", label: "Frontend" },
  { value: "probe", label: "Probe" },
];

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function sourceBadge(source: string): string {
  if (source === "server") return "bg-rose-100 text-rose-800";
  if (source === "client") return "bg-amber-100 text-amber-800";
  if (source === "probe") return "bg-sky-100 text-sky-800";
  return "bg-slate-100 text-slate-800";
}

function statusBadge(status: number | null): string {
  if (status == null) return "bg-slate-100 text-slate-700";
  if (status >= 500) return "bg-rose-100 text-rose-800";
  if (status >= 400) return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function buildCopyBlock(item: ErrorDetail): string {
  return [
    `Error #${item.id}`,
    `Time:    ${item.ts ?? ""}`,
    `Source:  ${item.source}${item.level && item.level !== "error" ? ` (${item.level})` : ""}`,
    `Status:  ${item.status ?? "—"}`,
    `Method:  ${item.method ?? "—"}`,
    `Path:    ${item.path ?? "—"}`,
    item.query ? `Query:   ${item.query}` : "",
    `Message: ${item.message}`,
    item.user_agent ? `UA:      ${item.user_agent}` : "",
    item.request_id ? `ReqID:   ${item.request_id}` : "",
    "",
    item.traceback ? "Traceback:" : "",
    item.traceback ?? "",
  ]
    .filter((l) => l !== null && l !== undefined && l !== "")
    .join("\n");
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(items: ErrorItem[]): void {
  const headers = ["id", "ts", "source", "status", "method", "path", "query", "message", "user_agent", "request_id"];
  const lines = [headers.join(",")];
  for (const r of items) {
    lines.push(
      headers
        .map((h) => csvEscape((r as unknown as Record<string, unknown>)[h]))
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `errors_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminErrorsPage() {
  const [data, setData] = useState<ErrorsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sinceHours, setSinceHours] = useState(24);
  const [source, setSource] = useState<string | null>(null);
  const [onlyUnresolved, setOnlyUnresolved] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selected, setSelected] = useState<ErrorDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [localErrors, setLocalErrors] = useState<LocalErrorRecord[]>([]);

  // Re-read localStorage on mount + on every refresh tick so the fallback
  // table picks up new errors captured by errorReporter while backend is down.
  useEffect(() => {
    setLocalErrors(readLocalErrors());
  }, []);

  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("since_hours", String(sinceHours));
      if (source) params.set("source", source);
      if (onlyUnresolved) params.set("only_unresolved", "true");
      else params.set("only_unresolved", "false");
      params.set("limit", "500");
      const res = await fetch(`${API_BASE}/admin/errors?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ErrorsListResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba načítání");
      // Backend unreachable → make sure the local-storage fallback is fresh
      // so the user sees their session errors instead of a blank page.
      setLocalErrors(readLocalErrors());
    } finally {
      setLoading(false);
    }
  }, [sinceHours, source, onlyUnresolved]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) {
      if (refreshTimer.current) {
        window.clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
      return;
    }
    refreshTimer.current = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => {
      if (refreshTimer.current) window.clearInterval(refreshTimer.current);
    };
  }, [autoRefresh, load]);

  const openDetail = useCallback(async (id: number) => {
    setDrawerLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/errors/${id}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ErrorDetail;
      setSelected(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba načítání detailu");
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const resolve = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`${API_BASE}/admin/errors/${id}/resolve`, {
          method: "POST",
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSelected(null);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chyba");
      }
    },
    [load],
  );

  const resolveAll = useCallback(async () => {
    if (!confirm("Označit všechny zobrazené chyby jako vyřešené?")) return;
    try {
      const params = new URLSearchParams();
      params.set("since_hours", String(sinceHours));
      if (source) params.set("source", source);
      const res = await fetch(`${API_BASE}/admin/errors/resolve-bulk?${params.toString()}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba");
    }
  }, [sinceHours, source, load]);

  const copyRow = useCallback(async (item: ErrorItem) => {
    try {
      const res = await fetch(`${API_BASE}/admin/errors/${item.id}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const detail = (await res.json()) as ErrorDetail;
      const text = buildCopyBlock(detail);
      await navigator.clipboard.writeText(text);
      setCopied(item.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kopírování selhalo");
    }
  }, []);

  const items = data?.items ?? [];
  const counts = data?.counts ?? {};

  const summary = useMemo(() => {
    const total = items.length;
    const bySource = items.reduce<Record<string, number>>((acc, it) => {
      acc[it.source] = (acc[it.source] || 0) + 1;
      return acc;
    }, {});
    return { total, bySource };
  }, [items]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Chyby</h1>
          <p className="text-sm text-slate-600">
            Server, frontend a probe errory. Auto-refresh každých 30 s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReamarButton variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Načítám…" : "Obnovit"}
          </ReamarButton>
          <ReamarButton
            variant="secondary"
            onClick={() => downloadCsv(items)}
            disabled={items.length === 0}
          >
            Export CSV ({items.length})
          </ReamarButton>
          <ReamarButton variant="secondary" onClick={() => void resolveAll()} disabled={items.length === 0}>
            Označit vše vyřešené
          </ReamarButton>
        </div>
      </div>

      <ReamarCard className="p-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-600">Okno:</span>
            {SINCE_OPTIONS.map((o) => (
              <button
                key={o.hours}
                onClick={() => setSinceHours(o.hours)}
                className={
                  "rounded-full border px-3 py-1 transition " +
                  (sinceHours === o.hours
                    ? "border-sky-600 bg-sky-600 text-white"
                    : "border-slate-200 bg-white hover:bg-slate-50")
                }
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-600">Zdroj:</span>
            {SOURCE_OPTIONS.map((o) => (
              <button
                key={o.label}
                onClick={() => setSource(o.value)}
                className={
                  "rounded-full border px-3 py-1 transition " +
                  (source === o.value
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-200 bg-white hover:bg-slate-50")
                }
              >
                {o.label}
                {o.value && counts[o.value] != null ? (
                  <span className="ml-1 text-xs opacity-70">({counts[o.value]})</span>
                ) : null}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={onlyUnresolved}
              onChange={(e) => setOnlyUnresolved(e.target.checked)}
            />
            <span>Jen nevyřešené</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh</span>
          </label>
          <span className="ml-auto text-xs text-slate-500">
            Zobrazeno {summary.total} • backend {summary.bySource.server || 0} • frontend{" "}
            {summary.bySource.client || 0} • probe {summary.bySource.probe || 0}
          </span>
        </div>
      </ReamarCard>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <div className="font-semibold">Backend nedostupný: {error}</div>
          <div className="mt-1 text-xs">
            Zobrazují se pouze chyby z této session prohlížeče (níže). Po obnovení
            backendu klikni na „Obnovit".
          </div>
        </div>
      )}

      {(error || localErrors.length > 0) && (
        <ReamarCard className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-100 bg-amber-50 px-4 py-2 text-sm">
            <div>
              <span className="font-semibold text-amber-900">Lokální fallback</span>
              <span className="ml-2 text-amber-800">
                {localErrors.length} chyb z této session (uloženo v prohlížeči)
              </span>
            </div>
            <button
              className="rounded border border-amber-300 bg-white px-2 py-1 text-xs hover:bg-amber-100"
              onClick={() => {
                if (confirm("Vymazat lokální chyby?")) {
                  clearLocalErrors();
                  setLocalErrors([]);
                }
              }}
              disabled={localErrors.length === 0}
            >
              Vymazat
            </button>
          </div>
          <div className="max-h-[40vh] overflow-auto">
            <table className="w-full table-fixed text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="w-[140px] px-3 py-2">Čas</th>
                  <th className="w-[100px] px-3 py-2">Zdroj</th>
                  <th className="w-[60px] px-3 py-2">Stav</th>
                  <th className="w-[260px] px-3 py-2">Path</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="w-[100px] px-3 py-2 text-right">Akce</th>
                </tr>
              </thead>
              <tbody>
                {localErrors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                      Žádné lokální chyby. (Reportér je aktivní — nově vzniklé chyby se objeví zde.)
                    </td>
                  </tr>
                )}
                {[...localErrors].reverse().map((it) => (
                  <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{fmtTs(it.ts)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                        local · {it.source ?? "?"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-mono ${statusBadge(it.status ?? null)}`}>
                        {it.status ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" title={it.url ?? ""}>
                      {truncate(it.url ?? "", 40)}
                    </td>
                    <td className="px-3 py-2 text-xs" title={it.message}>
                      {truncate(it.message, 120)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                        onClick={async () => {
                          const text = [
                            `Local error #${it.id}`,
                            `Time:    ${it.ts}`,
                            `Source:  ${it.source ?? "?"}`,
                            `Status:  ${it.status ?? "—"}`,
                            `Method:  ${it.method ?? "—"}`,
                            `URL:     ${it.url ?? "—"}`,
                            `Message: ${it.message}`,
                            it.stack ? "\nStack:" : "",
                            it.stack ?? "",
                          ].filter(Boolean).join("\n");
                          await navigator.clipboard.writeText(text);
                        }}
                      >
                        Kopírovat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ReamarCard>
      )}

      <ReamarCard className="overflow-hidden p-0">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="w-[140px] px-3 py-2">Čas</th>
                <th className="w-[80px] px-3 py-2">Zdroj</th>
                <th className="w-[60px] px-3 py-2">Stav</th>
                <th className="w-[60px] px-3 py-2">Met.</th>
                <th className="w-[260px] px-3 py-2">Path</th>
                <th className="px-3 py-2">Message</th>
                <th className="w-[170px] px-3 py-2 text-right">Akce</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    Žádné chyby v tomto okně.
                  </td>
                </tr>
              )}
              {items.map((it) => (
                <tr
                  key={it.id}
                  className={
                    "border-t border-slate-100 hover:bg-slate-50 " +
                    (it.resolved_at ? "opacity-50" : "")
                  }
                >
                  <td className="px-3 py-2 font-mono text-xs">{fmtTs(it.ts)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${sourceBadge(it.source)}`}>
                      {it.source}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-mono ${statusBadge(it.status)}`}>
                      {it.status ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{it.method ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs" title={it.path ?? ""}>
                    {truncate(it.path, 40)}
                  </td>
                  <td className="px-3 py-2 text-xs" title={it.message}>
                    {truncate(it.message, 120)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                        onClick={() => void copyRow(it)}
                        title="Zkopírovat formátovaný blok pro Claude"
                      >
                        {copied === it.id ? "✓" : "Kopírovat"}
                      </button>
                      <button
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                        onClick={() => void openDetail(it.id)}
                      >
                        Detail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReamarCard>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex"
          onClick={() => setSelected(null)}
        >
          <div className="ml-auto h-full w-full max-w-2xl overflow-auto bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">Error #{selected.id}</div>
                <h2 className="text-lg font-semibold">{truncate(selected.message, 200)}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className={`rounded px-2 py-0.5 font-medium ${sourceBadge(selected.source)}`}>
                    {selected.source}
                  </span>
                  <span className={`rounded px-2 py-0.5 font-mono ${statusBadge(selected.status)}`}>
                    {selected.status ?? "—"}
                  </span>
                  <span className="font-mono text-slate-700">
                    {selected.method ?? ""} {selected.path ?? ""}
                  </span>
                  <span className="text-slate-500">{fmtTs(selected.ts)}</span>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                aria-label="Zavřít"
              >
                ✕
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <ReamarButton
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(buildCopyBlock(selected));
                  setCopied(selected.id);
                  window.setTimeout(() => setCopied(null), 1500);
                }}
              >
                {copied === selected.id ? "✓ Zkopírováno" : "Zkopírovat celé pro Claude"}
              </ReamarButton>
              {!selected.resolved_at && (
                <ReamarButton
                  variant="primary"
                  onClick={() => void resolve(selected.id)}
                >
                  Označit jako vyřešené
                </ReamarButton>
              )}
            </div>

            {selected.query && (
              <div className="mb-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Query</div>
                <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">{selected.query}</pre>
              </div>
            )}

            {selected.user_agent && (
              <div className="mb-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">User Agent</div>
                <div className="text-xs text-slate-700">{selected.user_agent}</div>
              </div>
            )}

            {selected.traceback && (
              <div className="mb-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Stack trace</div>
                <pre className="overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                  {selected.traceback}
                </pre>
              </div>
            )}

            {selected.extra && Object.keys(selected.extra).length > 0 && (
              <div className="mb-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Extra</div>
                <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">
                  {JSON.stringify(selected.extra, null, 2)}
                </pre>
              </div>
            )}

            {selected.request_id && (
              <div className="text-xs text-slate-500">Request ID: {selected.request_id}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
