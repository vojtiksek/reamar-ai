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
        <ReamarButton variant="primary" size="sm" onClick={() => { setCreating(true); setEditing(null); setDetailId(null); }}>
          + Nový projekt
        </ReamarButton>
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
              </div>
              <p className="text-xs text-slate-500">
                slug: {fp.slug} · pořadí: {fp.sort_order} · {fp.interest_count} zájemců
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

function ProjectForm({ project, onSave, onCancel }: { project: FutureProject | null; onSave: () => void; onCancel: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [slug, setSlug] = useState(project?.slug ?? "");
  const [sortOrder, setSortOrder] = useState(project?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = project ? `${API_BASE}/future-projects/${project.id}` : `${API_BASE}/future-projects`;
    const method = project ? "PATCH" : "POST";
    await fetch(url, { method, headers: authHeaders(), body: JSON.stringify({ name, slug: slug || undefined, sort_order: sortOrder }) });
    setSaving(false);
    onSave();
  };

  return (
    <ReamarCard className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{project ? "Upravit projekt" : "Nový budoucí projekt"}</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className={reamarLabelClass}>Název</label>
          <input className={reamarInputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={reamarLabelClass}>Slug (URL)</label>
            <input className={reamarInputClass} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto z názvu" />
          </div>
          <div className="w-24">
            <label className={reamarLabelClass}>Pořadí</label>
            <input className={reamarInputClass} type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
        </div>
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
