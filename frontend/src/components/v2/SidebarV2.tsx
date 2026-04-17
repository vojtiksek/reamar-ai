"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActiveClient } from "@/contexts/ActiveClientContext";

type NavEntry = {
  href: string;
  label: string;
  match: (path: string) => boolean;
  icon: React.ReactNode;
};

const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  building: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="1" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 15.09 8.26 22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2Z" />
    </svg>
  ),
  sliders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  ),
};

const MAIN_NAV: NavEntry[] = [
  {
    href: "/cases",
    label: "Klienti",
    icon: ICONS.users,
    match: (p) => p === "/" || p.startsWith("/cases") || p.startsWith("/clients"),
  },
  {
    href: "/explorer/projects",
    label: "Projekty",
    icon: ICONS.building,
    match: (p) => p.startsWith("/explorer/projects") || p.startsWith("/projects"),
  },
  {
    href: "/explorer/units",
    label: "Jednotky",
    icon: ICONS.grid,
    match: (p) => p.startsWith("/explorer/units") || p.startsWith("/units"),
  },
  {
    href: "/future-projects",
    label: "Budoucí projekty",
    icon: ICONS.clock,
    match: (p) => p.startsWith("/future-projects"),
  },
];

const ADMIN_NAV: NavEntry[] = [
  {
    href: "/admin/studio",
    label: "Scoring Studio",
    icon: ICONS.sliders,
    match: (p) => p.startsWith("/admin/studio"),
  },
  {
    href: "/admin",
    label: "Admin",
    icon: ICONS.shield,
    match: (p) =>
      (p.startsWith("/admin") && !p.startsWith("/admin/studio")) ||
      p.startsWith("/matches") ||
      p.startsWith("/analytics"),
  },
];

function NavGroup({ label, items, pathname }: { label: string; items: NavEntry[]; pathname: string }) {
  return (
    <>
      <div className="rv2-sidebar-section-label">{label}</div>
      <div className="rv2-sidebar-nav">
        {items.map((item) => {
          const active = item.match(pathname);
          return (
            <Link key={item.href} href={item.href} className="rv2-nav-item" data-active={active}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export function SidebarV2() {
  const pathname = usePathname() ?? "/";
  const { activeClient, deactivate } = useActiveClient();

  return (
    <aside className="rv2-sidebar">
      <div className="rv2-sidebar-brand">
        <div className="rv2-sidebar-brand-mark">R</div>
        <div className="rv2-sidebar-brand-text">Reamar AI</div>
      </div>

      <NavGroup label="Práce" items={MAIN_NAV} pathname={pathname} />
      <div style={{ height: 8 }} />
      <NavGroup label="Konfigurace" items={ADMIN_NAV} pathname={pathname} />

      <div className="rv2-sidebar-footer">
        {activeClient ? (
          <div className="rv2-client-chip" title="Aktivní klient">
            <span className="rv2-client-chip-dot" aria-hidden />
            <Link
              href={`/cases/${activeClient.clientId}/brief`}
              className="rv2-client-chip-name"
            >
              {activeClient.clientName}
            </Link>
            <button
              type="button"
              onClick={deactivate}
              className="rv2-client-chip-close"
              title="Ukončit klientský mód"
              aria-label="Ukončit klientský mód"
            >
              ×
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: "8px 12px",
              fontSize: "var(--r-font-11)",
              color: "var(--r-text-on-inverse-muted)",
              letterSpacing: "var(--r-tracking-wide)",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title="Žádný aktivní klient"
          >
            Bez klienta
          </div>
        )}
      </div>
    </aside>
  );
}
