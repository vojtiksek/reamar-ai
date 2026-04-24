"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";

type LastClient = { id: number; name: string; at: number };

function LastClientLink() {
  const [last, setLast] = useState<LastClient | null>(null);
  useEffect(() => {
    const refresh = () => {
      try {
        const raw = localStorage.getItem("reamar_last_client");
        if (raw) {
          const parsed = JSON.parse(raw) as LastClient;
          if (parsed?.id) setLast(parsed);
        } else {
          setLast(null);
        }
      } catch { /* ignore */ }
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  if (!last) return null;
  const label = last.name && last.name.length > 18 ? last.name.slice(0, 17) + "…" : last.name || `#${last.id}`;
  return (
    <Link
      href={`/cases/${last.id}/recommendations`}
      title={`Poslední klient: ${last.name || "#" + last.id} (⌘⇧L)`}
      className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
    >
      <span aria-hidden>↶</span>
      <span>{label}</span>
    </Link>
  );
}

type Props = {
  onMenuToggle: () => void;
  onSearchOpen: () => void;
};

export function TopbarV2({ onMenuToggle, onSearchOpen }: Props) {
  return (
    <header className="rv2-topbar">
      <button
        type="button"
        className="rv2-topbar-hamburger"
        onClick={onMenuToggle}
        aria-label="Otevřít menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <button
        type="button"
        className="rv2-topbar-search"
        onClick={onSearchOpen}
        aria-label="Vyhledat"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>Hledat klienta, projekt nebo jednotku…</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="rv2-topbar-actions" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <LastClientLink />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
