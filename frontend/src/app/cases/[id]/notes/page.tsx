"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { ReamarCard, ReamarButton } from "@/components/ui/reamar-ui";
import type { NoteItem } from "@/lib/caseTypes";

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

export default function NotesPage() {
  const params = useParams();
  const clientId = Number(params?.id);
  const [token, setToken] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBody, setNewBody] = useState("");
  const [newType, setNewType] = useState<"internal" | "meeting" | "call">("internal");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    setToken(t);
  }, []);

  const fetchNotes = () => {
    if (!token || !clientId) return;
    fetch(`${API_BASE}/clients/${clientId}/notes`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setNotes(data as NoteItem[]));
  };

  useEffect(() => {
    if (!token || !clientId) return;
    setLoading(true);
    fetchNotes();
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, clientId]);

  const handleAdd = async () => {
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
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (noteId: number) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/clients/${clientId}/notes/${noteId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    }
  };

  if (loading) return <p className="text-sm text-slate-600 p-6">Načítání…</p>;

  return (
    <div className="space-y-6">
      {/* New note form */}
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
              onClick={handleAdd}
              disabled={saving || !newBody.trim()}
            >
              {saving ? "Ukládám…" : "Přidat poznámku"}
            </ReamarButton>
          </div>
        </div>
      </ReamarCard>

      {/* Notes list */}
      {notes.length === 0 ? (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-600 italic">Zatím žádné poznámky.</p>
        </ReamarCard>
      ) : (
        <div className="space-y-2">
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
                  onClick={() => handleDelete(n.id)}
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
    </div>
  );
}
