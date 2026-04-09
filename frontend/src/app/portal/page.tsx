"use client";

import Link from "next/link";
import { ReamarCard } from "@/components/ui/reamar-ui";

const SECTIONS = [
  {
    href: "/portal/novostavby",
    title: "Novostavby",
    description: "Doporučené jednotky na základě vašich preferencí.",
    color: "bg-emerald-100 text-emerald-700",
  },
  {
    href: "/portal/budouci-projekty",
    title: "Budoucí projekty",
    description: "Projekty v přípravě — zanechte nezávazný zájem.",
    color: "bg-blue-100 text-blue-700",
  },
  {
    href: "/portal/second-hand",
    title: "Second hand",
    description: "Starší nemovitosti na trhu. Brzy k dispozici.",
    color: "bg-slate-100 text-slate-500",
  },
];

export default function PortalDashboardPage() {
  const clientName =
    typeof window !== "undefined"
      ? localStorage.getItem("portal_client_name")
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          {clientName ? `Dobrý den, ${clientName}` : "Klientský portál"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Zde najdete přehled nabídek připravených na míru vašim preferencím.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="block">
            <ReamarCard className="flex h-full flex-col justify-between p-5 transition-shadow hover:shadow-md">
              <div>
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.color} mb-3`}>
                  {s.title}
                </span>
                <p className="text-sm text-slate-600">{s.description}</p>
              </div>
              <p className="mt-4 text-xs font-medium text-blue-600">
                {s.title === "Second hand" ? "Již brzy" : "Zobrazit"}
              </p>
            </ReamarCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
