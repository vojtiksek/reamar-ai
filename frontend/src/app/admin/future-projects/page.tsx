"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ReamarCard, ReamarButton, reamarInputClass, reamarLabelClass } from "@/components/ui/reamar-ui";

type FutureProject = {
  id: number;
  name: string;
  slug: string;
  is_visible: boolean;
  sort_order: number;
  developer: string | null;
  address: string | null;
  stage: string | null;
  total_units: number | null;
  date_sale_start: string | null;
  construction_completion: string | null;
  project_type: string | null;
  url: string | null;
  renovation: boolean | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  city: string | null;
  municipal_district: string | null;
  region: string | null;
  public_data_json: Record<string, unknown> | null;
  internal_data_json: Record<string, unknown> | null;
  interest_count: number;
  created_at: string;
  updated_at: string;
};

type Interest = {
  id: number;
  future_project_id: number;
  client_id: number | null;
  client_name: string | null;
  broker_id: number;
  status: string;
  note: string | null;
  created_at: string;
};

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" };
}

export default function AdminFutureProjectsPage() {
  const [projects, setProjects] = useState<FutureProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FutureProject | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/future-projects?include_hidden=true`, { headers: authHeaders() });
      if (res.ok) setProjects(await res.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchProjects(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Opravdu smazat tento budoucí projekt?")) return;
    await fetch(`${API_BASE}/future-projects/${id}`, { method: "DELETE", headers: authHeaders() });
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (detailId === id) setDetailId(null);
  };

  const handleToggleVisibility = async (fp: FutureProject) => {
    await fetch(`${API_BASE}/future-projects/${fp.id}`, {
      method: "PATCH", headers: authHeaders(),
      body: JSON.stringify({ is_visible: !fp.is_visible }),
    });
    fetchProjects();
  };

  if (loading) return <p className="text-sm text-slate-400">Načítám…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Správa budoucích projektů</h2>
        <div className="flex gap-2">
          <a href="/admin/future-projects/import">
            <ReamarButton variant="secondary" size="sm">Import CSV</ReamarButton>
          </a>
          <ReamarButton variant="primary" size="sm" onClick={() => { setCreating(true); setEditing(null); setDetailId(null); }}>
            + Nový projekt
          </ReamarButton>
        </div>
      </div>

      {(creating || editing) && (
        <ProjectForm
          project={editing}
          onSave={() => { setCreating(false); setEditing(null); fetchProjects(); }}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      )}

      {projects.length === 0 && !creating && (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-500">Žádné budoucí projekty. Vytvořte první.</p>
        </ReamarCard>
      )}

      <div className="grid gap-2">
        {projects.map((fp) => (
          <ReamarCard key={fp.id} className="flex items-center justify-between p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-slate-800 truncate">{fp.name}</p>
                {!fp.is_visible && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Skrytý</span>}
                {fp.renovation && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Rekonstrukce</span>}
              </div>
              <p className="text-xs text-slate-500">
                {fp.developer && <span className="mr-2">{fp.developer}</span>}
                {fp.city && <span className="mr-2">{fp.city}</span>}
                {fp.stage && <span className="mr-2">· {fp.stage}</span>}
                · pořadí: {fp.sort_order} · {fp.interest_count} zájemců
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" onClick={() => { setDetailId(detailId === fp.id ? null : fp.id); setEditing(null); setCreating(false); }}>
                {detailId === fp.id ? "Zavřít" : "Detail"}
              </button>
              <button className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" onClick={() => { setEditing(fp); setCreating(false); setDetailId(null); }}>
                Upravit
              </button>
              <button className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" onClick={() => handleToggleVisibility(fp)}>
                {fp.is_visible ? "Skrýt" : "Zobrazit"}
              </button>
              <button className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50" onClick={() => handleDelete(fp.id)}>
                Smazat
              </button>
            </div>
          </ReamarCard>
        ))}
      </div>

      {detailId && <ProjectDetail projectId={detailId} />}
    </div>
  );
}

/* --- Create / Edit form --- */

const STAGE_OPTIONS = ["Příprava", "Povolování", "Výstavba", "Dokončeno"];
const TYPE_OPTIONS = ["Bytový dům", "Viladům", "Rodinné domy", "Polyfunkční", "Jiné"];

function ProjectForm({ project, onSave, onCancel }: { project: FutureProject | null; onSave: () => void; onCancel: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [slug, setSlug] = useState(project?.slug ?? "");
  const [sortOrder, setSortOrder] = useState(project?.sort_order ?? 0);
  const [developer, setDeveloper] = useState(project?.developer ?? "");
  const [address, setAddress] = useState(project?.address ?? "");
  const [stage, setStage] = useState(project?.stage ?? "");
  const [totalUnits, setTotalUnits] = useState<string>(project?.total_units?.toString() ?? "");
  const [dateSaleStart, setDateSaleStart] = useState(project?.date_sale_start ?? "");
  const [constructionCompletion, setConstructionCompletion] = useState(project?.construction_completion ?? "");
  const [projectType, setProjectType] = useState(project?.project_type ?? "");
  const [url, setUrl] = useState(project?.url ?? "");
  const [renovation, setRenovation] = useState(project?.renovation ?? false);
  const [gpsLat, setGpsLat] = useState(project?.gps_latitude?.toString() ?? "");
  const [gpsLng, setGpsLng] = useState(project?.gps_longitude?.toString() ?? "");
  const [city, setCity] = useState(project?.city ?? "");
  const [municipalDistrict, setMunicipalDistrict] = useState(project?.municipal_district ?? "");
  const [region, setRegion] = useState(project?.region ?? "");

  // public_data_json fields
  const pub = project?.public_data_json ?? {};
  const [transportRating, setTransportRating] = useState((pub.transport_rating as string) ?? "");
  const [rideToCenter, setRideToCenter] = useState((pub.ride_to_center as string) ?? "");
  const [ptToCenter, setPtToCenter] = useState((pub.public_transport_to_center as string) ?? "");
  const [cooperative, setCooperative] = useState((pub.cooperative_housing as boolean) ?? false);
  const [buildingUse, setBuildingUse] = useState((pub.building_use as string) ?? "");
  const [standardsRating, setStandardsRating] = useState((pub.standards_rating as string) ?? "");
  const [overallQuality, setOverallQuality] = useState((pub.overall_quality as string) ?? "");

  // internal_data_json fields
  const int_ = project?.internal_data_json ?? {};
  const [permitRegular, setPermitRegular] = useState((int_.permit_regular as string) ?? "");
  const [paymentConstruction, setPaymentConstruction] = useState((int_.payment_construction as string) ?? "");
  const [paymentContract, setPaymentContract] = useState((int_.payment_contract as string) ?? "");
  const [paymentOccupancy, setPaymentOccupancy] = useState((int_.payment_occupancy as string) ?? "");
  const [postalCode, setPostalCode] = useState((int_.postal_code as string) ?? "");
  const [adminDistrict, setAdminDistrict] = useState((int_.administrative_district as string) ?? "");
  const [cadastralArea, setCadastralArea] = useState((int_.cadastral_area as string) ?? "");
  const [districtOkres, setDistrictOkres] = useState((int_.district_okres as string) ?? "");

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const publicData: Record<string, unknown> = {};
    if (transportRating) publicData.transport_rating = transportRating;
    if (rideToCenter) publicData.ride_to_center = rideToCenter;
    if (ptToCenter) publicData.public_transport_to_center = ptToCenter;
    if (cooperative) publicData.cooperative_housing = true;
    if (buildingUse) publicData.building_use = buildingUse;
    if (standardsRating) publicData.standards_rating = standardsRating;
    if (overallQuality) publicData.overall_quality = overallQuality;

    const internalData: Record<string, unknown> = {};
    if (permitRegular) internalData.permit_regular = permitRegular;
    if (paymentConstruction) internalData.payment_construction = paymentConstruction;
    if (paymentContract) internalData.payment_contract = paymentContract;
    if (paymentOccupancy) internalData.payment_occupancy = paymentOccupancy;
    if (postalCode) internalData.postal_code = postalCode;
    if (adminDistrict) internalData.administrative_district = adminDistrict;
    if (cadastralArea) internalData.cadastral_area = cadastralArea;
    if (districtOkres) internalData.district_okres = districtOkres;

    const payload: Record<string, unknown> = {
      name,
      slug: slug || undefined,
      sort_order: sortOrder,
      developer: developer || null,
      address: address || null,
      stage: stage || null,
      total_units: totalUnits ? parseInt(totalUnits) : null,
      date_sale_start: dateSaleStart || null,
      construction_completion: constructionCompletion || null,
      project_type: projectType || null,
      url: url || null,
      renovation: renovation || null,
      gps_latitude: gpsLat ? parseFloat(gpsLat) : null,
      gps_longitude: gpsLng ? parseFloat(gpsLng) : null,
      city: city || null,
      municipal_district: municipalDistrict || null,
      region: region || null,
      public_data_json: Object.keys(publicData).length > 0 ? publicData : null,
      internal_data_json: Object.keys(internalData).length > 0 ? internalData : null,
    };

    const apiUrl = project ? `${API_BASE}/future-projects/${project.id}` : `${API_BASE}/future-projects`;
    const method = project ? "PATCH" : "POST";
    await fetch(apiUrl, { method, headers: authHeaders(), body: JSON.stringify(payload) });
    setSaving(false);
    onSave();
  };

  const inputCls = reamarInputClass;
  const labelCls = reamarLabelClass;

  return (
    <ReamarCard className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{project ? "Upravit projekt" : "Nový budoucí projekt"}</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Basic info */}
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-500">Základní údaje</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
              <label className={labelCls}>Název *</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Slug (URL)</label>
              <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto z názvu" />
            </div>
            <div>
              <label className={labelCls}>Pořadí</label>
              <input className={inputCls} type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
            </div>
            <div>
              <label className={labelCls}>Developer</label>
              <input className={inputCls} value={developer} onChange={(e) => setDeveloper(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Typ projektu</label>
              <select className={inputCls} value={projectType} onChange={(e) => setProjectType(e.target.value)}>
                <option value="">—</option>
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>URL</label>
              <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" checked={renovation} onChange={(e) => setRenovation(e.target.checked)} className="rounded border-slate-300" />
                Rekonstrukce
              </label>
            </div>
          </div>
        </fieldset>

        {/* Location */}
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-500">Lokalita</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
              <label className={labelCls}>Adresa</label>
              <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Město</label>
              <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Městská část</label>
              <input className={inputCls} value={municipalDistrict} onChange={(e) => setMunicipalDistrict(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Kraj</label>
              <input className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>GPS šířka</label>
              <input className={inputCls} value={gpsLat} onChange={(e) => setGpsLat(e.target.value)} placeholder="50.0755" />
            </div>
            <div>
              <label className={labelCls}>GPS délka</label>
              <input className={inputCls} value={gpsLng} onChange={(e) => setGpsLng(e.target.value)} placeholder="14.4378" />
            </div>
          </div>
        </fieldset>

        {/* Timeline */}
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-500">Stav a termíny</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={labelCls}>Fáze</label>
              <select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">—</option>
                {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Celkem jednotek</label>
              <input className={inputCls} type="number" value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Zahájení prodeje</label>
              <input className={inputCls} value={dateSaleStart} onChange={(e) => setDateSaleStart(e.target.value)} placeholder="Q3 2026" />
            </div>
            <div>
              <label className={labelCls}>Dokončení</label>
              <input className={inputCls} value={constructionCompletion} onChange={(e) => setConstructionCompletion(e.target.value)} placeholder="Q4 2027" />
            </div>
          </div>
        </fieldset>

        {/* Public data */}
        <fieldset className="rounded-lg border border-blue-100 p-3">
          <legend className="px-1 text-xs font-semibold text-blue-600">Veřejná data</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Dopravní hodnocení</label>
              <input className={inputCls} value={transportRating} onChange={(e) => setTransportRating(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Autem do centra (min)</label>
              <input className={inputCls} value={rideToCenter} onChange={(e) => setRideToCenter(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>MHD do centra (min)</label>
              <input className={inputCls} value={ptToCenter} onChange={(e) => setPtToCenter(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Účel budovy</label>
              <input className={inputCls} value={buildingUse} onChange={(e) => setBuildingUse(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Hodnocení standardů</label>
              <input className={inputCls} value={standardsRating} onChange={(e) => setStandardsRating(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Celková kvalita</label>
              <input className={inputCls} value={overallQuality} onChange={(e) => setOverallQuality(e.target.value)} />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" checked={cooperative} onChange={(e) => setCooperative(e.target.checked)} className="rounded border-slate-300" />
                Družstevní bydlení
              </label>
            </div>
          </div>
        </fieldset>

        {/* Internal data */}
        <fieldset className="rounded-lg border border-amber-100 p-3">
          <legend className="px-1 text-xs font-semibold text-amber-600">Interní data</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={labelCls}>Povolení (řádné)</label>
              <input className={inputCls} value={permitRegular} onChange={(e) => setPermitRegular(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Platba výstavba (%)</label>
              <input className={inputCls} value={paymentConstruction} onChange={(e) => setPaymentConstruction(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Platba smlouva (%)</label>
              <input className={inputCls} value={paymentContract} onChange={(e) => setPaymentContract(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Platba kolaudace (%)</label>
              <input className={inputCls} value={paymentOccupancy} onChange={(e) => setPaymentOccupancy(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>PSČ</label>
              <input className={inputCls} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Správní obvod</label>
              <input className={inputCls} value={adminDistrict} onChange={(e) => setAdminDistrict(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Katastrální území</label>
              <input className={inputCls} value={cadastralArea} onChange={(e) => setCadastralArea(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Okres</label>
              <input className={inputCls} value={districtOkres} onChange={(e) => setDistrictOkres(e.target.value)} />
            </div>
          </div>
        </fieldset>

        <div className="flex gap-2">
          <ReamarButton variant="primary" size="sm" type="submit" disabled={saving}>{saving ? "Ukládám…" : project ? "Uložit" : "Vytvořit"}</ReamarButton>
          <ReamarButton variant="ghost" size="sm" type="button" onClick={onCancel}>Zrušit</ReamarButton>
        </div>
      </form>
    </ReamarCard>
  );
}

/* --- Detail / Interests panel --- */

function ProjectDetail({ projectId }: { projectId: number }) {
  const [interests, setInterests] = useState<Interest[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchInterests = async () => {
    setLoading(true);
    const res = await fetch(`${API_BASE}/future-projects/${projectId}/interests`, { headers: authHeaders() });
    if (res.ok) setInterests(await res.json());
    setLoading(false);
  };

  useEffect(() => { fetchInterests(); }, [projectId]);

  const handleAdd = async () => {
    setAdding(true);
    await fetch(`${API_BASE}/future-projects/${projectId}/interests`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ note: note || null }),
    });
    setNote("");
    setAdding(false);
    fetchInterests();
  };

  const handleDelete = async (id: number) => {
    await fetch(`${API_BASE}/future-projects/${projectId}/interests/${id}`, { method: "DELETE", headers: authHeaders() });
    setInterests((prev) => prev.filter((i) => i.id !== id));
  };

  return (
    <ReamarCard className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Zájemci</h3>

      <div className="mb-3 flex gap-2">
        <input className={reamarInputClass + " flex-1"} placeholder="Poznámka k zájmu…" value={note} onChange={(e) => setNote(e.target.value)} />
        <ReamarButton variant="secondary" size="sm" onClick={handleAdd} disabled={adding}>
          + Přidat zájem
        </ReamarButton>
      </div>

      {loading && <p className="text-xs text-slate-400">Načítám…</p>}

      {!loading && interests.length === 0 && (
        <p className="text-xs text-slate-400">Zatím žádní zájemci.</p>
      )}

      <div className="space-y-1.5">
        {interests.map((i) => (
          <div key={i.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div>
              <p className="text-sm text-slate-700">
                {i.client_name ?? "Bez klienta"}
                <span className="ml-2 text-xs text-slate-400">{i.status}</span>
              </p>
              {i.note && <p className="text-xs text-slate-500">{i.note}</p>}
              <p className="text-[10px] text-slate-400">{new Date(i.created_at).toLocaleDateString("cs")}</p>
            </div>
            <button className="text-xs text-rose-500 hover:text-rose-700" onClick={() => handleDelete(i.id)}>Odebrat</button>
          </div>
        ))}
      </div>
    </ReamarCard>
  );
}
