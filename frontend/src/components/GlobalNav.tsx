"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useRef } from "react";
import { useActiveClient } from "@/contexts/ActiveClientContext";
import { API_BASE } from "@/lib/api";

/** Params that belong to a specific page and must not carry over to other pages. */
const PAGE_ONLY_PARAMS = new Set(["sort_by", "sort_dir", "limit", "offset"]);

function navClass(active: boolean) {
  return [
    "rounded-full px-3.5 py-1.5 text-sm font-medium",
    active
      ? "bg-slate-900 text-white shadow-sm"
      : "text-slate-700 hover:bg-white hover:text-slate-900",
  ].join(" ");
}

/** Builds a nav href that carries shared params (filters, poly, …) but strips page-specific ones. */
function buildNavHref(base: string, searchParams: URLSearchParams | null): string {
  if (!searchParams) return base;
  const shared = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (!PAGE_ONLY_PARAMS.has(key)) shared.append(key, value);
  });
  const qs = shared.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Inner component — uses useSearchParams, must be inside a Suspense boundary. */
function NavLinks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeClient, deactivate } = useActiveClient();

  const isUnits = pathname?.startsWith("/units");
  const isProjects = pathname?.startsWith("/projects") && !pathname?.startsWith("/projects/map");
  const isMap = pathname?.startsWith("/projects/map");
  const isClients = pathname?.startsWith("/clients");
  const isMatches = pathname?.startsWith("/matches");

  return (
    <>
      <nav className="flex items-center rounded-full border border-white/40 bg-white/40 p-0.5 shadow-sm backdrop-blur">
        <Link href={buildNavHref("/units", searchParams)} className={navClass(!!isUnits)}>
          Jednotky
        </Link>
        <Link href={buildNavHref("/projects", searchParams)} className={navClass(!!isProjects)}>
          Projekty
        </Link>
        <Link href={buildNavHref("/projects/map", searchParams)} className={navClass(!!isMap)}>
          Mapa
        </Link>
        <Link href="/clients" className={navClass(!!isClients)}>
          Klienti
        </Link>
        <Link href="/matches" className={navClass(!!isMatches)}>
          Matches
        </Link>
      </nav>
      {activeClient && (
        <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 shadow-sm">
          <Link href={`/clients/${activeClient.clientId}`} className="max-w-[160px] truncate hover:underline">{activeClient.clientName}</Link>
          <button
            type="button"
            onClick={deactivate}
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-amber-600 hover:bg-amber-200 hover:text-amber-900"
            title="Ukončit klientský mód"
            aria-label="Ukončit klientský mód"
          >
            ×
          </button>
        </span>
      )}
    </>
  );
}

/** Fallback rendered during SSR / before hydration — plain links, no filter params. */
function NavLinksFallback() {
  const pathname = usePathname();

  const isUnits = pathname?.startsWith("/units");
  const isProjects = pathname?.startsWith("/projects") && !pathname?.startsWith("/projects/map");
  const isMap = pathname?.startsWith("/projects/map");
  const isClients = pathname?.startsWith("/clients");
  const isMatches = pathname?.startsWith("/matches");

  return (
    <nav className="flex items-center rounded-full border border-white/40 bg-white/40 p-0.5 shadow-sm backdrop-blur">
      <Link href="/units" className={navClass(!!isUnits)}>Jednotky</Link>
      <Link href="/projects" className={navClass(!!isProjects)}>Projekty</Link>
      <Link href="/projects/map" className={navClass(!!isMap)}>Mapa</Link>
      <Link href="/clients" className={navClass(!!isClients)}>Klienti</Link>
      <Link href="/matches" className={navClass(!!isMatches)}>Matches</Link>
    </nav>
  );
}

type Notification = {
  id: number;
  type: string;
  unit_external_id?: string | null;
  project_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  affected_clients: string[];
  created_at: string;
};

function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    if (!token) return;
    fetch(`${API_BASE}/brokers/notifications?days=7`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setNotifications(d ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const count = notifications.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-1.5 text-slate-600 hover:bg-white/60 hover:text-slate-900"
        title="Notifikace"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-700">Notifikace (posledních 7 dní)</p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">Žádné nové události</p>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <div key={n.id} className="border-b border-slate-50 px-3 py-2 last:border-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${
                      n.type === "price_change" ? "bg-blue-500" :
                      n.type === "availability_change" ? "bg-emerald-500" :
                      "bg-violet-500"
                    }`} />
                    <span className="text-[11px] font-medium text-slate-800">
                      {n.type === "price_change" ? "Změna ceny" :
                       n.type === "availability_change" ? "Změna dostupnosti" :
                       "Nový projekt"}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-400">
                      {new Date(n.created_at).toLocaleDateString("cs-CZ")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-600">
                    {n.type === "new_project"
                      ? n.project_name
                      : `${n.unit_external_id ?? "?"} — ${n.project_name ?? ""}`}
                    {n.old_value && n.new_value && n.type === "price_change" && (
                      <span className="text-slate-400"> ({n.old_value} → {n.new_value})</span>
                    )}
                    {n.old_value && n.new_value && n.type === "availability_change" && (
                      <span className="text-slate-400"> ({n.old_value} → {n.new_value})</span>
                    )}
                  </p>
                  {n.affected_clients.length > 0 && (
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      Klienti: {n.affected_clients.join(", ")}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GlobalNav() {
  return (
    <header className="glass-header sticky top-0 z-30 mt-2 flex shrink-0 items-center justify-between gap-4 rounded-2xl px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <h1 className="shrink-0 text-lg font-semibold tracking-tight text-slate-900">
          Reamar
        </h1>
        <Suspense fallback={<NavLinksFallback />}>
          <NavLinks />
        </Suspense>
      </div>
      <NotificationBell />
    </header>
  );
}
