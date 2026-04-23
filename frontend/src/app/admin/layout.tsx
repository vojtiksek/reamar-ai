"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/scoring", label: "Scoring" },
  { href: "/admin/nabidka", label: "Nabídka" },
  { href: "/admin/operace", label: "Operace" },
  { href: "/admin/future-projects", label: "Budoucí projekty" },
  { href: "/admin/brokers", label: "Brokeři" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-4">
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin</p>
        <h1 className="text-xl font-semibold text-slate-900">Admin & operations</h1>
        <p className="mt-1 text-sm text-slate-500">Nastavení scoringu, provozní přehled a interní nástroje.</p>
      </div>
      <nav className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link key={tab.href} href={tab.href} className={active ? "rounded-full bg-[#1E3A5F] px-3 py-1.5 text-sm font-medium text-white shadow-sm" : "rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
