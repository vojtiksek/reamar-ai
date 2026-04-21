"use client";

import Link from "next/link";

type Row = { label: string; value: string | null | undefined };

type Props = {
  projectId?: number | null;
  projectName?: string | null;
  developer?: string | null;
  /** Generic key-value rows rendered below project name + developer */
  rows?: Row[];
  unitUrl?: string | null;
  projectUrl?: string | null;
};

export function ProjectSidebarCard({
  projectId,
  projectName,
  developer,
  rows = [],
  unitUrl,
  projectUrl,
}: Props) {
  const hasLinks = Boolean(unitUrl || projectUrl);

  return (
    <div className="rv2-card">
      <div className="rv2-section-head">
        <h2 className="rv2-section-title">O projektu</h2>
        {projectId != null && (
          <Link
            href={`/projects/${projectId}`}
            className="text-xs font-medium hover:opacity-70 transition-opacity"
            style={{ color: "var(--r-text-secondary)" }}
          >
            Detail →
          </Link>
        )}
      </div>

      <div className="rv2-section-body space-y-2">
        {projectName && (
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>Projekt</p>
            <p className="text-sm font-semibold" style={{ color: "var(--r-text-primary)" }}>{projectName}</p>
          </div>
        )}

        {developer && (
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>Developer</p>
            <p className="text-sm font-medium" style={{ color: "var(--r-text-primary)" }}>{developer}</p>
          </div>
        )}

        {rows.filter((r) => r.value).map((r) => (
          <div key={r.label}>
            <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>{r.label}</p>
            <p className="text-sm font-medium" style={{ color: "var(--r-text-primary)" }}>{r.value}</p>
          </div>
        ))}

        {hasLinks && (
          <div
            className="flex flex-col gap-1 pt-2 border-t"
            style={{ borderColor: "var(--r-border-subtle)" }}
          >
            {unitUrl && (
              <a
                href={unitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium no-underline transition hover:opacity-80"
                style={{
                  borderColor: "var(--r-border-default)",
                  background: "var(--r-surface-2)",
                  color: "var(--r-text-secondary)",
                }}
              >
                ↗ Nabídka
              </a>
            )}
            {projectUrl && (
              <a
                href={projectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium no-underline transition hover:opacity-80"
                style={{
                  borderColor: "var(--r-border-default)",
                  background: "var(--r-surface-2)",
                  color: "var(--r-text-secondary)",
                }}
              >
                ↗ Web projektu
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
