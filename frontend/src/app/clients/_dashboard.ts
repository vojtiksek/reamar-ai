export type DashboardClient = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  recommendations_count: number;
  unseen_matches: number;
  last_note_at?: string | null;
  days_since_last_note?: number | null;
  has_profile: boolean;
  priority: "high" | "medium" | "normal";
};

export type Filter = "all" | "attention" | "has_recs" | "new";

export function stageFromClient(c: DashboardClient): { label: string; cls: string } {
  if (!c.has_profile) return { label: "Nový", cls: "bg-slate-100 text-slate-700" };
  if (c.recommendations_count === 0)
    return { label: "Zadání hotové", cls: "bg-blue-100 text-blue-800" };
  if (c.recommendations_count > 0 && c.status !== "shortlist")
    return { label: "Doporučení", cls: "bg-indigo-100 text-indigo-800" };
  return { label: "Užší výběr", cls: "bg-emerald-100 text-emerald-800" };
}

export function nextAction(c: DashboardClient): string {
  if (!c.has_profile) return "Doplnit zadání";
  if (c.recommendations_count === 0) return "Vygenerovat doporučení";
  if (c.status === "shortlist") return "Výběr";
  return "Doporučení";
}

export function nextRoute(c: DashboardClient): string {
  if (!c.has_profile) return `/cases/${c.id}/brief`;
  if (c.recommendations_count === 0) return `/cases/${c.id}/recommendations`;
  if (c.status === "shortlist") return `/cases/${c.id}/shortlist`;
  return `/cases/${c.id}/overview`;
}

export function priorityLabel(c: DashboardClient): string {
  if (c.priority === "high") return "Teď řešit";
  if (c.priority === "medium") return "Ke kontrole";
  return "Bez urgence";
}

export function statusTone(c: DashboardClient): string {
  if (c.priority === "high") return "text-rose-700";
  if (c.priority === "medium") return "text-amber-700";
  return "text-slate-500";
}

export function lastTouchLabel(c: DashboardClient): string {
  if (c.last_note_at)
    return `Poznámka ${new Date(c.last_note_at).toLocaleDateString("cs-CZ")}`;
  return `Vytvořen ${new Date(c.created_at).toLocaleDateString("cs-CZ")}`;
}

export function statusLabel(c: DashboardClient): string {
  if (!c.has_profile) return "Čeká na brief";
  if (c.recommendations_count === 0) return "Bez doporučení";
  return "Aktivní";
}

export function isStale(c: DashboardClient): boolean {
  return (c.days_since_last_note ?? 0) > 14;
}

export function sortByPriority(list: DashboardClient[]): DashboardClient[] {
  const score = (c: DashboardClient) =>
    (c.priority === "high" ? 3 : c.priority === "medium" ? 2 : 1) * 100 +
    (c.recommendations_count || 0);
  return [...list].sort((a, b) => score(b) - score(a));
}

export function applyFilter(list: DashboardClient[], filter: Filter): DashboardClient[] {
  if (filter === "attention")
    return list.filter((c) => c.priority === "high" || c.priority === "medium");
  if (filter === "has_recs") return list.filter((c) => c.recommendations_count > 0);
  if (filter === "new") return list.filter((c) => !c.has_profile);
  return list;
}
