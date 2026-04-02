"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { ReamarCard } from "@/components/ui/reamar-ui";
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
  const [loading, setLoading] = useState(true);

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
        const notes = (notesJson || []) as NoteItem[];
        const recs = (recsJson || []) as RecommendationItem[];

        const all: ActivityEvent[] = [];

        // Client created
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

        // Profile updated
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

        // Notes
        notes.forEach((n) => {
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

        // Recommendations (group by first rec created_at as "batch")
        if (recs.length > 0) {
          all.push({
            id: "recs",
            type: "recommendation",
            label: `Doporučení vygenerována (${recs.length})`,
            timestamp: new Date().toISOString(), // approximation
            icon: "🎯",
            color: "border-emerald-300 bg-emerald-50",
          });
        }

        all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setEvents(all);
      })
      .finally(() => setLoading(false));
  }, [token, clientId]);

  if (loading) return <p className="text-sm text-slate-600 p-6">Načítání…</p>;

  if (events.length === 0) {
    return (
      <ReamarCard className="p-8 text-center">
        <p className="text-sm text-slate-600">Zatím žádná aktivita.</p>
      </ReamarCard>
    );
  }

  return (
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
  );
}
