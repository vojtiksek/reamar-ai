"use client";

import { SidebarV2 } from "./SidebarV2";
import { TopbarV2 } from "./TopbarV2";

export function AppShellV2({ children }: { children: React.ReactNode }) {
  return (
    <div className="rv2-layout">
      <SidebarV2 />
      <div className="rv2-main">
        <TopbarV2 />
        <div className="rv2-main-inner">{children}</div>
      </div>
    </div>
  );
}
