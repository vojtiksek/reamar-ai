"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { API_BASE } from "@/lib/api";
import { formatCurrencyCzk } from "@/lib/format";
import { ReamarCard } from "@/components/ui/reamar-ui";

// ── Types ──────────────────────────────────────────────────────────────

type Feedback = {
  feedback_type: string;
  dislike_reason: string | null;
  note: string | null;
  updated_at: string;
};

type Rec = {
  rec_id: number;
  project_id: number | null;
  project_name: string | null;
  unit_external_id: string | null;
  layout: string | null;
  layout_label: string | null;
  floor_area_m2: number | null;
  exterior_area_m2: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  floor: number | null;
  score: number | null;
  top_strengths: string[];
  top_compromises: string[];
  district: string | null;
  project_lat: number | null;
  project_lng: number | null;
  // Standards / features (booleans)
  has_recuperation: boolean;
  has_air_conditioning: boolean;
  has_floor_heating: boolean;
  has_exterior_blinds: boolean;
  has_parking: boolean;
  has_smart_home: boolean;
  // Standards / features (enum values)
  heating: string | null;
  heating_source: string | null;
  windows: string | null;
  partition_walls: string | null;
  flooring: string | null;
  orientation: string | null;
  cooling: string | null;
  energy_class: string | null;
  // Project amenities
  has_bike_room: boolean;
  has_stroller_room: boolean;
  has_fitness: boolean;
  has_courtyard_garden: boolean;
  has_reception: boolean;
  has_concierge: boolean;
  // Noise distances
  distance_to_primary_road_m: number | null;
  distance_to_tram_tracks_m: number | null;
  distance_to_railway_m: number | null;
  feedback: Feedback | null;
  // Broker curation metadata
  pinned_by_broker: boolean;
  shortlist_order: number | null;
  shortlist_reason: string | null;
  shortlist_role: string | null;
  // Project metadata
  construction_completion: string | null;
  project_url: string | null;
};

type ProjectGroup = {
  project_id: number | null;
  project_name: string;
  district: string | null;
  units: Rec[];
  best_score: number;
  price_range: [number | null, number | null];
  area_range: [number | null, number | null];
  ext_area_range: [number | null, number | null];
  layouts: string[];
  liked_count: number;
  disliked_count: number;
  project_lat: number | null;
  project_lng: number | null;
  best_match: MatchInfo | null;
  avg_price_per_m2: number | null;
  avg_area: number | null;
  has_shortlisted: boolean;
  best_shortlist_order: number | null;
  construction_completion: string | null;
};

type ProjectSortKey = "score" | "match" | "price" | "price_m2" | "area";

const PROJECT_SORT_OPTIONS: { key: ProjectSortKey; label: string }[] = [
  { key: "score", label: "Doporučeno" },
  { key: "match", label: "Nejvyšší shoda" },
  { key: "price", label: "Cena" },
  { key: "price_m2", label: "Cena/m²" },
  { key: "area", label: "Plocha" },
];

function sortProjectGroups(groups: ProjectGroup[], key: ProjectSortKey): ProjectGroup[] {
  const sorted = [...groups];
  switch (key) {
    case "match":
      sorted.sort((a, b) => (b.best_match?.matched ?? -1) - (a.best_match?.matched ?? -1));
      break;
    case "price":
      sorted.sort((a, b) => (a.price_range[0] ?? Infinity) - (b.price_range[0] ?? Infinity));
      break;
    case "price_m2":
      sorted.sort((a, b) => (a.avg_price_per_m2 ?? Infinity) - (b.avg_price_per_m2 ?? Infinity));
      break;
    case "area":
      sorted.sort((a, b) => (b.avg_area ?? 0) - (a.avg_area ?? 0));
      break;
    default: // "score" / "Doporučeno" — broker-shortlisted projects first
      sorted.sort((a, b) => {
        if (a.has_shortlisted !== b.has_shortlisted) return a.has_shortlisted ? -1 : 1;
        if (a.has_shortlisted && b.has_shortlisted) {
          return (a.best_shortlist_order ?? 999999) - (b.best_shortlist_order ?? 999999);
        }
        return b.best_score - a.best_score;
      });
  }
  return sorted;
}

type PreferenceItem = {
  key: string;
  label: string;
  value: string;
  filter_type: string; // "max" | "min" | "in" | "bool" | "exclude_floor"
  raw_value: number | null;
};

type ViewMode = "projects" | "units" | "map" | "cards";
type SortKey = "score" | "match_count" | "price_czk" | "price_per_m2_czk" | "floor_area_m2" | "exterior_area_m2";
type SortDir = "asc" | "desc";
type QuickFilter = "all" | "broker_pick" | "liked" | "hide_disliked" | "undecided";

// ── Helpers ────────────────────────────────────────────────────────────

function portalHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("portal_token") : null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** layout_3 → 3kk, layout_2_1 → 2+1, etc. */
function formatLayout(layout: string | null | undefined): string {
  if (!layout) return "—";
  const m = layout.match(/^layout_(\d\+?)(?:_(\d))?$/i);
  if (!m) return layout;
  return m[2] ? `${m[1]}+${m[2]}` : `${m[1]}kk`;
}

const SHORTLIST_ROLE_LABELS: Record<string, string> = {
  top_pick: "Top volba",
  alternative: "Alternativa",
  fallback: "Záloha",
  wild_card: "Divoká karta",
};

function formatScore(score: number | null | undefined): string {
  if (score == null) return "—";
  return `${Math.round(score)} %`;
}

function buildProjectGroups(recs: Rec[], matchMap: Map<number, MatchInfo>): ProjectGroup[] {
  const map = new Map<number | null, Rec[]>();
  for (const r of recs) {
    const key = r.project_id ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const groups: ProjectGroup[] = [];
  for (const [pid, units] of map) {
    const sorted = [...units].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const prices = units.map((u) => u.price_czk).filter((p): p is number => p != null);
    const pricesPerM2 = units.map((u) => u.price_per_m2_czk).filter((p): p is number => p != null);
    const areas = units.map((u) => u.floor_area_m2).filter((a): a is number => a != null);
    const extAreas = units.map((u) => u.exterior_area_m2).filter((a): a is number => a != null);
    const layouts = [...new Set(units.map((u) => u.layout_label).filter(Boolean))] as string[];
    groups.push({
      project_id: pid,
      project_name: sorted[0].project_name ?? "Neznámý projekt",
      district: sorted[0].district ?? null,
      units: sorted,
      best_score: sorted[0].score ?? 0,
      price_range: [prices.length ? Math.min(...prices) : null, prices.length ? Math.max(...prices) : null],
      area_range: [areas.length ? Math.min(...areas) : null, areas.length ? Math.max(...areas) : null],
      ext_area_range: [extAreas.length ? Math.min(...extAreas) : null, extAreas.length ? Math.max(...extAreas) : null],
      layouts,
      liked_count: units.filter((u) => u.feedback?.feedback_type === "liked").length,
      disliked_count: units.filter((u) => u.feedback?.feedback_type === "disliked").length,
      project_lat: sorted[0].project_lat,
      project_lng: sorted[0].project_lng,
      avg_price_per_m2: pricesPerM2.length
        ? Math.round(pricesPerM2.reduce((a, b) => a + b, 0) / pricesPerM2.length)
        : null,
      avg_area: areas.length
        ? Math.round(areas.reduce((a, b) => a + b, 0) / areas.length)
        : null,
      best_match: (() => {
        let best: MatchInfo | null = null;
        for (const u of units) {
          const m = matchMap.get(u.rec_id);
          if (m && m.total > 0 && (!best || m.matched > best.matched)) best = m;
        }
        return best;
      })(),
      has_shortlisted: units.some((u) => u.pinned_by_broker),
      best_shortlist_order: (() => {
        const orders = units
          .filter((u) => u.pinned_by_broker && u.shortlist_order != null)
          .map((u) => u.shortlist_order as number);
        return orders.length ? Math.min(...orders) : null;
      })(),
      construction_completion: sorted[0].construction_completion ?? null,
    });
  }
  // Default: pinned projects first (by best_shortlist_order), then by score
  groups.sort((a, b) => {
    if (a.has_shortlisted !== b.has_shortlisted) return a.has_shortlisted ? -1 : 1;
    if (a.has_shortlisted && b.has_shortlisted) {
      return (a.best_shortlist_order ?? 999999) - (b.best_shortlist_order ?? 999999);
    }
    return b.best_score - a.best_score;
  });
  return groups;
}

function applyFilter(recs: Rec[], filter: QuickFilter): Rec[] {
  switch (filter) {
    case "liked":
      return recs.filter((r) => r.feedback?.feedback_type === "liked");
    case "hide_disliked":
      return recs.filter((r) => r.feedback?.feedback_type !== "disliked");
    case "broker_pick":
      return recs.filter((r) => r.pinned_by_broker);
    case "undecided":
      return recs.filter((r) => !r.feedback);
    default:
      return recs;
  }
}

/** Map preference key → field on Rec for filtering. */
const PREF_FIELD_MAP: Record<string, keyof Rec> = {
  budget_max: "price_czk",
  area_min: "floor_area_m2",
  outdoor_area_min: "exterior_area_m2",
  exclude_ground_floor: "floor",
  prefer_no_ground: "floor",
};

function applyPreferenceFilters(
  recs: Rec[],
  prefs: PreferenceItem[],
  activeKeys: Set<string>,
): Rec[] {
  let result = recs;
  for (const p of prefs) {
    if (!activeKeys.has(p.key)) continue;

    if (p.key === "budget_max" && p.raw_value != null) {
      result = result.filter((r) => r.price_czk == null || r.price_czk <= p.raw_value!);
    } else if (p.key === "area_min" && p.raw_value != null) {
      result = result.filter((r) => r.floor_area_m2 == null || r.floor_area_m2 >= p.raw_value!);
    } else if (p.key === "outdoor_area_min" && p.raw_value != null) {
      result = result.filter(
        (r) => r.exterior_area_m2 == null || r.exterior_area_m2 >= p.raw_value!,
      );
    } else if (p.key === "layouts") {
      const allowed = p.value.split(",").map((s) => s.trim().toLowerCase());
      result = result.filter(
        (r) =>
          r.layout == null ||
          allowed.some(
            (a) =>
              r.layout!.toLowerCase().includes(a) ||
              (r.layout_label && r.layout_label.toLowerCase().includes(a)),
          ),
      );
    } else if (p.key === "exclude_ground_floor" || p.key === "prefer_no_ground") {
      result = result.filter((r) => r.floor == null || r.floor > 1);
    } else if (p.filter_type === "feature") {
      // Feature boolean filters
      const featureMap: Record<string, keyof Rec> = {
        recuperation: "has_recuperation",
        air_conditioning: "has_air_conditioning",
        floor_heating: "has_floor_heating",
        exterior_blinds: "has_exterior_blinds",
        parking: "has_parking",
        smart_home: "has_smart_home",
      };
      const field = featureMap[p.key];
      if (field) {
        result = result.filter((r) => r[field] === true);
      }
    } else if (p.filter_type === "noise_distance" && p.raw_value != null) {
      // Noise distance filters — keep units where distance >= threshold (or unknown)
      const distMap: Record<string, keyof Rec> = {
        no_main_road: "distance_to_primary_road_m",
        no_tram: "distance_to_tram_tracks_m",
        no_railway: "distance_to_railway_m",
      };
      const field = distMap[p.key];
      if (field) {
        const threshold = p.raw_value;
        result = result.filter((r) => {
          const dist = r[field] as number | null;
          return dist == null || dist >= threshold;
        });
      }
    } else if (p.filter_type === "amenity") {
      // Project amenity boolean filters
      const amenityMap: Record<string, keyof Rec> = {
        bike_room: "has_bike_room",
        stroller_room: "has_stroller_room",
        fitness: "has_fitness",
        courtyard_garden: "has_courtyard_garden",
        reception: "has_reception",
        concierge: "has_concierge",
      };
      const field = amenityMap[p.key];
      if (field) {
        result = result.filter((r) => r[field] === true);
      }
    } else if (p.filter_type === "enum") {
      // Enum attribute filters — multi-value (comma-separated), any-of match
      const enumFieldMap: Record<string, keyof Rec> = {
        windows: "windows",
        heating: "heating",
        heating_source: "heating_source",
        partition_walls: "partition_walls",
        flooring: "flooring",
      };
      const field = enumFieldMap[p.key];
      if (field) {
        const wantedValues = p.value.toLowerCase().split(",").map((s) => s.trim());
        result = result.filter((r) => {
          const val = r[field] as string | null;
          if (val == null) return true; // unknown = don't exclude
          return wantedValues.some((w) => val.toLowerCase().includes(w));
        });
      }
    }
  }
  return result;
}

// ── Match info ─────────────────────────────────────────────────────────

type MatchInfo = {
  matched: number;
  total: number;
  matchedKeys: string[];
  missingKeys: string[];
};

function computeMatchInfo(rec: Rec, prefs: PreferenceItem[]): MatchInfo {
  if (prefs.length === 0) return { matched: 0, total: 0, matchedKeys: [], missingKeys: [] };
  const matchedKeys: string[] = [];
  const missingKeys: string[] = [];

  for (const p of prefs) {
    let passes = false;

    if (p.key === "budget_max" && p.raw_value != null) {
      passes = rec.price_czk == null || rec.price_czk <= p.raw_value;
    } else if (p.key === "area_min" && p.raw_value != null) {
      passes = rec.floor_area_m2 == null || rec.floor_area_m2 >= p.raw_value;
    } else if (p.key === "outdoor_area_min" && p.raw_value != null) {
      passes = rec.exterior_area_m2 == null || rec.exterior_area_m2 >= p.raw_value;
    } else if (p.key === "layouts") {
      const allowed = p.value.split(",").map((s) => s.trim().toLowerCase());
      passes =
        rec.layout == null ||
        allowed.some(
          (a) =>
            rec.layout!.toLowerCase().includes(a) ||
            (rec.layout_label && rec.layout_label.toLowerCase().includes(a)),
        );
    } else if (p.key === "exclude_ground_floor" || p.key === "prefer_no_ground") {
      passes = rec.floor == null || rec.floor > 1;
    } else if (p.filter_type === "feature") {
      const featureMap: Record<string, keyof Rec> = {
        recuperation: "has_recuperation",
        air_conditioning: "has_air_conditioning",
        floor_heating: "has_floor_heating",
        exterior_blinds: "has_exterior_blinds",
        parking: "has_parking",
        smart_home: "has_smart_home",
      };
      const field = featureMap[p.key];
      passes = field ? rec[field] === true : true;
    } else if (p.filter_type === "noise_distance" && p.raw_value != null) {
      const distMap: Record<string, keyof Rec> = {
        no_main_road: "distance_to_primary_road_m",
        no_tram: "distance_to_tram_tracks_m",
        no_railway: "distance_to_railway_m",
      };
      const field = distMap[p.key];
      if (field) {
        const dist = rec[field] as number | null;
        passes = dist == null || dist >= p.raw_value;
      } else {
        passes = true;
      }
    } else if (p.filter_type === "amenity") {
      const amenityMap: Record<string, keyof Rec> = {
        bike_room: "has_bike_room",
        stroller_room: "has_stroller_room",
        fitness: "has_fitness",
        courtyard_garden: "has_courtyard_garden",
        reception: "has_reception",
        concierge: "has_concierge",
      };
      const field = amenityMap[p.key];
      passes = field ? rec[field] === true : true;
    } else if (p.filter_type === "enum") {
      const enumFieldMap: Record<string, keyof Rec> = {
        windows: "windows",
        heating: "heating",
        heating_source: "heating_source",
        partition_walls: "partition_walls",
        flooring: "flooring",
      };
      const field = enumFieldMap[p.key];
      if (field) {
        const val = rec[field] as string | null;
        if (val == null) {
          passes = true;
        } else {
          const wantedValues = p.value.toLowerCase().split(",").map((s) => s.trim());
          passes = wantedValues.some((w) => val.toLowerCase().includes(w));
        }
      } else {
        passes = true;
      }
    } else {
      // Unknown filter type — assume pass (don't penalize)
      passes = true;
    }

    if (passes) matchedKeys.push(p.key);
    else missingKeys.push(p.key);
  }

  return { matched: matchedKeys.length, total: prefs.length, matchedKeys, missingKeys };
}

const FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "Vše" },
  { key: "broker_pick", label: "Výběr makléře" },
  { key: "liked", label: "Líbí se" },
  { key: "hide_disliked", label: "Skrýt nechci" },
  { key: "undecided", label: "Bez rozhodnutí" },
];

const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: "projects", label: "Projekty" },
  { key: "units", label: "Jednotky" },
  { key: "map", label: "Mapa" },
  { key: "cards", label: "Karty" },
];

// ── Map (lazy) ─────────────────────────────────────────────────────────

const PortalMap = dynamic(() => import("./PortalMap"), { ssr: false });

// ── Match badge ────────────────────────────────────────────────────────

function MatchBadge({
  info,
  size = "sm",
  prefs,
}: {
  info: MatchInfo;
  size?: "sm" | "xs";
  prefs?: PreferenceItem[];
}) {
  const [open, setOpen] = useState(false);
  if (info.total === 0) return null;
  const ratio = info.matched / info.total;
  const colorClass =
    ratio >= 0.85
      ? "bg-emerald-100 text-emerald-700"
      : ratio >= 0.6
        ? "bg-amber-100 text-amber-700"
        : "bg-rose-100 text-rose-700";
  const sizeClass = size === "xs" ? "text-[9px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5";

  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    if (prefs) for (const p of prefs) m.set(p.key, p.label);
    return m;
  }, [prefs]);

  const getLabel = (key: string) => labelMap.get(key) ?? key;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (prefs) setOpen((v) => !v);
        }}
        className={`rounded-full font-semibold ${colorClass} ${sizeClass} ${prefs ? "cursor-pointer hover:opacity-80" : ""}`}
        title={
          info.missingKeys.length > 0
            ? `Chybí:${info.missingKeys.map(getLabel).join(", ")}`
            : "Všechny preference splněny"
        }
      >
        {info.matched}/{info.total}
      </button>
      {open && prefs && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-xs">
            {info.matchedKeys.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 font-semibold text-emerald-700">Splněno</p>
                <ul className="space-y-0.5">
                  {info.matchedKeys.map((k) => (
                    <li key={k} className="flex items-start gap-1.5 text-slate-700">
                      <span className="mt-0.5 text-emerald-500">✓</span>
                      <span>{getLabel(k)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {info.missingKeys.length > 0 && (
              <div>
                <p className="mb-1 font-semibold text-rose-600">Nesplněno</p>
                <ul className="space-y-0.5">
                  {info.missingKeys.map((k) => (
                    <li key={k} className="flex items-start gap-1.5 text-slate-500">
                      <span className="mt-0.5 text-rose-400">✗</span>
                      <span>{getLabel(k)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </span>
  );
}

// ── Feedback buttons ───────────────────────────────────────────────────

function FeedbackButtons({
  rec,
  sendingId,
  onFeedback,
}: {
  rec: Rec;
  sendingId: number | null;
  onFeedback: (recId: number, type: string) => void;
}) {
  const fbType = rec.feedback?.feedback_type;
  if (fbType === "liked") {
    return (
      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
        Líbí se
      </span>
    );
  }
  if (fbType === "disliked") {
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
        Nechci
      </span>
    );
  }
  return (
    <div className="flex gap-1">
      <button
        onClick={() => onFeedback(rec.rec_id, "liked")}
        disabled={sendingId === rec.rec_id}
        className="rounded-full border border-emerald-300 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
      >
        Líbí se
      </button>
      <button
        onClick={() => onFeedback(rec.rec_id, "disliked")}
        disabled={sendingId === rec.rec_id}
        className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
      >
        Nechci
      </button>
    </div>
  );
}

// ── Sortable header ────────────────────────────────────────────────────

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = current === sortKey;
  return (
    <th
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-800 ${className ?? ""}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <span className="ml-0.5">{dir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

// ── Main page ──────────────────────────────────────────────────────────

export default function PortalNovostavbyPage() {
  const [allRecs, setAllRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingFb, setSendingFb] = useState<number | null>(null);

  // Preference-based filters
  const [myPrefs, setMyPrefs] = useState<PreferenceItem[]>([]);
  const [activePrefKeys, setActivePrefKeys] = useState<Set<string>>(new Set());

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "projects";
    const saved = localStorage.getItem("portal_recs_view");
    return VIEW_MODES.some((v) => v.key === saved) ? (saved as ViewMode) : "projects";
  });

  const [quickFilter, setQuickFilter] = useState<QuickFilter>(() => {
    if (typeof window === "undefined") return "hide_disliked";
    const saved = localStorage.getItem("portal_recs_filter");
    return FILTERS.some((f) => f.key === saved) ? (saved as QuickFilter) : "hide_disliked";
  });

  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Expanded project groups
  const [expandedProjects, setExpandedProjects] = useState<Set<number | null>>(new Set());

  useEffect(() => {
    const headers = portalHeaders();
    // Fetch recommendations + preferences in parallel
    Promise.all([
      fetch(`${API_BASE}/portal/recommendations`, { headers }).then((r) => {
        if (r.status === 401) throw new Error("Neplatná session");
        if (!r.ok) throw new Error("Chyba načítání");
        return r.json();
      }),
      fetch(`${API_BASE}/portal/my-preferences`, { headers })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .catch(() => ({ items: [] })),
    ])
      .then(([recsData, prefsData]) => {
        setAllRecs(recsData);
        const items: PreferenceItem[] = prefsData.items ?? [];
        setMyPrefs(items);
        // Default sort = match if client has >= 3 preferences
        if (items.length >= 3) {
          setSortKey("match_count");
          setProjectSort("match");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredRecs = useMemo(() => {
    const afterQuick = applyFilter(allRecs, quickFilter);
    return applyPreferenceFilters(afterQuick, myPrefs, activePrefKeys);
  }, [allRecs, quickFilter, myPrefs, activePrefKeys]);

  // Match info per recommendation
  const matchMap = useMemo(() => {
    const map = new Map<number, MatchInfo>();
    for (const r of allRecs) {
      map.set(r.rec_id, computeMatchInfo(r, myPrefs));
    }
    return map;
  }, [allRecs, myPrefs]);

  const getMatch = (recId: number): MatchInfo =>
    matchMap.get(recId) ?? { matched: 0, total: 0, matchedKeys: [], missingKeys: [] };

  const sortedRecs = useMemo(() => {
    const arr = [...filteredRecs];
    arr.sort((a, b) => {
      if (sortKey === "match_count") {
        const am = getMatch(a.rec_id).matched;
        const bm = getMatch(b.rec_id).matched;
        return sortDir === "asc" ? am - bm : bm - am;
      }
      const av = (a[sortKey as keyof Rec] as number) ?? -Infinity;
      const bv = (b[sortKey as keyof Rec] as number) ?? -Infinity;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [filteredRecs, sortKey, sortDir, matchMap]);

  const [projectSort, setProjectSort] = useState<ProjectSortKey>("score");

  const groups = useMemo(() => {
    const raw = buildProjectGroups(filteredRecs, matchMap);
    return sortProjectGroups(raw, projectSort);
  }, [filteredRecs, matchMap, projectSort]);

  const filterCounts = useMemo<Record<QuickFilter, number>>(
    () => ({
      all: allRecs.length,
      broker_pick: allRecs.filter((r) => r.pinned_by_broker).length,
      liked: allRecs.filter((r) => r.feedback?.feedback_type === "liked").length,
      hide_disliked: allRecs.filter((r) => r.feedback?.feedback_type !== "disliked").length,
      undecided: allRecs.filter((r) => !r.feedback).length,
    }),
    [allRecs],
  );

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "score" ? "desc" : "asc");
    }
  };

  const sendFeedback = async (recId: number, feedbackType: string) => {
    setSendingFb(recId);
    try {
      const res = await fetch(`${API_BASE}/portal/recommendations/${recId}/feedback`, {
        method: "PUT",
        headers: portalHeaders(),
        body: JSON.stringify({ feedback_type: feedbackType }),
      });
      if (res.ok) {
        const fb: Feedback = await res.json();
        setAllRecs((prev) =>
          prev.map((r) => (r.rec_id === recId ? { ...r, feedback: fb } : r)),
        );
      }
    } finally {
      setSendingFb(null);
    }
  };

  const togglePref = (key: string) => {
    setActivePrefKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleProject = (pid: number | null) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  if (loading) return <p className="text-sm text-slate-400">Načítám doporučení...</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Novostavby</h2>
        <p className="text-sm text-slate-500">
          Jednotky vybrané na základě vašich preferencí.
        </p>
      </div>

      {/* Toolbar: view modes + filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* View mode toggle */}
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {VIEW_MODES.map((v) => (
            <button
              key={v.key}
              onClick={() => {
                setViewMode(v.key);
                localStorage.setItem("portal_recs_view", v.key);
              }}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                viewMode === v.key
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="mx-1 h-5 w-px bg-slate-200" />

        {/* Quick filters */}
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setQuickFilter(f.key);
              localStorage.setItem("portal_recs_filter", f.key);
            }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              f.key === "broker_pick"
                ? quickFilter === f.key
                  ? "bg-violet-700 text-white"
                  : "border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
                : quickFilter === f.key
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f.label} ({filterCounts[f.key]})
          </button>
        ))}
      </div>

      {/* Preference-based filters — grouped */}
      {myPrefs.length > 0 && (() => {
        const corePrefs = myPrefs.filter((p) =>
          ["max", "min", "in", "bool", "exclude_floor"].includes(p.filter_type),
        );
        const standardPrefs = myPrefs.filter((p) =>
          ["feature", "enum", "noise_distance"].includes(p.filter_type),
        );
        const amenityPrefs = myPrefs.filter((p) => p.filter_type === "amenity");

        const renderChip = (p: PreferenceItem) => {
          const active = activePrefKeys.has(p.key);
          return (
            <button
              key={p.key}
              onClick={() => togglePref(p.key)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                active
                  ? "border-blue-300 bg-blue-100 text-blue-800"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}
              title={`${p.label}: ${p.value}`}
            >
              {p.label}: {p.value}
            </button>
          );
        };

        return (
          <div className="flex flex-col gap-1.5">
            {corePrefs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-400 mr-1 w-28 shrink-0">Mé preference:</span>
                {corePrefs.map(renderChip)}
              </div>
            )}
            {standardPrefs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-400 mr-1 w-28 shrink-0">Standardy:</span>
                {standardPrefs.map(renderChip)}
              </div>
            )}
            {amenityPrefs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-400 mr-1 w-28 shrink-0">Vybavení projektu:</span>
                {amenityPrefs.map(renderChip)}
              </div>
            )}
            {activePrefKeys.size > 0 && (
              <div className="flex items-center">
                <span className="w-28 shrink-0" />
                <button
                  onClick={() => setActivePrefKeys(new Set())}
                  className="rounded-full px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-600"
                >
                  Zrušit vše
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Empty state */}
      {filteredRecs.length === 0 && (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-500">
            {allRecs.length === 0
              ? "Zatím žádná doporučení. Váš makléř připravuje nabídku."
              : "Žádné jednotky neodpovídají zvolenému filtru."}
          </p>
        </ReamarCard>
      )}

      {/* ── Projects view ── */}
      {viewMode === "projects" && filteredRecs.length > 0 && (
        <div className="grid gap-2">
          {/* Project sort bar */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-400 mr-0.5">Řadit:</span>
            {PROJECT_SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                onClick={() => setProjectSort(o.key)}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                  projectSort === o.key
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {groups.map((g) => {
            const expanded = expandedProjects.has(g.project_id);
            return (
              <ReamarCard key={g.project_id ?? "null"} className="overflow-hidden">
                {/* Project header */}
                <button
                  type="button"
                  onClick={() => toggleProject(g.project_id)}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-800 truncate">{g.project_name}</p>
                      {g.has_shortlisted && (
                        <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                          ★{g.best_shortlist_order != null ? ` #${g.best_shortlist_order}` : ""} Výběr makléře
                        </span>
                      )}
                      {g.liked_count > 0 && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          {g.liked_count}× líbí se
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                      {g.district && <span>{g.district}</span>}
                      <span>
                        {g.units.length} {g.units.length === 1 ? "jednotka" : g.units.length < 5 ? "jednotky" : "jednotek"}
                      </span>
                      {g.layouts.length > 0 && <span>{g.layouts.map(formatLayout).join(", ")}</span>}
                      {g.price_range[0] != null && (
                        <span>
                          {formatCurrencyCzk(g.price_range[0])}
                          {g.price_range[1] != null && g.price_range[1] !== g.price_range[0]
                            ? ` – ${formatCurrencyCzk(g.price_range[1])}`
                            : ""}
                        </span>
                      )}
                      {g.area_range[0] != null && (
                        <span>
                          {g.area_range[0]}
                          {g.area_range[1] != null && g.area_range[1] !== g.area_range[0]
                            ? `–${g.area_range[1]}`
                            : ""}{" "}
                          m²
                        </span>
                      )}
                      {g.construction_completion && parseInt(g.construction_completion.slice(0, 4)) >= 2024 && (
                        <span className="text-slate-400">Dokončení: {g.construction_completion}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {g.best_match && <MatchBadge info={g.best_match} prefs={myPrefs} />}
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      {formatScore(g.best_score)}
                    </span>
                    <span className="text-slate-400 text-xs">{expanded ? "▲" : "▼"}</span>
                  </div>
                </button>

                {/* Expanded units */}
                {expanded && (
                  <div className="border-t border-slate-100">
                    {g.units[0]?.project_url && g.units[0].project_url.startsWith("http") && (
                      <div className="border-b border-slate-50 px-4 py-2">
                        <a
                          href={g.units[0].project_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-slate-400 transition-colors hover:text-slate-600"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Web projektu →
                        </a>
                      </div>
                    )}
                    {g.units.map((r) => (
                      <div
                        key={r.rec_id}
                        className={`flex items-center justify-between gap-3 border-b border-slate-50 px-4 py-2.5 last:border-b-0 ${
                          r.feedback?.feedback_type === "disliked" ? "opacity-50" : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-700">
                            <span className="font-medium">{r.unit_external_id ?? `#${r.rec_id}`}</span>
                            {r.pinned_by_broker && (
                              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                ★{r.shortlist_order != null ? ` #${r.shortlist_order}` : ""} {r.shortlist_role ? SHORTLIST_ROLE_LABELS[r.shortlist_role] ?? r.shortlist_role : "Výběr"}
                              </span>
                            )}
                            {r.layout && <span>{formatLayout(r.layout)}</span>}
                            {r.floor_area_m2 != null && <span>{r.floor_area_m2} m²</span>}
                            {r.exterior_area_m2 != null && r.exterior_area_m2 > 0 && (
                              <span>venk. {r.exterior_area_m2} m²</span>
                            )}
                            {r.price_czk != null && (
                              <span>{(r.price_czk / 1_000_000).toFixed(1)} mil. Kč</span>
                            )}
                            {r.floor != null && <span>{r.floor}. p.</span>}
                          </div>
                          {r.pinned_by_broker && r.shortlist_reason && (
                            <p className="mt-1 text-[11px] text-violet-700 italic">
                              {r.shortlist_reason}
                            </p>
                          )}
                          {r.top_strengths.length > 0 && (
                            <p className="mt-0.5 text-[10px] text-emerald-600">
                              {r.top_strengths.slice(0, 3).join(" · ")}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {myPrefs.length > 0 && <MatchBadge info={getMatch(r.rec_id)} size="xs" prefs={myPrefs} />}
                          {r.score != null && (
                            <span className="text-xs font-medium text-slate-500">{formatScore(r.score)}</span>
                          )}
                          <FeedbackButtons rec={r} sendingId={sendingFb} onFeedback={sendFeedback} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ReamarCard>
            );
          })}
        </div>
      )}

      {/* ── Units table view ── */}
      {viewMode === "units" && filteredRecs.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Projekt / Jednotka
                </th>
                <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Dispozice
                </th>
                <SortHeader label="Plocha" sortKey="floor_area_m2" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Ext." sortKey="exterior_area_m2" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Cena" sortKey="price_czk" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Kč/m²" sortKey="price_per_m2_czk" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Skóre" sortKey="score" current={sortKey} dir={sortDir} onSort={handleSort} />
                {myPrefs.length > 0 && (
                  <SortHeader label="Shoda" sortKey="match_count" current={sortKey} dir={sortDir} onSort={handleSort} />
                )}
                <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Hodnocení
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRecs.map((r) => (
                <tr
                  key={r.rec_id}
                  className={`border-b border-slate-50 hover:bg-slate-50/50 ${
                    r.feedback?.feedback_type === "liked"
                      ? "bg-emerald-50/30"
                      : r.feedback?.feedback_type === "disliked"
                        ? "opacity-50"
                        : ""
                  }`}
                >
                  <td className="max-w-[220px] px-2 py-2 font-medium text-slate-800">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="truncate">{r.project_name ?? "Projekt"}</span>
                      <span className="text-slate-400">{r.unit_external_id ?? ""}</span>
                      {r.pinned_by_broker && (
                        <span className="shrink-0 rounded-full bg-violet-100 px-1 py-0 text-[10px] font-semibold text-violet-700">
                          ★{r.shortlist_order != null ? ` #${r.shortlist_order}` : ""}
                        </span>
                      )}
                    </div>
                    {r.pinned_by_broker && r.shortlist_reason && (
                      <p className="mt-0.5 max-w-[200px] truncate text-[10px] italic text-violet-600" title={r.shortlist_reason}>
                        {r.shortlist_reason}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2 text-slate-600">{formatLayout(r.layout)}</td>
                  <td className="px-2 py-2 text-slate-600">
                    {r.floor_area_m2 != null ? `${r.floor_area_m2}` : "—"}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {r.exterior_area_m2 != null && r.exterior_area_m2 > 0 ? `${r.exterior_area_m2}` : "—"}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {r.price_czk != null ? `${(r.price_czk / 1_000_000).toFixed(1)} mil.` : "—"}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {r.price_per_m2_czk != null
                      ? `${new Intl.NumberFormat("cs-CZ").format(r.price_per_m2_czk)}`
                      : "—"}
                  </td>
                  <td className="px-2 py-2">
                    {r.score != null && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        {formatScore(r.score)}
                      </span>
                    )}
                  </td>
                  {myPrefs.length > 0 && (
                    <td className="px-2 py-2">
                      <MatchBadge info={getMatch(r.rec_id)} prefs={myPrefs} />
                    </td>
                  )}
                  <td className="px-2 py-2 text-right">
                    <FeedbackButtons rec={r} sendingId={sendingFb} onFeedback={sendFeedback} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Map view ── */}
      {viewMode === "map" && (
        <PortalMap recs={filteredRecs} onFeedback={sendFeedback} sendingFb={sendingFb} getMatch={myPrefs.length > 0 ? getMatch : undefined} />
      )}

      {/* ── Cards view ── */}
      {viewMode === "cards" && filteredRecs.length > 0 && (
        <div className="grid gap-2">
          {sortedRecs.map((r) => {
            const fbType = r.feedback?.feedback_type;
            return (
              <ReamarCard
                key={r.rec_id}
                className={`p-4 ${
                  fbType === "liked"
                    ? "ring-1 ring-emerald-300"
                    : fbType === "disliked"
                      ? "opacity-60"
                      : r.pinned_by_broker
                        ? "ring-1 ring-violet-200"
                        : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-800 truncate">
                        {r.project_name ?? "Projekt"}
                        {r.district && (
                          <span className="ml-1.5 text-xs font-normal text-slate-500">{r.district}</span>
                        )}
                      </p>
                      {r.pinned_by_broker && (
                        <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                          ★{r.shortlist_order != null ? ` #${r.shortlist_order}` : ""} {r.shortlist_role ? SHORTLIST_ROLE_LABELS[r.shortlist_role] ?? r.shortlist_role : "Výběr"}
                        </span>
                      )}
                    </div>
                    {r.pinned_by_broker && r.shortlist_reason && (
                      <p className="mt-1 text-[11px] text-violet-700 italic">{r.shortlist_reason}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                      {r.layout && <span>{formatLayout(r.layout)}</span>}
                      {r.floor_area_m2 != null && <span>{r.floor_area_m2} m²</span>}
                      {r.exterior_area_m2 != null && r.exterior_area_m2 > 0 && (
                        <span>venk. {r.exterior_area_m2} m²</span>
                      )}
                      {r.price_czk != null && (
                        <span>{(r.price_czk / 1_000_000).toFixed(1)} mil. Kč</span>
                      )}
                      {r.floor != null && <span>{r.floor}. patro</span>}
                      {r.construction_completion && parseInt(r.construction_completion.slice(0, 4)) >= 2024 && (
                        <span className="text-slate-400">Dokončení: {r.construction_completion}</span>
                      )}
                      {r.project_url && r.project_url.startsWith("http") && (
                        <a
                          href={r.project_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 transition-colors hover:text-slate-600"
                        >
                          Web →
                        </a>
                      )}
                    </div>
                    {r.top_strengths.length > 0 && (
                      <p className="mt-1 text-[11px] text-emerald-600">
                        {r.top_strengths.slice(0, 3).join(" · ")}
                      </p>
                    )}
                    {r.top_compromises.length > 0 && (
                      <p className="text-[11px] text-amber-600">
                        {r.top_compromises.slice(0, 2).join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="flex items-center gap-1.5">
                      {myPrefs.length > 0 && <MatchBadge info={getMatch(r.rec_id)} prefs={myPrefs} />}
                      {r.score != null && (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          {formatScore(r.score)}
                        </span>
                      )}
                    </div>
                    <FeedbackButtons rec={r} sendingId={sendingFb} onFeedback={sendFeedback} />
                  </div>
                </div>
              </ReamarCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
