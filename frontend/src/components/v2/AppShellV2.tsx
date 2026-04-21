"use client";

import { useCallback, useEffect, useState } from "react";
import { SidebarV2 } from "./SidebarV2";
import { TopbarV2 } from "./TopbarV2";

const STORAGE_KEY = "reamar_sidebar_collapsed";

export function AppShellV2({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  return (
    <div
      className="rv2-layout"
      data-sidebar={collapsed ? "collapsed" : "expanded"}
      data-mobile-open={mobileOpen ? "true" : "false"}
    >
      <div className="rv2-sidebar-overlay" onClick={closeMobile} />
      <SidebarV2 collapsed={collapsed} onToggle={toggle} onMobileClose={closeMobile} />
      <div className="rv2-main">
        <TopbarV2 onMenuToggle={toggleMobile} />
        <div className="rv2-main-inner">{children}</div>
      </div>
    </div>
  );
}
