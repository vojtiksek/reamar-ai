"use client";

import { useUiVersion } from "@/components/v2/useUiVersion";

export default function WizardLayout({ children }: { children: React.ReactNode }) {
  const v = useUiVersion();
  // In V1 the wizard takes over the whole screen (hides the global nav).
  // In V2 we keep the sidebar/topbar and wrap content in a 3-column layout.
  return (
    <div className={v === "v2" ? "rv2-wizard-container" : "wizard-fullscreen"}>
      {children}
    </div>
  );
}
