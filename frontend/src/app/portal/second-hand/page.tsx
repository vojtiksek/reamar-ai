"use client";

import { ReamarCard } from "@/components/ui/reamar-ui";

export default function PortalSecondHandPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Second hand</h2>
        <p className="text-sm text-slate-500">Starší nemovitosti na trhu.</p>
      </div>

      <ReamarCard className="p-8 text-center">
        <p className="text-sm text-slate-500">Tato sekce bude brzy k dispozici.</p>
        <p className="mt-2 text-xs text-slate-400">
          Váš makléř vás bude informovat, jakmile bude připravena.
        </p>
      </ReamarCard>
    </div>
  );
}
