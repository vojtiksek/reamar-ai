"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { ReamarCard, ReamarButton } from "@/components/ui/reamar-ui";
import type { ClientSummary, NoteItem, RecommendationItem } from "@/lib/caseTypes";

type ActivityEvent = {
  id: string;
  type: "created" | "note" | "recommendation" | "profile_updated";
  label: string;
  detail?: string;
  timestamp: string;
  icon: string;
  color: string;
};

const NOTE_TYPE_LABELS: Record<string, string> = {
  internal: "Poznámka",
  meeting: "Schůzka",
  call: "Hovor",
};

const NOTE_TYPE_COLORS: Record<string, string> = {
  internal: "bg-slate-100 text-slate-700",
  meeting: "bg-violet-100 text-violet-700",
  call: "bg-amber-100 text-amber-700",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("cs-CZ", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ActivityPage() {
  const params = useParams();
  const clientId = Number(params?.id);
  const [token, setToken] = useState<string | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBody, setNewBody] = useState("");
  const [newType, setNewType] = useState<"internal" | "meeting" | "call">("internal");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    setToken(t);
  }, []);

  useEffect(() => {
    if (!token || !clientId) return;
    setLoading(true);

    Promise.all([
      fetch(`${API_BASE}/clients/${clientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/clients/${clientId}/notes`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([clientJson, notesJson, recsJson]) => {
        const client = clientJson as ClientSummary | null;
        const notesArr = (notesJson || []) as NoteItem[];
        const recs = (recsJson || []) as RecommendationItem[];

        setNotes(notesArr);

        const all: ActivityEvent[] = [];

        if (client?.created_at) {
          all.push({
            id: "created",
            type: "created",
            label: "Klient vytvořen",
            detail: client.name,
            timestamp: client.created_at,
            icon: "👤",
            color: "border-blue-300 bg-blue-50",
          });
        }

        if (client?.updated_at && client.updated_at !== client.created_at) {
          all.push({
            id: "profile_updated",
            type: "profile_updated",
            label: "Profil upraven",
            timestamp: client.updated_at,
            icon: "✏️",
            color: "border-slate-300 bg-slate-50",
          });
        }

        notesArr.forEach((n) => {
          const typeLabel =
            n.note_type === "meeting" ? "Schůzka" : n.note_type === "call" ? "Hovor" : "Poznámka";
          all.push({
            id: `note-${n.id}`,
            type: "note",
            label: `${typeLabel} přidána`,
            detail: n.body.length > 120 ? n.body.slice(0, 120) + "…" : n.body,
            timestamp: n.created_at,
            icon: n.note_type === "meeting" ? "🤝" : n.note_type === "call" ? "📞" : "📝",
            color:
              n.note_type === "meeting"
                ? "border-violet-300 bg-violet-50"
                : n.note_type === "call"
                ? "border-amber-300 bg-amber-50"
                : "border-slate-300 bg-slate-50",
          });
        });

        if (recs.length > 0) {
          all.push({
            id: "recs",
            type: "recommendation",
            label: `Doporučení vygenerována (${recs.length})`,
            timestamp: new Date().toISOString(),
            icon: "🎯",
            color: "border-emerald-300 bg-emerald-50",
          });
        }

        all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setEvents(all);
      })
      .finally(() => setLoading(false));
  }, [token, clientId]);

  const handleAddNote = async () => {
    if (!token || !newBody.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/notes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ note_type: newType, body: newBody.trim() }),
      });
      if (res.ok) {
        const note = (await res.json()) as NoteItem;
        setNotes((prev) => [note, ...prev]);
        setNewBody("");
        // Add to timeline
        const typeLabel =
          newType === "meeting" ? "Schůzka" : newType === "call" ? "Hovor" : "Poznámka";
        const newEvent: ActivityEvent = {
          id: `note-${note.id}`,
          type: "note",
          label: `${typeLabel} přidána`,
          detail: note.body.length > 120 ? note.body.slice(0, 120) + "…" : note.body,
          timestamp: note.created_at,
          icon: newType === "meeting" ? "🤝" : newType === "call" ? "📞" : "📝",
          color:
            newType === "meeting"
              ? "border-violet-300 bg-violet-50"
              : newType === "call"
              ? "border-amber-300 bg-amber-50"
              : "border-slate-300 bg-slate-50",
        };
        setEvents((prev) => [newEvent, ...prev]);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/clients/${clientId}/notes/${noteId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setEvents((prev) => prev.filter((e) => e.id !== `note-${noteId}`));
    }
  };

  if (loading) return <p className="text-sm text-slate-600 p-6">Načítání…</p>;

  return (
    <div className="space-y-6">
      {/* ── Poznámky ─────────────────────────────────────────── */}
      <ReamarCard className="p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-3">
          Nová poznámka
        </h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-600">Typ:</label>
            <div className="flex gap-1">
              {(["internal", "meeting", "call"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewType(t)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    newType === t
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {NOTE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <textarea
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
            rows={3}
            placeholder="Napište poznámku…"
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
          />
          <div className="flex justify-end">
            <ReamarButton
              variant="primary"
              size="sm"
              onClick={handleAddNote}
              disabled={saving || !newBody.trim()}
            >
              {saving ? "Ukládám…" : "Přidat poznámku"}
            </ReamarButton>
          </div>
        </div>
      </ReamarCard>

      {notes.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 px-1">
            Poznámky ({notes.length})
          </p>
          {notes.map((n) => (
            <ReamarCard key={n.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        NOTE_TYPE_COLORS[n.note_type] || NOTE_TYPE_COLORS.internal
                      }`}
                    >
                      {NOTE_TYPE_LABELS[n.note_type] || n.note_type}
                    </span>
                    <span className="text-[11px] text-slate-400">{formatDate(n.created_at)}</span>
                  </div>
                  <p className="text-sm text-slate-900 whitespace-pre-wrap">{n.body}</p>
                </div>
                <button
                  onClick={() => handleDeleteNote(n.id)}
                  className="shrink-0 text-xs text-slate-400 hover:text-rose-500"
                  title="Smazat poznámku"
                >
                  ✕
                </button>
              </div>
            </ReamarCard>
          ))}
        </div>
      )}

      {/* ── Aktivita (timeline) ───────────────────────────────── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 px-1 mb-2">
          Aktivita
        </p>
        {events.length === 0 ? (
          <ReamarCard className="p-8 text-center">
            <p className="text-sm text-slate-600">Zatím žádná aktivita.</p>
          </ReamarCard>
        ) : (
          <div className="space-y-1">
            {events.map((ev) => (
              <div key={ev.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${ev.color}`}>
                <span className="text-lg">{ev.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{ev.label}</p>
                  {ev.detail && <p className="text-xs text-slate-600 mt-0.5">{ev.detail}</p>}
                  <p className="text-[11px] text-slate-400 mt-1">{formatDate(ev.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
