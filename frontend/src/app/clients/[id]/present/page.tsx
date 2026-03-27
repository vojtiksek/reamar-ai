"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { formatCurrencyCzk, formatAreaM2, formatLayout, formatMinutes } from "@/lib/format";
import { API_BASE } from "@/lib/api";

const PresentMap = dynamic(
  () => import("@/app/units/[external_id]/UnitDetailMap"),
  { ssr: false }
);

type PinnedRec = {
  rec_id: number;
  pinned_by_broker: boolean;
  unit_external_id: string | null;
  project_name?: string | null;
  layout_label?: string | null;
  floor_area_m2?: number | null;
  price_czk?: number | null;
  score: number;
};

type UnitDetail = {
  external_id: string;
  project_id: number;
  project: {
    name: string;
    gps_latitude?: number | null;
    gps_longitude?: number | null;
    developer?: string | null;
    [k: string]: unknown;
  };
  layout: string | null;
  floor_area_m2: number | null;
  exterior_area_m2?: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  original_price_czk?: number | null;
  floor?: number | null;
  availability_status?: string | null;
  air_conditioning?: boolean | null;
  exterior_blinds?: string | null;
  heating?: string | null;
  url?: string | null;
  developer?: string | null;
  data?: Record<string, unknown>;
  [k: string]: unknown;
};

function availInfo(status: string | null | undefined): { label: string; cls: string } {
  const s = String(status ?? "").toLowerCase();
  if (s === "available") return { label: "Volná", cls: "bg-emerald-100 text-emerald-800" };
  if (s === "reserved") return { label: "Rezervovaná", cls: "bg-amber-100 text-amber-800" };
  if (s === "sold") return { label: "Prodaná", cls: "bg-red-100 text-red-700" };
  return { label: "—", cls: "bg-slate-100 text-slate-600" };
}

function scoreBadge(score: number): { label: string; cls: string } {
  if (score >= 80) return { label: "Výborná shoda", cls: "bg-emerald-100 text-emerald-800" };
  if (score >= 60) return { label: "Dobrá shoda", cls: "bg-blue-100 text-blue-800" };
  return { label: "Dobrá shoda", cls: "bg-slate-100 text-slate-600" };
}

/** Read a field from unit.data first, then top-level. */
function field<T>(unit: UnitDetail, key: string): T | null | undefined {
  if (unit.data && key in unit.data) return unit.data[key] as T;
  return (unit as Record<string, unknown>)[key] as T;
}

export default function PresentPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = Number(params?.id);

  const [token, setToken] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [budgetMax, setBudgetMax] = useState<number | null>(null);
  const [pinnedRecs, setPinnedRecs] = useState<PinnedRec[]>([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [unitLoading, setUnitLoading] = useState(false);

  type ShareStatus = "idle" | "loading" | "copied" | "fallback" | "error";
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  // Auth guard
  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    if (!t) { router.push("/login"); return; }
    setToken(t);
  }, [router]);

  // Fetch client name + pinned recs in parallel
  useEffect(() => {
    if (!token || !clientId) return;
    const headers: HeadersInit = { Authorization: `Bearer ${token}` };
    setRecsLoading(true);
    Promise.all([
      fetch(`${API_BASE}/clients/${clientId}`, { headers }).then((r) => r.ok ? r.json() : null),
      fetch(`${API_BASE}/clients/${clientId}/recommendations`, { headers }).then((r) => r.ok ? r.json() : []),
      fetch(`${API_BASE}/clients/${clientId}/profile`, { headers }).then((r) => r.ok ? r.json() : null),
    ])
      .then(([client, recs, profile]) => {
        setClientName(client?.name ?? "Klient");
        setBudgetMax(profile?.budget_max ?? null);
        const pinned: PinnedRec[] = (Array.isArray(recs) ? recs : []).filter(
          (r: PinnedRec) => r.pinned_by_broker
        );
        setPinnedRecs(pinned);
        if (pinned.length > 0 && pinned[0].unit_external_id) {
          setSelectedId(pinned[0].unit_external_id);
        }
      })
      .catch(() => {})
      .finally(() => setRecsLoading(false));
  }, [token, clientId]);

  // Fetch unit detail when selection changes
  const fetchUnit = useCallback(
    (externalId: string) => {
      if (!token) return;
      setUnitLoading(true);
      setUnit(null);
      fetch(`${API_BASE}/units/${encodeURIComponent(externalId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data) setUnit(data); })
        .catch(() => {})
        .finally(() => setUnitLoading(false));
    },
    [token]
  );

  useEffect(() => {
    if (selectedId) fetchUnit(selectedId);
  }, [selectedId, fetchUnit]);

  const handleShare = useCallback(async () => {
    if (!token) return;
    setShareStatus("loading");
    setFallbackUrl(null);
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/share-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { url } = await res.json() as { url: string; expires_at: string };
      try {
        await navigator.clipboard.writeText(url);
        setShareStatus("copied");
      } catch {
        // Clipboard blocked (non-HTTPS or permissions denied) — show URL inline
        setFallbackUrl(url);
        setShareStatus("fallback");
      }
    } catch {
      setShareStatus("error");
    }
    // Reset to idle after 4 s (except fallback — stays until dismissed)
    setTimeout(() => setShareStatus((s) => s === "fallback" ? s : "idle"), 4000);
  }, [token, clientId]);

  // Derived unit fields
  const gpsLat = unit?.project?.gps_latitude as number | null | undefined;
  const gpsLng = unit?.project?.gps_longitude as number | null | undefined;
  const hasGps = gpsLat != null && gpsLng != null;
  const developer = unit ? (unit.developer ?? (unit.project as { developer?: string | null })?.developer ?? null) : null;
  const rideMin = unit ? field<number>(unit, "ride_to_center_min") : null;
  const ptMin = unit ? field<number>(unit, "public_transport_to_center_min") : null;
  const ac = unit ? field<boolean>(unit, "air_conditioning") : null;
  const blinds = unit ? field<string>(unit, "exterior_blinds") : null;
  const heating = unit ? field<string>(unit, "heating") : null;
  const unitUrl = unit
    ? ((unit.url as string | null) ?? (unit.data?.unit_url as string | null) ?? null)
    : null;
  let projectUrl: string | null = null;
  if (unitUrl) {
    try {
      const p = new URL(unitUrl);
      projectUrl = `${p.protocol}//${p.host}`;
    } catch {
      const i = unitUrl.indexOf(".cz/");
      if (i !== -1) projectUrl = unitUrl.slice(0, i + 3);
    }
  }

  const selectedRec = pinnedRecs.find((r) => r.unit_external_id === selectedId);

  const unitCount = pinnedRecs.length;
  const unitCountLabel =
    unitCount === 1 ? "1 jednotka" : unitCount < 5 ? `${unitCount} jednotky` : `${unitCount} jednotek`;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href={`/clients/${clientId}`}
            className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            ← Zpět
          </Link>
          <span className="text-slate-300">|</span>
          <span className="text-base font-semibold text-slate-900">{clientName || "…"}</span>
          <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
            Schůzka
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{unitCountLabel} ve výběru</span>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={handleShare}
              disabled={shareStatus === "loading" || pinnedRecs.length === 0}
              className="rounded-full bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-50"
            >
              {shareStatus === "loading" ? "Generuji…" : shareStatus === "copied" ? "✓ Odkaz zkopírován" : "Sdílet výběr"}
            </button>
            {shareStatus === "error" && (
              <p className="text-[11px] text-red-500">Nepodařilo se vygenerovat odkaz.</p>
            )}
            {shareStatus === "fallback" && fallbackUrl && (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
                <input
                  readOnly
                  value={fallbackUrl}
                  className="w-64 bg-transparent text-[11px] text-slate-700 outline-none"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  onClick={() => setShareStatus("idle")}
                  className="text-[11px] text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Two-panel body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: shortlist ── */}
        <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Výběr</p>
          </div>
          {recsLoading ? (
            <p className="px-4 py-6 text-sm text-slate-400">Načítám…</p>
          ) : pinnedRecs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400">
              Žádné jednotky ve výběru.{" "}
              <Link href={`/clients/${clientId}`} className="underline hover:text-slate-700">
                Přidat v doporučeních.
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pinnedRecs.map((rec, recIdx) => {
                const isSelected = rec.unit_external_id === selectedId;
                return (
                  <li key={rec.rec_id}>
                    <div className={`flex items-center border-l-2 transition-colors ${
                        isSelected
                          ? "border-violet-500 bg-violet-50"
                          : "border-transparent hover:bg-slate-50"
                      }`}>
                      <div className="flex shrink-0 flex-col px-1">
                        <button
                          type="button"
                          disabled={recIdx === 0}
                          className="text-[10px] text-slate-300 hover:text-slate-600 disabled:opacity-20"
                          onClick={() => setPinnedRecs((prev) => {
                            if (recIdx <= 0) return prev;
                            const next = [...prev];
                            [next[recIdx - 1], next[recIdx]] = [next[recIdx], next[recIdx - 1]];
                            return next;
                          })}
                        >▲</button>
                        <button
                          type="button"
                          disabled={recIdx === pinnedRecs.length - 1}
                          className="text-[10px] text-slate-300 hover:text-slate-600 disabled:opacity-20"
                          onClick={() => setPinnedRecs((prev) => {
                            if (recIdx >= prev.length - 1) return prev;
                            const next = [...prev];
                            [next[recIdx], next[recIdx + 1]] = [next[recIdx + 1], next[recIdx]];
                            return next;
                          })}
                        >▼</button>
                      </div>
                      <button
                        type="button"
                        onClick={() => rec.unit_external_id && setSelectedId(rec.unit_external_id)}
                        className="min-w-0 flex-1 px-3 py-3 text-left"
                      >
                        <p className={`truncate text-sm font-semibold ${isSelected ? "text-violet-900" : "text-slate-800"}`}>
                          {rec.project_name ?? "—"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {rec.layout_label ?? "—"}
                          {rec.floor_area_m2 != null ? ` · ${rec.floor_area_m2.toFixed(0)} m²` : ""}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <p className="text-xs font-medium text-slate-700">
                            {formatCurrencyCzk(rec.price_czk ?? null)}
                          </p>
                          {budgetMax != null && (rec.price_czk ?? 0) > budgetMax && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              nad rozpočet
                            </span>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Odebrat z výběru"
                        className="shrink-0 px-2 text-amber-400 hover:text-slate-400"
                        onClick={async () => {
                          if (!token) return;
                          await fetch(`${API_BASE}/clients/${clientId}/recommendations/${rec.rec_id}/pin`, {
                            method: "DELETE",
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          setPinnedRecs((prev) => prev.filter((r) => r.rec_id !== rec.rec_id));
                          if (selectedId === rec.unit_external_id && pinnedRecs.length > 1) {
                            const next = pinnedRecs.find((r) => r.rec_id !== rec.rec_id);
                            if (next?.unit_external_id) setSelectedId(next.unit_external_id);
                          }
                        }}
                      >
                        ★
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ── Right: detail panel ── */}
        <main className="flex-1 overflow-y-auto">
          {pinnedRecs.length === 0 && !recsLoading ? null : unitLoading ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              Načítám detail…
            </div>
          ) : !unit ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              Vyberte jednotku ze seznamu
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">

              {/* Project + identity */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  {developer ?? unit.project?.name}
                </p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">
                  {unit.project?.name ?? "—"}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {unit.availability_status && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${availInfo(unit.availability_status).cls}`}>
                      {availInfo(unit.availability_status).label}
                    </span>
                  )}
                  {selectedRec && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${scoreBadge(selectedRec.score).cls}`}>
                      {scoreBadge(selectedRec.score).label}
                    </span>
                  )}
                </div>
              </div>

              {/* Reserved / sold warning */}
              {(unit.availability_status === "reserved" || unit.availability_status === "sold") && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">
                    {unit.availability_status === "reserved"
                      ? "⚠ Tato jednotka je rezervovaná"
                      : "⚠ Tato jednotka je prodaná"}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    Sdělte klientovi aktuální stav před prezentací.
                  </p>
                </div>
              )}

              {/* Key specs */}
              <div className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-4">
                <div>
                  <p className="text-[11px] font-medium text-slate-400">Dispozice</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatLayout(unit.layout)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-slate-400">Plocha</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatAreaM2(unit.floor_area_m2)}</p>
                </div>
                {(unit.exterior_area_m2 ?? 0) > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-slate-400">Venkovní</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatAreaM2(unit.exterior_area_m2)}</p>
                  </div>
                )}
                {unit.floor != null && (
                  <div>
                    <p className="text-[11px] font-medium text-slate-400">Podlaží</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">{unit.floor}. patro</p>
                  </div>
                )}
              </div>

              {/* Price */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-[11px] font-medium text-slate-400">Cena</p>
                <p className="mt-1 text-3xl font-bold text-slate-900">{formatCurrencyCzk(unit.price_czk)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  {unit.price_per_m2_czk != null && (
                    <span className="text-sm text-slate-500">{formatCurrencyCzk(unit.price_per_m2_czk)} / m²</span>
                  )}
                  {unit.original_price_czk != null && unit.original_price_czk > (unit.price_czk ?? 0) && (
                    <span className="text-sm text-slate-400 line-through">{formatCurrencyCzk(unit.original_price_czk)}</span>
                  )}
                  {budgetMax != null && unit.price_czk != null && unit.price_czk > budgetMax && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      ↑ nad max. rozpočtem ({formatCurrencyCzk(budgetMax)})
                    </span>
                  )}
                </div>
              </div>

              {/* Map */}
              {hasGps && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Poloha</p>
                  <PresentMap
                    lat={gpsLat!}
                    lng={gpsLng!}
                    label={unit.project?.name ?? undefined}
                  />
                </div>
              )}

              {/* Transport */}
              {(rideMin != null || ptMin != null) && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Dostupnost</p>
                  <div className="flex flex-wrap gap-6">
                    {rideMin != null && (
                      <div>
                        <p className="text-[11px] text-slate-400">Autem do centra</p>
                        <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatMinutes(rideMin as number)}</p>
                      </div>
                    )}
                    {ptMin != null && (
                      <div>
                        <p className="text-[11px] text-slate-400">MHD do centra</p>
                        <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatMinutes(ptMin as number)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Standards */}
              {(ac != null || blinds != null || heating != null) && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Vybavení</p>
                  <div className="flex flex-wrap gap-3">
                    {ac != null && (
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${ac ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400 line-through"}`}>
                        Klimatizace
                      </span>
                    )}
                    {blinds != null && blinds !== "false" && blinds !== "0" && (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                        Žaluzie
                      </span>
                    )}
                    {heating && heating !== "—" && (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {heating}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Links */}
              {(unitUrl || projectUrl) && (
                <div className="flex flex-wrap gap-3 pb-2">
                  {unitUrl && (
                    <a
                      href={unitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                    >
                      ↗ Otevřít nabídku
                    </a>
                  )}
                  {projectUrl && projectUrl !== unitUrl && (
                    <a
                      href={projectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      ↗ Web projektu
                    </a>
                  )}
                </div>
              )}

            </div>
          )}
        </main>
      </div>
    </div>
  );
}
