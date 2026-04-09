"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { API_BASE } from "@/lib/api";

const PORTAL_TABS = [
  { href: "/portal", label: "Přehled", exact: true },
  { href: "/portal/novostavby", label: "Novostavby" },
  { href: "/portal/budouci-projekty", label: "Budoucí projekty" },
  { href: "/portal/second-hand", label: "Second hand" },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [clientName, setClientName] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Skip auth check on the login page
  const isLoginPage = pathname === "/portal/login";

  useEffect(() => {
    if (isLoginPage) {
      setChecking(false);
      return;
    }

    const token = localStorage.getItem("portal_token");
    if (!token) {
      router.push("/portal/login");
      return;
    }

    // Verify session is still valid
    fetch(`${API_BASE}/portal/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Session invalid");
        return r.json();
      })
      .then((data: { name: string }) => {
        setClientName(data.name);
        setChecking(false);
      })
      .catch(() => {
        localStorage.removeItem("portal_token");
        localStorage.removeItem("portal_client_id");
        localStorage.removeItem("portal_client_name");
        router.push("/portal/login");
      });
  }, [isLoginPage, router]);

  // Login page renders without the portal chrome
  if (isLoginPage) return <div className="fixed inset-0 z-50 overflow-auto bg-slate-50">{children}</div>;

  if (checking) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Ověřuji přístup...</p>
      </div>
    );
  }

  const handleLogout = () => {
    localStorage.removeItem("portal_token");
    localStorage.removeItem("portal_client_id");
    localStorage.removeItem("portal_client_name");
    router.push("/portal/login");
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-slate-900">Reamar AI</h1>
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              Klientský portál
            </span>
          </div>
          <div className="flex items-center gap-3">
            {clientName && (
              <span className="text-sm text-slate-600">{clientName}</span>
            )}
            <button
              onClick={handleLogout}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
            >
              Odhlásit
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 px-4 pb-2">
          {PORTAL_TABS.map((tab) => {
            const active = tab.exact
              ? pathname === tab.href
              : pathname?.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={
                  active
                    ? "rounded-full bg-[#1E3A5F] px-3 py-1.5 text-sm font-medium text-white shadow-sm"
                    : "rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
