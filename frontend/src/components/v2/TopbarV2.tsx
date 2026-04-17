"use client";

import { NotificationBell } from "./NotificationBell";

export function TopbarV2() {
  return (
    <header className="rv2-topbar">
      <div className="rv2-topbar-search" role="search">
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
      </div>
      <div className="rv2-topbar-actions">
        <NotificationBell />
      </div>
    </header>
  );
}
