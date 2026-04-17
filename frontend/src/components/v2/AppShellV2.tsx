"use client";

import { useEffect, useState } from "react";
import { SidebarV2 } from "./SidebarV2";
import { TopbarV2 } from "./TopbarV2";

const STORAGE_KEY = "reamar_sidebar_collapsed";

export function AppShellV2({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
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

  return (
    <div className="rv2-layout" data-sidebar={collapsed ? "collapsed" : "expanded"}>
      <SidebarV2 collapsed={collapsed} onToggle={toggle} />
      <div className="rv2-main">
        <TopbarV2 />
        <div className="rv2-main-inner">{children}</div>
      </div>
    </div>
  );
}
