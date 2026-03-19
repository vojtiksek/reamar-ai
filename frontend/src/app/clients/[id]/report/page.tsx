"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

type RecItem = {
  rec_id: number;
  pinned_by_broker: boolean;
  unit_external_id: string | null;
  project_id: number | null;
  project_name?: string | null;
  layout?: string | null;
  layout_label?: string | null;
  floor_area_m2?: number | null;
  exterior_area_m2?: number | null;
  price_czk?: number | null;
  price_per_m2_czk?: number | null;
  floor?: number | null;
  district?: string | null;
  score: number;
  budget_fit: number;
  walkability_fit: number;
  location_fit: number;
  layout_fit: number;
  area_fit: number;
  outdoor_fit: number;
  distance_to_tram_stop_m?: number | null;
  distance_to_metro_station_m?: number | null;
  distance_to_bus_stop_m?: number | null;
};

type ClientInfo = { id: number; name: string };

type ProjectInfo = {
  id: number;
  name: string;
  image_url?: string | null;
  address?: string | null;
  completion_date?: string | null;
  energy_class?: string | null;
  walkability_score?: number | null;
  walkability_label?: string | null;
};

type UnitInfo = {
  external_id: string;
  floorplan_url?: string | null;
  data?: Record<string, unknown>;
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 }).format(n);
}

/** Build a self-contained HTML string for the PDF report */
function buildReportHtml(
  client: ClientInfo,
  recs: RecItem[],
  projects: Map<number, ProjectInfo>,
  units: Map<string, UnitInfo>,
): string {
  const date = new Date().toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });

  const cards = recs.map((r, idx) => {
    const proj = r.project_id ? projects.get(r.project_id) : null;
    const unit = r.unit_external_id ? units.get(r.unit_external_id) : null;
    const imageUrl = proj?.image_url;
    const floorplanUrl = unit?.floorplan_url || (unit?.data?.floorplan_url as string | undefined);

    const images = [
      imageUrl ? `<div><p class="label">Foto projektu</p><img src="${imageUrl}" style="width:100%;height:180px;object-fit:cover;border-radius:8px;" /></div>` : "",
      floorplanUrl ? `<div><p class="label">Půdorys</p><img src="${floorplanUrl}" style="width:100%;height:180px;object-fit:contain;background:#f8fafc;border-radius:8px;" /></div>` : "",
    ].filter(Boolean);

    const transport = [
      r.distance_to_metro_station_m != null ? `Metro: ${Math.round(r.distance_to_metro_station_m)} m` : "",
      r.distance_to_tram_stop_m != null ? `Tramvaj: ${Math.round(r.distance_to_tram_stop_m)} m` : "",
      r.distance_to_bus_stop_m != null ? `Bus: ${Math.round(r.distance_to_bus_stop_m)} m` : "",
    ].filter(Boolean);

    const details = [
      { label: "Plocha", value: r.floor_area_m2 != null ? `${r.floor_area_m2} m²` : "—" },
      { label: "Venkovní plocha", value: r.exterior_area_m2 != null ? `${r.exterior_area_m2} m²` : "—" },
      { label: "Patro", value: r.floor ?? "—" },
      { label: "Lokalita", value: r.district ?? "—" },
      ...(proj?.completion_date ? [{ label: "Dokončení", value: new Date(proj.completion_date).toLocaleDateString("cs-CZ") }] : []),
      ...(proj?.energy_class ? [{ label: "Energetická třída", value: proj.energy_class }] : []),
      ...(proj?.walkability_label ? [{ label: "Walkability", value: `${proj.walkability_label} (${proj.walkability_score})` }] : []),
    ];

    return `
      <div class="card" ${idx > 0 ? 'style="page-break-before:always;"' : ""}>
        <div class="card-header">
          <div>
            <h2>${r.project_name ?? "Projekt"}</h2>
            <p class="subtitle">Jednotka ${r.unit_external_id ?? "—"} · ${r.layout ?? r.layout_label ?? "—"}</p>
            ${proj?.address ? `<p class="address">${proj.address}</p>` : ""}
          </div>
          <div class="price-block">
            <p class="price">${fmt(r.price_czk)}</p>
            <p class="price-m2">${fmt(r.price_per_m2_czk)}/m²</p>
          </div>
        </div>
        ${images.length > 0 ? `<div class="images">${images.join("")}</div>` : ""}
        <div class="details">
          ${details.map((d) => `<div><p class="label">${d.label}</p><p class="value">${d.value}</p></div>`).join("")}
        </div>
        ${transport.length > 0 ? `<p class="transport">${transport.join(" · ")}</p>` : ""}
        <div class="score-bar">
          <span class="score-label">Shoda:</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.round(r.score))}%"></div></div>
          <span class="score-value">${Math.round(r.score)} b.</span>
        </div>
      </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<title>Doporučení – ${client.name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; background: #fff; padding: 32px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 700; }
  .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px; }
  .header .meta { font-size: 13px; color: #64748b; margin-top: 4px; }
  .header .date { font-size: 11px; color: #94a3b8; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 24px; margin-bottom: 24px; }
  .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .card-header h2 { font-size: 17px; font-weight: 700; }
  .card-header .subtitle { font-size: 13px; color: #64748b; }
  .card-header .address { font-size: 11px; color: #94a3b8; }
  .price-block { text-align: right; }
  .price { font-size: 20px; font-weight: 700; }
  .price-m2 { font-size: 11px; color: #94a3b8; }
  .images { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 2px; }
  .value { font-size: 13px; font-weight: 500; }
  .details { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 20px; }
  .transport { margin-top: 10px; font-size: 11px; color: #64748b; }
  .score-bar { display: flex; align-items: center; gap: 10px; margin-top: 14px; background: #f8fafc; border-radius: 8px; padding: 10px; }
  .score-label { font-size: 11px; font-weight: 600; color: #64748b; }
  .bar-track { flex: 1; height: 10px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; background: #6366f1; border-radius: 999px; }
  .score-value { font-size: 13px; font-weight: 700; }
  .footer { margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 12px; text-align: center; font-size: 11px; color: #94a3b8; }
  @media print {
    body { padding: 0; }
    .card { break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>Doporučené nemovitosti</h1>
    <p class="meta">Připraveno pro: <strong>${client.name}</strong></p>
    <p class="date">${date}</p>
  </div>
  ${cards}
  <div class="footer">Generováno aplikací Reamar · ${date}</div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const clientId = id;

  const [client, setClient] = useState<ClientInfo | null>(null);
  const [recs, setRecs] = useState<RecItem[]>([]);
  const [projects, setProjects] = useState<Map<number, ProjectInfo>>(new Map());
  const [units, setUnits] = useState<Map<string, UnitInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    if (!token || !clientId) return;

    Promise.all([
      fetch(`${API_BASE}/clients/${clientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : [])),
    ]).then(async ([clientJson, recsJson]) => {
      setClient(clientJson);
      const pinned = (recsJson as RecItem[]).filter((r) => r.pinned_by_broker);
      setRecs(pinned);

      const projectIds = [...new Set(pinned.map((r) => r.project_id).filter(Boolean))] as number[];
      const unitIds = pinned.map((r) => r.unit_external_id).filter(Boolean) as string[];

      const projMap = new Map<number, ProjectInfo>();
      const unitMap = new Map<string, UnitInfo>();

      await Promise.all([
        ...projectIds.map((pid) =>
          fetch(`${API_BASE}/projects/${pid}`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d) projMap.set(pid, d); })
        ),
        ...unitIds.slice(0, 20).map((eid) =>
          fetch(`${API_BASE}/units/${encodeURIComponent(eid)}`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d) unitMap.set(eid, d); })
        ),
      ]);

      setProjects(projMap);
      setUnits(unitMap);
      setLoading(false);
    });
  }, [clientId]);

  const handleSavePdf = () => {
    if (!client) return;
    setGenerating(true);
    const html = buildReportHtml(client, recs, projects, units);
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
    setGenerating(false);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Načítání dat…</div>;
  }

  if (!client || recs.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500">
        Žádné pinnuté doporučení k exportu. Nejdřív přidejte jednotky do výběru (★).
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl bg-white p-8" style={{ minHeight: "100vh" }}>
      <div className="mb-8 border-b-2 border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Doporučené nemovitosti</h1>
        <p className="mt-1 text-sm text-slate-600">
          Připraveno pro: <strong>{client.name}</strong> · {recs.length} jednotek
        </p>
      </div>

      <button
        type="button"
        onClick={handleSavePdf}
        disabled={generating}
        className="mb-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {generating ? "Generuji…" : "Uložit jako PDF"}
      </button>
      <p className="mb-8 text-xs text-slate-400">
        Otevře se nové okno s reportem. V tiskovém dialogu zvolte &quot;Uložit jako PDF&quot;.
      </p>

      {/* Preview */}
      <div className="space-y-4">
        {recs.map((r) => (
          <div key={r.rec_id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{r.project_name}</p>
              <p className="text-xs text-slate-500">
                {r.unit_external_id} · {r.layout ?? r.layout_label ?? "—"} · {r.floor_area_m2 ?? "—"} m²
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-900">{fmt(r.price_czk)}</p>
              <p className="text-xs text-slate-500">Shoda: {Math.round(r.score)} b.</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
