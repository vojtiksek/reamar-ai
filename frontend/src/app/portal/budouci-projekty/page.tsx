"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { API_BASE } from "@/lib/api";
import { ReamarCard, ReamarButton } from "@/components/ui/reamar-ui";
import type { FutureProjectPin } from "@/app/future-projects/FutureProjectsMap";

const FutureProjectsMap = dynamic(() => import("@/app/future-projects/FutureProjectsMap"), { ssr: false });

type FutureProject = {
  id: number;
  name: string;
  slug: string;
  developer: string | null;
  city: string | null;
  municipal_district: string | null;
  stage: string | null;
  total_units: number | null;
  date_sale_start: string | null;
  construction_completion: string | null;
  project_type: string | null;
  url: string | null;
  renovation: boolean | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  public_data_json: Record<string, unknown> | null;
  my_interest: boolean;
};

function portalHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("portal_token") : null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function PortalFutureProjectsPage() {
  const [projects, setProjects] = useState<FutureProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/portal/future-projects`, { headers: portalHeaders() })
      .then((r) => {
        if (r.status === 401) throw new Error("Neplatná session");
        if (!r.ok) throw new Error("Chyba načítání");
        return r.json();
      })
      .then((data) => setProjects(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleInterest = async (fpId: number) => {
    setSendingId(fpId);
    try {
      const res = await fetch(`${API_BASE}/portal/future-projects/${fpId}/interest`, {
        method: "POST",
        headers: portalHeaders(),
      });
      if (res.ok) {
        setProjects((prev) =>
          prev.map((fp) => (fp.id === fpId ? { ...fp, my_interest: true } : fp))
        );
      }
    } finally {
      setSendingId(null);
    }
  };

  if (loading) return <p className="text-sm text-slate-400">Načítám projekty...</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Budoucí projekty</h2>
        <p className="text-sm text-slate-500">
          Projekty v přípravě. Zanechte nezávazný zájem a budeme vás informovat.
        </p>
      </div>

      {(() => {
        const pins: FutureProjectPin[] = projects
          .filter((fp) => fp.gps_latitude != null && fp.gps_longitude != null)
          .map((fp) => ({
            id: fp.id, name: fp.name, slug: fp.slug,
            lat: fp.gps_latitude!, lng: fp.gps_longitude!,
            developer: fp.developer, stage: fp.stage, total_units: fp.total_units,
            date_sale_start: fp.date_sale_start, construction_completion: fp.construction_completion,
          }));
        return pins.length > 0 ? <FutureProjectsMap pins={pins} linkPrefix={null} /> : null;
      })()}

      {projects.length === 0 && (
        <ReamarCard className="p-8 text-center">
          <p className="text-sm text-slate-500">Zatím žádné budoucí projekty.</p>
        </ReamarCard>
      )}

      <div className="grid gap-3">
        {projects.map((fp) => {
          const pub = fp.public_data_json ?? {};
          return (
            <ReamarCard key={fp.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800">{fp.name}</p>
                    {fp.renovation && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        Rekonstrukce
                      </span>
                    )}
                  </div>
                  {fp.developer && <p className="text-xs text-slate-500">{fp.developer}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {fp.city && (
                      <span>
                        {fp.city}
                        {fp.municipal_district ? ` \u2014 ${fp.municipal_district}` : ""}
                      </span>
                    )}
                    {fp.project_type && <span>{fp.project_type}</span>}
                    {fp.total_units != null && <span>{fp.total_units} jednotek</span>}
                    {fp.construction_completion && <span>Dokončení: {fp.construction_completion}</span>}
                    {fp.date_sale_start && <span>Prodej od: {fp.date_sale_start}</span>}
                  </div>
                  {!!(pub.ride_to_center || pub.public_transport_to_center) && (
                    <div className="mt-1 flex gap-x-3 text-[11px] text-slate-500">
                      {!!pub.ride_to_center && <span>Autem do centra: {String(pub.ride_to_center)} min</span>}
                      {!!pub.public_transport_to_center && (
                        <span>MHD do centra: {String(pub.public_transport_to_center)} min</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      fp.stage === "Výstavba"
                        ? "bg-blue-100 text-blue-700"
                        : fp.stage === "Dokončeno"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {fp.stage || "V přípravě"}
                  </span>

                  {fp.my_interest ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                      Zájem zaznamenán
                    </span>
                  ) : (
                    <ReamarButton
                      variant="primary"
                      size="sm"
                      onClick={() => handleInterest(fp.id)}
                      disabled={sendingId === fp.id}
                    >
                      {sendingId === fp.id ? "Odesílám..." : "Mám zájem"}
                    </ReamarButton>
                  )}
                </div>
              </div>
            </ReamarCard>
          );
        })}
      </div>
    </div>
  );
}
