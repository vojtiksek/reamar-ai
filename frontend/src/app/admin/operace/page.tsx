"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

function ErrorsHealthBanner() {
  const [unresolved, setUnresolved] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
        const res = await fetch(`${API_BASE}/admin/errors?since_hours=24&only_unresolved=true&limit=1`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setUnresolved(json.unresolved ?? 0);
        setCounts(json.counts ?? {});
      } catch {
        // silent
      }
    };
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (unresolved == null) return null;
  const tone = unresolved > 0 ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return (
    <Link
      href="/admin/errors"
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition hover:opacity-90 ${tone}`}
    >
      <div className="flex items-center gap-3">
        <span className="text-lg">{unresolved > 0 ? "⚠" : "✓"}</span>
        <div>
          <div className="text-sm font-semibold">
            {unresolved > 0
              ? `${unresolved} nevyřešených chyb za 24 h`
              : "Žádné chyby za posledních 24 h"}
          </div>
          {unresolved > 0 && (
            <div className="text-xs opacity-80">
              backend {counts.server ?? 0} · frontend {counts.client ?? 0} · probe {counts.probe ?? 0}
            </div>
          )}
        </div>
      </div>
      <span className="text-xs opacity-70">Otevřít →</span>
    </Link>
  );
}

type ActionStatus = "idle" | "running" | "done" | "error";

type OpsStep = {
  name: string;
  status: "running" | "done" | "error";
  started_at: string | null;
  finished_at: string | null;
  duration_s: number | null;
  output: unknown;
  error: string | null;
};

type OpsRunListItem = {
  id: number;
  trigger: string;
  status: "running" | "done" | "partial" | "error";
  started_at: string | null;
  finished_at: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  steps_count?: number;
  steps_ok?: number;
  steps_err?: number;
};

type OpsRunDetail = OpsRunListItem & { steps: OpsStep[] };

type BucketSummary = {
  runs_total: number;
  runs_ok: number;
  runs_err: number;
  runs_running: number;
  units_created: number;
  units_updated: number;
  projects_created: number;
};

type OpsSummary = {
  day: BucketSummary;
  week: BucketSummary;
  month: BucketSummary;
  last_run: OpsRunListItem | null;
};

const STEP_LABELS: Record<string, string> = {
  builtmind_import: "BuiltMind import (projekty + jednotky)",
  walkability_refresh: "Walkability POI + přepočet",
  derived_floors: "Odvození počtu pater",
  local_price_diffs: "Odchylka od trhu",
  location_metrics: "Mikro-lokalita + hluk",
};

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDuration(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${m}m ${sec}s`;
}

function statusColor(status: string): string {
  if (status === "done") return "bg-emerald-100 text-emerald-800";
  if (status === "running") return "bg-sky-100 text-sky-800";
  if (status === "partial") return "bg-amber-100 text-amber-800";
  return "bg-rose-100 text-rose-800";
}

function statusLabel(status: string): string {
  switch (status) {
    case "done": return "Hotovo";
    case "running": return "Běží";
    case "partial": return "Částečně";
    case "error": return "Chyba";
    default: return status;
  }
}

// ---------------------------------------------------------------------

function ActionCard({
  title,
  description,
  buttonLabel,
  runningLabel,
  onRun,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  runningLabel: string;
  onRun: () => Promise<string>;
}) {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [result, setResult] = useState<string | null>(null);

  const handleClick = async () => {
    setStatus("running");
    setResult(null);
    try {
      const msg = await onRun();
      setResult(msg);
      setStatus("done");
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Neznámá chyba");
      setStatus("error");
    }
  };

  return (
    <ReamarCard className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
          {result && (
            <p className={`mt-2 text-xs ${status === "error" ? "text-rose-600" : "text-emerald-700"}`}>
              {result}
            </p>
          )}
        </div>
        <ReamarButton
          size="sm"
          variant={status === "done" ? "secondary" : "primary"}
          onClick={handleClick}
          disabled={status === "running"}
        >
          {status === "running" ? runningLabel : buttonLabel}
        </ReamarButton>
      </div>
    </ReamarCard>
  );
}

// ---------------------------------------------------------------------

function SummaryBucket({ label, bucket }: { label: string; bucket: BucketSummary | null }) {
  const b = bucket ?? {
    runs_total: 0,
    runs_ok: 0,
    runs_err: 0,
    runs_running: 0,
    units_created: 0,
    units_updated: 0,
    projects_created: 0,
  };
  return (
    <ReamarCard className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{b.runs_total}</span>
        <span className="text-xs text-slate-500">běhů</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <span className="text-emerald-700">{b.runs_ok} ok</span>
        {b.runs_err > 0 && <span className="text-rose-700">{b.runs_err} chyba</span>}
        {b.runs_running > 0 && <span className="text-sky-700">{b.runs_running} běží</span>}
      </div>
      <div className="mt-3 space-y-0.5 text-[11px] text-slate-600">
        <div>+{b.units_created} nových jednotek</div>
        <div>~{b.units_updated} aktualizovaných</div>
        <div>+{b.projects_created} nových projektů</div>
      </div>
    </ReamarCard>
  );
}

// ---------------------------------------------------------------------

function RunRow({
  run,
  expanded,
  detail,
  loadingDetail,
  onToggle,
}: {
  run: OpsRunListItem;
  expanded: boolean;
  detail: OpsRunDetail | null;
  loadingDetail: boolean;
  onToggle: () => void;
}) {
  const triggerLabel = run.trigger === "cron" ? "Cron 5:00" : run.trigger.startsWith("manual") ? "Manuálně" : run.trigger;
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50">
        <td className="px-3 py-2 text-xs text-slate-700">{fmtDateTime(run.started_at)}</td>
        <td className="px-3 py-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColor(run.status)}`}>
            {statusLabel(run.status)}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-slate-600">{triggerLabel}</td>
        <td className="px-3 py-2 text-right text-xs text-slate-600">
          {run.steps_ok ?? 0}/{run.steps_count ?? 0}
          {(run.steps_err ?? 0) > 0 && <span className="text-rose-600"> ({run.steps_err} chyba)</span>}
        </td>
        <td className="px-3 py-2 text-right text-xs text-slate-600">
          {run.finished_at && run.started_at
            ? fmtDuration(
                (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000,
              )
            : run.status === "running"
              ? "…"
              : "—"}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            className="text-xs font-medium text-slate-700 underline-offset-2 hover:underline"
            onClick={onToggle}
          >
            {expanded ? "Skrýt" : "Detail"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50/60">
          <td colSpan={6} className="px-3 py-3">
            {loadingDetail ? (
              <p className="text-xs text-slate-500">Načítám…</p>
            ) : detail ? (
              <div className="space-y-2">
                {detail.error && (
                  <p className="rounded bg-rose-50 p-2 text-[11px] text-rose-700">{detail.error}</p>
                )}
                <ul className="space-y-1.5">
                  {detail.steps.map((s, i) => (
                    <li
                      key={`${s.name}-${i}`}
                      className="flex flex-wrap items-center gap-2 rounded bg-white px-2.5 py-1.5 ring-1 ring-slate-200"
                    >
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColor(s.status)}`}>
                        {statusLabel(s.status)}
                      </span>
                      <span className="text-xs font-medium text-slate-800">
                        {STEP_LABELS[s.name] ?? s.name}
                      </span>
                      <span className="text-[11px] text-slate-500">· {fmtDuration(s.duration_s)}</span>
                      {s.error && (
                        <span className="ml-auto text-[11px] text-rose-700">{s.error}</span>
                      )}
                      {!s.error && s.output != null && (
                        <span className="ml-auto font-mono text-[10px] text-slate-500">
                          {summarizeOutput(s.name, s.output)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Žádný detail.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function summarizeOutput(stepName: string, output: unknown): string {
  if (output == null || typeof output !== "object") return "";
  const o = output as Record<string, unknown>;
  if (stepName === "builtmind_import") {
    const s = (o.import_stats as Record<string, unknown> | undefined) ?? {};
    const parts: string[] = [];
    if (s.units_created != null) parts.push(`+${s.units_created} jed.`);
    if (s.units_updated != null) parts.push(`~${s.units_updated} upd.`);
    if (s.projects_created != null) parts.push(`+${s.projects_created} proj.`);
    return parts.join(" · ");
  }
  if (stepName === "derived_floors") {
    return `proj: ${o.processed ?? 0}, s patry: ${o.with_derived_floors ?? 0}`;
  }
  if (stepName === "walkability_refresh") {
    const rec = (o.recompute as Record<string, unknown> | undefined) ?? {};
    return `${rec.processed ?? 0}/${rec.total ?? 0} projektů`;
  }
  return "";
}

// ---------------------------------------------------------------------

export default function OperacePage() {
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [runs, setRuns] = useState<OpsRunListItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<OpsRunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [kicking, setKicking] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [summaryRes, runsRes] = await Promise.all([
        fetch(`${API_BASE}/admin/ops/summary`, { headers: authHeaders() }),
        fetch(`${API_BASE}/admin/ops/runs?limit=30`, { headers: authHeaders() }),
      ]);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (runsRes.ok) setRuns(await runsRes.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-poll while any run is active
  useEffect(() => {
    const running = runs.some((r) => r.status === "running");
    if (!running) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (!pollRef.current) {
      pollRef.current = window.setInterval(refresh, 5000);
    }
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [runs, refresh]);

  const triggerDailyRun = useCallback(async () => {
    setKicking(true);
    setRunError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/ops/daily-run`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Neznámá chyba");
    } finally {
      setKicking(false);
    }
  }, [refresh]);

  const toggleDetail = useCallback(async (runId: number) => {
    if (expandedId === runId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(runId);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_BASE}/admin/ops/runs/${runId}`, { headers: authHeaders() });
      if (res.ok) setDetail(await res.json());
    } finally {
      setLoadingDetail(false);
    }
  }, [expandedId]);

  const anyRunning = runs.some((r) => r.status === "running");

  return (
    <div className="space-y-6">
      <ErrorsHealthBanner />
      {/* Daily pipeline header */}
      <ReamarCard className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Denní data pipeline</h2>
            <p className="mt-1 text-xs text-slate-500">
              Import z BuiltMind → walkability → patra → odchylka od trhu → mikro-lokalita.
              Automaticky každý den v 5:00 (Vercel cron).
            </p>
            {summary?.last_run && (
              <p className="mt-2 text-[11px] text-slate-600">
                Poslední běh: {fmtDateTime(summary.last_run.started_at)} ·{" "}
                <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(summary.last_run.status)}`}>
                  {statusLabel(summary.last_run.status)}
                </span>
              </p>
            )}
            {runError && <p className="mt-2 text-xs text-rose-600">{runError}</p>}
          </div>
          <ReamarButton
            variant="primary"
            onClick={triggerDailyRun}
            disabled={kicking || anyRunning}
          >
            {anyRunning ? "Běží…" : kicking ? "Spouštím…" : "Spustit teď"}
          </ReamarButton>
        </div>
      </ReamarCard>

      {/* Summary buckets */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryBucket label="Za 24 h" bucket={summary?.day ?? null} />
        <SummaryBucket label="Za 7 dní" bucket={summary?.week ?? null} />
        <SummaryBucket label="Za 30 dní" bucket={summary?.month ?? null} />
      </div>

      {/* Runs history */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Historie běhů
        </h3>
        <ReamarCard className="overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Start</th>
                <th className="px-3 py-2 font-semibold">Stav</th>
                <th className="px-3 py-2 font-semibold">Zdroj</th>
                <th className="px-3 py-2 text-right font-semibold">Kroky</th>
                <th className="px-3 py-2 text-right font-semibold">Trvání</th>
                <th className="px-3 py-2 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-xs text-slate-500">
                    Žádné zatím — spusť první běh.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  expanded={expandedId === r.id}
                  detail={expandedId === r.id ? detail : null}
                  loadingDetail={loadingDetail}
                  onToggle={() => toggleDetail(r.id)}
                />
              ))}
            </tbody>
          </table>
        </ReamarCard>
      </div>

      {/* Individual manual steps (unchanged) */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Manuální kroky (izolovaně)
        </h3>

        <ActionCard
          title="Import BuiltMind"
          description="Načte aktuální data projektů a jednotek z BuiltMind API. Může trvat 1–2 minuty."
          buttonLabel="Spustit import"
          runningLabel="Importuji…"
          onRun={async () => {
            const res = await fetch(`${API_BASE}/admin/imports/builtmind/run`, { method: "POST", headers: authHeaders() });
            const data = await res.json() as Record<string, unknown>;
            if (!res.ok || !data["ok"]) {
              throw new Error((data as { detail?: string })["detail"] ?? JSON.stringify(data));
            }
            return `Hotovo: ${data["units_created"]} nových, ${data["units_updated"]} aktualizovaných jednotek. Projekty: +${data["projects_created"]} nových, ${data["projects_reused"]} existujících. (${data["elapsed_seconds"]}s)`;
          }}
        />

        <ActionCard
          title="Stáhnout walkability POI + přepočítat projekty"
          description="Aktualizuje data o okolí (POI) z OpenStreetMap a přepočítá walkability metriky projektů."
          buttonLabel="Spustit"
          runningLabel="Stahuji…"
          onRun={async () => {
            const res = await fetch(`${API_BASE}/admin/walkability-sources/refresh-and-recompute`, { method: "POST", headers: authHeaders() });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json() as { recompute?: { processed?: number; total?: number } };
            return `Walkability data obnovena. Projekty přepočítány: ${data.recompute?.processed ?? 0}/${data.recompute?.total ?? 0}`;
          }}
        />

        <ActionCard
          title="Odvodit počet pater z jednotek"
          description="Odvozuje maximální počet pater každého projektu z existujících jednotek."
          buttonLabel="Spustit"
          runningLabel="Přepočítávám…"
          onRun={async () => {
            const res = await fetch(`${API_BASE}/admin/aggregates/recompute-floors`, { method: "POST", headers: authHeaders() });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json() as { processed?: number; with_derived_floors?: number; elapsed_seconds?: number };
            return `Hotovo. Projektů: ${data.processed}, s patry: ${data.with_derived_floors} (${data.elapsed_seconds}s)`;
          }}
        />

        <ActionCard
          title="Přepočítat odchylku od trhu"
          description="Přepočítá cenovou odchylku jednotek vůči okolní nabídce v okruhu 1 km a 2 km."
          buttonLabel="Spustit"
          runningLabel="Přepočítávám…"
          onRun={async () => {
            const res = await fetch(`${API_BASE}/units/local-price-diffs/recompute`, { method: "POST", headers: authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return "Odchylky od trhu přepočítány.";
          }}
        />

        <ActionCard
          title="Přepočítat mikro-lokalitu a hluk"
          description="Aktualizuje hlukové zóny a mikro-lokalitní charakteristiky pro všechny projekty."
          buttonLabel="Spustit"
          runningLabel="Přepočítávám…"
          onRun={async () => {
            const res = await fetch(`${API_BASE}/admin/location-metrics/recompute-all`, { method: "POST", headers: authHeaders() });
            if (!res.ok) throw new Error(await res.text());
            return "Mikro-lokalita a hluk přepočítány.";
          }}
        />
      </div>
    </div>
  );
}
