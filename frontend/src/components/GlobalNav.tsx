"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function navClass(active: boolean) {
  return [
    "rounded-full px-3.5 py-1.5 text-sm font-medium",
    active
      ? "bg-slate-900 text-white shadow-sm"
      : "text-slate-700 hover:bg-white hover:text-slate-900",
  ].join(" ");
}

export function GlobalNav() {
  const pathname = usePathname();

  const isUnits = pathname?.startsWith("/units");
  const isProjects = pathname?.startsWith("/projects") && !pathname?.startsWith("/projects/map");
  const isMap = pathname?.startsWith("/projects/map");
  const isClients = pathname?.startsWith("/clients");
  const isMatches = pathname?.startsWith("/matches");

  return (
    <header className="glass-header sticky top-0 z-30 mt-2 flex shrink-0 items-center justify-between gap-4 rounded-2xl px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <h1 className="shrink-0 text-lg font-semibold tracking-tight text-slate-900">
          Reamar
        </h1>
        <nav className="flex items-center rounded-full border border-white/40 bg-white/40 p-0.5 shadow-sm backdrop-blur">
          <Link href="/units" className={navClass(!!isUnits)}>
            Jednotky
          </Link>
          <Link href="/projects" className={navClass(!!isProjects)}>
            Projekty
          </Link>
          <Link href="/projects/map" className={navClass(!!isMap)}>
            Mapa
          </Link>
          <Link href="/clients" className={navClass(!!isClients)}>
            Klienti
          </Link>
          <Link href="/matches" className={navClass(!!isMatches)}>
            Matches
          </Link>
        </nav>
      </div>
    </header>
  );
}

