"use client";

import { NotificationBell } from "./NotificationBell";

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
      <div className="rv2-topbar-actions">
        <NotificationBell />
      </div>
    </header>
  );
}
