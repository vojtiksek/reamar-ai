"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useActiveClient } from "@/contexts/ActiveClientContext";

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
    </header>
  );
}
