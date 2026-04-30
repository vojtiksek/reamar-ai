"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";

type Notification = {
  id: number;
  type: string;
  unit_external_id?: string | null;
  project_id?: number | null;
  project_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  affected_clients: string[];
  created_at: string;
};

function notificationHref(n: Notification): string | null {
  if (n.type === "new_project") {
    if (n.project_name) {
      return `/explorer/projects?project=${encodeURIComponent(n.project_name)}`;
    }
    return null;
  }
  // price_change / availability_change → unit detail
  if (n.unit_external_id) {
    return `/units/${encodeURIComponent(n.unit_external_id)}`;
  }
  return null;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
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
        className="relative rounded-full p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        title="Notifikace"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-5 w-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
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
            <p className="text-xs font-semibold text-slate-700">
              Notifikace (posledních 7 dní)
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">
                Žádné nové události
              </p>
            ) : (
              notifications.slice(0, 20).map((n) => {
                const href = notificationHref(n);
                const inner = (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          n.type === "price_change"
                            ? "bg-blue-500"
                            : n.type === "availability_change"
                              ? "bg-emerald-500"
                              : "bg-violet-500"
                        }`}
                      />
                      <span className="text-[11px] font-medium text-slate-800">
                        {n.type === "price_change"
                          ? "Změna ceny"
                          : n.type === "availability_change"
                            ? "Změna dostupnosti"
                            : "Nový projekt"}
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
                        <span className="text-slate-400">
                          {" "}
                          ({n.old_value} → {n.new_value})
                        </span>
                      )}
                      {n.old_value &&
                        n.new_value &&
                        n.type === "availability_change" && (
                          <span className="text-slate-400">
                            {" "}
                            ({n.old_value} → {n.new_value})
                          </span>
                        )}
                    </p>
                    {n.affected_clients.length > 0 && (
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        Klienti: {n.affected_clients.join(", ")}
                      </p>
                    )}
                  </>
                );
                const cls =
                  "block border-b border-slate-50 px-3 py-2 last:border-0 transition-colors";
                if (href) {
                  return (
                    <Link
                      key={n.id}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={`${cls} hover:bg-slate-50 cursor-pointer`}
                    >
                      {inner}
                    </Link>
                  );
                }
                return (
                  <div key={n.id} className={cls}>
                    {inner}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
