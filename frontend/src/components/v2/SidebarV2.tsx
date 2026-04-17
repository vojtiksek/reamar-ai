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

type Props = {
  collapsed: boolean;
  onToggle: () => void;
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
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  ),
};

const WORK_NAV: NavEntry[] = [
  {
    href: "/cases",
    label: "Klienti",
    icon: ICONS.users,
    match: (p) => p === "/" || p.startsWith("/cases") || p.startsWith("/clients"),
  },
];

const EXPLORER_NAV: NavEntry[] = [
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
    href: "/explorer/map",
    label: "Mapa",
    icon: ICONS.map,
    match: (p) => p.startsWith("/explorer/map"),
  },
  {
    href: "/future-projects",
    label: "Budoucí jednotky",
    icon: ICONS.clock,
    match: (p) => p.startsWith("/future-projects"),
  },
];

const ADMIN_NAV: NavEntry[] = [
  {
    href: "/admin/scoring",
    label: "Scoring",
    icon: ICONS.sliders,
    match: (p) =>
      p.startsWith("/admin/scoring") ||
      p.startsWith("/admin/studio") ||
      p.startsWith("/admin/scoring-v2"),
  },
  {
    href: "/admin",
    label: "Admin",
    icon: ICONS.shield,
    match: (p) =>
      (p.startsWith("/admin") &&
        !p.startsWith("/admin/scoring") &&
        !p.startsWith("/admin/studio") &&
        !p.startsWith("/admin/scoring-v2")) ||
      p.startsWith("/matches") ||
      p.startsWith("/analytics"),
  },
];

function NavGroup({
  label,
  items,
  pathname,
  collapsed,
}: {
  label: string;
  items: NavEntry[];
  pathname: string;
  collapsed: boolean;
}) {
  return (
    <>
      {!collapsed && <div className="rv2-sidebar-section-label">{label}</div>}
      {collapsed && <div className="rv2-sidebar-section-divider" aria-hidden />}
      <div className="rv2-sidebar-nav">
        {items.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="rv2-nav-item"
              data-active={active}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              <span className="rv2-nav-item-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

const CHEVRON_LEFT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const CHEVRON_RIGHT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export function SidebarV2({ collapsed, onToggle }: Props) {
  const pathname = usePathname() ?? "/";
  const { activeClient, deactivate } = useActiveClient();

  return (
    <aside className="rv2-sidebar" data-collapsed={collapsed}>
      <div className="rv2-sidebar-brand">
        <div className="rv2-sidebar-brand-mark">R</div>
        <div className="rv2-sidebar-brand-text">Reamar AI</div>
        <button
          type="button"
          className="rv2-sidebar-toggle"
          onClick={onToggle}
          title={collapsed ? "Rozbalit menu" : "Sbalit menu"}
          aria-label={collapsed ? "Rozbalit menu" : "Sbalit menu"}
        >
          {collapsed ? CHEVRON_RIGHT : CHEVRON_LEFT}
        </button>
      </div>

      <NavGroup label="Práce" items={WORK_NAV} pathname={pathname} collapsed={collapsed} />
      <NavGroup label="Explorer" items={EXPLORER_NAV} pathname={pathname} collapsed={collapsed} />
      <NavGroup label="Konfigurace" items={ADMIN_NAV} pathname={pathname} collapsed={collapsed} />

      <div className="rv2-sidebar-footer">
        {activeClient ? (
          <div
            className="rv2-client-chip"
            title={`Aktivní klient: ${activeClient.clientName}`}
          >
            <span className="rv2-client-chip-dot" aria-hidden />
            <Link
              href={`/cases/${activeClient.clientId}/brief`}
              className="rv2-client-chip-name"
            >
              {activeClient.clientName}
            </Link>
            {!collapsed && (
              <button
                type="button"
                onClick={deactivate}
                className="rv2-client-chip-close"
                title="Ukončit klientský mód"
                aria-label="Ukončit klientský mód"
              >
                ×
              </button>
            )}
          </div>
        ) : (
          !collapsed && (
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
          )
        )}
      </div>
    </aside>
  );
}
