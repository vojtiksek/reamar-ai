"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";

type ActionStatus = "idle" | "running" | "done" | "error";

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

export default function OperacePage() {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Import</h2>

        <ActionCard
          title="Import BuiltMind"
          description="Načte aktuální data projektů a jednotek z BuiltMind API. Může trvat 1–2 minuty."
          buttonLabel="Spustit import"
          runningLabel="Importuji…"
          onRun={async () => {
            const res = await fetch(`${API_BASE}/admin/imports/builtmind/run`, { method: "POST" });
            const data = await res.json() as Record<string, unknown>;
            if (!res.ok || !data["ok"]) {
              throw new Error((data as { detail?: string })["detail"] ?? JSON.stringify(data));
            }
            return `Hotovo: ${data["units_created"]} nových, ${data["units_updated"]} aktualizovaných jednotek. Projekty: +${data["projects_created"]} nových, ${data["projects_reused"]} existujících. (${data["elapsed_seconds"]}s)`;
          }}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Přepočty</h2>

        <ActionCard
          title="Stáhnout walkability POI + přepočítat projekty"
          description="Aktualizuje data o okolí (POI) z OpenStreetMap a přepočítá walkability metriky projektů."
          buttonLabel="Spustit"
          runningLabel="Stahuji…"
          onRun={async () => {
            const res = await fetch(`${API_BASE}/admin/walkability-sources/refresh-and-recompute`, { method: "POST" });
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
            const res = await fetch(`${API_BASE}/admin/aggregates/recompute-floors`, { method: "POST" });
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
            const res = await fetch(`${API_BASE}/units/local-price-diffs/recompute`, { method: "POST" });
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
            const res = await fetch(`${API_BASE}/admin/location-metrics/recompute-all`, { method: "POST" });
            if (!res.ok) throw new Error(await res.text());
            return "Mikro-lokalita a hluk přepočítány.";
          }}
        />
      </div>
    </div>
  );
}
