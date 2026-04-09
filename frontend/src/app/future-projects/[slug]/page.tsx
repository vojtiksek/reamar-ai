"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_BASE } from "@/lib/api";
import { ReamarCard, ReamarButton } from "@/components/ui/reamar-ui";

type FutureProject = {
  id: number;
  name: string;
  slug: string;
  developer: string | null;
  address: string | null;
  stage: string | null;
  total_units: number | null;
  date_sale_start: string | null;
  construction_completion: string | null;
  project_type: string | null;
  url: string | null;
  renovation: boolean | null;
  city: string | null;
  municipal_district: string | null;
  region: string | null;
  public_data_json: Record<string, unknown> | null;
  interest_count: number;
  created_at: string;
};

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between border-b border-slate-100 py-2 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
    </div>
  );
}

export default function FutureProjectDetailPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const [project, setProject] = useState<FutureProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interestSent, setInterestSent] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!slug) return;
    const token = localStorage.getItem("broker_token");
    if (!token) { setError("Nepřihlášen"); setLoading(false); return; }
    fetch(`${API_BASE}/future-projects/by-slug/${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Projekt nenalezen")))
      .then((data: FutureProject) => setProject(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const handleInterest = async () => {
    if (!project) return;
    setSending(true);
    const token = localStorage.getItem("broker_token");
    await fetch(`${API_BASE}/future-projects/${project.id}/interests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ note: null }),
    });
    setSending(false);
    setInterestSent(true);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-slate-400">Načítám…</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-rose-600">{error ?? "Projekt nenalezen"}</p>
        <Link href="/future-projects" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
          ← Zpět na seznam
        </Link>
      </div>
    );
  }

  const pub = project.public_data_json ?? {};

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      {/* Back link */}
      <Link href="/future-projects" className="text-sm text-slate-500 hover:text-slate-700">
        ← Budoucí projekty
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{project.name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            project.stage === "Výstavba" ? "bg-blue-100 text-blue-700" :
            project.stage === "Dokončeno" ? "bg-emerald-100 text-emerald-700" :
            "bg-slate-100 text-slate-600"
          }`}>
            {project.stage || "V přípravě"}
          </span>
        </div>
        {project.developer && (
          <p className="mt-1 text-sm text-slate-500">{project.developer}</p>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        {project.renovation && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">Rekonstrukce</span>
        )}
        {!!pub.cooperative_housing && (
          <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">Družstevní bydlení</span>
        )}
        {project.project_type && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{project.project_type}</span>
        )}
      </div>

      {/* Main info */}
      <ReamarCard className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Základní informace</h2>
        <InfoRow label="Lokalita" value={[project.city, project.municipal_district].filter(Boolean).join(" — ") || project.address} />
        {project.city && project.address && project.address !== project.city && (
          <InfoRow label="Adresa" value={project.address} />
        )}
        <InfoRow label="Kraj" value={project.region} />
        <InfoRow label="Celkem jednotek" value={project.total_units?.toString()} />
        <InfoRow label="Zahájení prodeje" value={project.date_sale_start} />
        <InfoRow label="Dokončení" value={project.construction_completion} />
        {!!pub.building_use && <InfoRow label="Účel budovy" value={String(pub.building_use)} />}
      </ReamarCard>

      {/* Transport & Quality */}
      {!!(pub.ride_to_center || pub.public_transport_to_center || pub.transport_rating || pub.overall_quality || pub.standards_rating) && (
        <ReamarCard className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Doprava a kvalita</h2>
          {!!pub.ride_to_center && <InfoRow label="Autem do centra" value={`${String(pub.ride_to_center)} min`} />}
          {!!pub.public_transport_to_center && <InfoRow label="MHD do centra" value={`${String(pub.public_transport_to_center)} min`} />}
          {!!pub.transport_rating && <InfoRow label="Dopravní hodnocení" value={String(pub.transport_rating)} />}
          {!!pub.overall_quality && <InfoRow label="Celková kvalita" value={String(pub.overall_quality)} />}
          {!!pub.standards_rating && <InfoRow label="Standardy" value={String(pub.standards_rating)} />}
        </ReamarCard>
      )}

      {/* Web link */}
      {project.url && (
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          Webové stránky projektu →
        </a>
      )}

      {/* CTA */}
      <ReamarCard className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm font-semibold text-slate-800">Máte zájem o tento projekt?</p>
          <p className="text-xs text-slate-500">Zanechte nezávazný zájem a budeme vás informovat.</p>
        </div>
        {interestSent ? (
          <span className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-700">
            Zájem zaznamenán ✓
          </span>
        ) : (
          <ReamarButton variant="primary" size="sm" onClick={handleInterest} disabled={sending}>
            {sending ? "Odesílám…" : "Mám zájem o více informací"}
          </ReamarButton>
        )}
      </ReamarCard>
    </div>
  );
}
