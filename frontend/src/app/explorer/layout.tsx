"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUiVersion } from "@/components/v2/useUiVersion";

const TABS = [
  { href: "/explorer/projects", label: "Projects" },
  { href: "/explorer/units", label: "Units" },
  { href: "/explorer/map", label: "Map" },
];

export default function ExplorerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const uiVersion = useUiVersion();

  // V2: sidebar už poskytuje Projekty/Jednotky/Mapa navigaci —
  // vnitřní "Market explorer" header + sub-tabs jsou zde redundantní.
  if (uiVersion === "v2") {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-4">
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Explorer</p>
            <h1 className="text-xl font-semibold text-slate-900">Market explorer</h1>
            <p className="mt-1 text-sm text-slate-500">
              Expert mode pro průzkum trhu. Cases zůstávají hlavní workflow.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">Projects</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">Units</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">Map</span>
          </div>
        </div>
      </div>

      <nav className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={active
                ? "rounded-full bg-[#1E3A5F] px-3 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
