"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SidebarV2 } from "./SidebarV2";
import { TopbarV2 } from "./TopbarV2";
import { GlobalSearchPalette } from "./GlobalSearchPalette";

const STORAGE_KEY = "reamar_sidebar_collapsed";

export function AppShellV2({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, []);

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleMobile = useCallback(() => setMobileOpen((v) => !v), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const router = useRouter();

  // Global shortcuts: ⌘/Ctrl+K search, ⌘/Ctrl+Shift+L jump to last client
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        try {
          const raw = localStorage.getItem("reamar_last_client");
          if (raw) {
            const parsed = JSON.parse(raw) as { id?: number };
            if (parsed?.id) router.push(`/cases/${parsed.id}/recommendations`);
          }
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return (
    <div
      className="rv2-layout"
      data-sidebar={collapsed ? "collapsed" : "expanded"}
      data-mobile-open={mobileOpen ? "true" : "false"}
    >
      <div className="rv2-sidebar-overlay" onClick={closeMobile} />
      <SidebarV2 collapsed={collapsed} onToggle={toggle} onMobileClose={closeMobile} />
      <div className="rv2-main">
        <TopbarV2 onMenuToggle={toggleMobile} onSearchOpen={openSearch} />
        <div className="rv2-main-inner">{children}</div>
      </div>
      <GlobalSearchPalette open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
