"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import {
  applyFilter,
  type DashboardClient,
  type Filter,
  isStale,
  nextAction,
  nextRoute,
  priorityLabel,
  sortByPriority,
  stageFromClient,
} from "./_dashboard";

function compactLastTouch(c: DashboardClient): string {
  const d = c.last_note_at ?? c.created_at;
  const dt = new Date(d);
  const diff = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (diff < 1) return "dnes";
  if (diff < 7) return `${diff} dní`;
  if (diff < 30) return `${Math.floor(diff / 7)} týdnů`;
  return dt.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "2-digit" });
}
import { ClientInspectorV2, stageBadgeClass } from "./ClientInspectorV2";

const FILTERS: [Filter, string][] = [
  ["all", "Všichni"],
  ["attention", "Vyžaduje pozornost"],
  ["has_recs", "S doporučeními"],
  ["new", "Nový"],
];

export function ClientsListV2() {
  const [clients, setClients] = useState<DashboardClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem("broker_token")
        : null;
    if (!token) {
      setError("Nejste přihlášen – prosím přejděte na /login.");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/clients/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: DashboardClient[]) => setClients(data ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => applyFilter(clients, filter), [clients, filter]);
  const sorted = useMemo(() => sortByPriority(filtered), [filtered]);

  const highCount = clients.filter(
    (c) => c.priority === "high" || c.priority === "medium",
  ).length;
  const highOnlyCount = clients.filter((c) => c.priority === "high").length;
  const mediumCount = clients.filter((c) => c.priority === "medium").length;
  const recsCount = clients.filter((c) => c.recommendations_count > 0).length;

  const grouped =
    filter === "all"
      ? [
          {
            title: "Vyžaduje pozornost",
            items: sorted.filter(
              (c) => c.priority === "high" || c.priority === "medium",
            ),
          },
          {
            title: "Ostatní případy",
            items: sorted.filter(
              (c) => c.priority !== "high" && c.priority !== "medium",
            ),
          },
        ].filter((g) => g.items.length > 0)
      : [{ title: null, items: sorted }];

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedId) ?? null,
    [clients, selectedId],
  );

  return (
    <div className="rv2-page">
      <header className="rv2-page-header">
        <div>
          <h1 className="rv2-page-title">Případy</h1>
          <p className="rv2-page-subtitle">
            {clients.length} klientů · {highCount} vyžaduje pozornost
          </p>
        </div>
        <Link href="/clients/new">
          <button type="button" className="rv2-button rv2-button-primary">
            + Nový případ
          </button>
        </Link>
      </header>

      <div className="rv2-kpi-grid">
        <div className="rv2-kpi">
          <span className="rv2-kpi-label">Teď řešit</span>
          <span className="rv2-kpi-value" data-tone={highOnlyCount > 0 ? "danger" : undefined}>
            {highOnlyCount}
          </span>
          <span className="rv2-kpi-hint">Chybí zadání klienta.</span>
        </div>
        <div className="rv2-kpi">
          <span className="rv2-kpi-label">Ke kontrole</span>
          <span className="rv2-kpi-value" data-tone={mediumCount > 0 ? "warning" : undefined}>
            {mediumCount}
          </span>
          <span className="rv2-kpi-hint">Potřebují rychlé rozhodnutí.</span>
        </div>
        <div className="rv2-kpi">
          <span className="rv2-kpi-label">Aktivní s doporučeními</span>
          <span className="rv2-kpi-value">{recsCount}</span>
          <span className="rv2-kpi-hint">Je z čeho vybírat.</span>
        </div>
        <div className="rv2-kpi">
          <span className="rv2-kpi-label">Celkem klientů</span>
          <span className="rv2-kpi-value">{clients.length}</span>
          <span className="rv2-kpi-hint">Aktivní případy.</span>
        </div>
      </div>

      <div className="rv2-filter-row">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="rv2-filter-pill"
            data-active={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            {key === "attention" && highCount > 0 ? ` (${highCount})` : ""}
          </button>
        ))}
      </div>

      <div
        className="rv2-with-drawer"
        data-drawer-open={selectedClient ? "true" : "false"}
      >
        <div className="rv2-card">
          {loading ? (
            <div className="rv2-empty">Načítání…</div>
          ) : error ? (
            <div className="rv2-empty" style={{ color: "var(--r-state-danger)" }}>
              {error}
            </div>
          ) : sorted.length === 0 ? (
            <div className="rv2-empty">V tomto filtru není žádný případ.</div>
          ) : (
            <div className="rv2-card-scroll">
            <table className="rv2-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th aria-hidden style={{ width: 4 }} />
                  <th>Klient</th>
                  <th>Fáze</th>
                  <th>Priorita</th>
                  <th>Poslední aktivita</th>
                  <th>Doporučení</th>
                  <th>Další krok</th>
                  <th aria-hidden />
                </tr>
              </thead>
              {grouped.map((group, gi) => (
                <Fragment key={group.title ?? `g-${gi}`}>
                  {group.title && (
                    <tbody>
                      <tr>
                        <td
                          colSpan={8}
                          className="rv2-group-label"
                          style={{ cursor: "default" }}
                        >
                          {group.title} · {group.items.length}
                        </td>
                      </tr>
                    </tbody>
                  )}
                  <tbody>
                    {group.items.map((c) => {
                      const stage = stageFromClient(c);
                      const action = nextAction(c);
                      const href = nextRoute(c);
                      const isSelected = selectedId === c.id;
                      return (
                        <tr
                          key={c.id}
                          data-priority={c.priority}
                          data-selected={isSelected}
                          onClick={() => setSelectedId(c.id)}
                        >
                          <td className="rv2-col-priority" aria-hidden />
                          <td>
                            <div className="rv2-client-cell">
                              <span className="rv2-client-name">{c.name}</span>
                              <span className="rv2-client-meta">
                                {c.email && <span>{c.email}</span>}
                                {isStale(c) && (
                                  <span className="rv2-badge rv2-badge-stale">
                                    Bez aktivity
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className={`rv2-badge ${stageBadgeClass(stage.label)}`}>
                              {stage.label}
                            </span>
                          </td>
                          <td>
                            <span
                              className="rv2-priority-text"
                              data-priority={c.priority}
                            >
                              {priorityLabel(c)}
                            </span>
                          </td>
                          <td style={{ color: "var(--r-text-secondary)", whiteSpace: "nowrap" }}>
                            {compactLastTouch(c)}
                          </td>
                          <td>
                            <div className="rv2-recs-cell">
                              <span>{c.recommendations_count}</span>
                            </div>
                          </td>
                          <td style={{ color: "var(--r-text-primary)", fontWeight: 500 }}>
                            {action}
                          </td>
                          <td
                            className="rv2-col-chevron"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link
                              href={href}
                              aria-label="Přejít na další krok"
                              title="Přejít na další krok"
                              style={{ display: "block", padding: "0 4px" }}
                            >
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
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Fragment>
              ))}
            </table>
            </div>
          )}

          {!loading && !error && sorted.length > 0 && (
            <div
              style={{
                padding: "var(--r-space-3)",
                fontSize: "var(--r-font-12)",
                color: "var(--r-text-tertiary)",
                borderTop: "1px solid var(--r-border-subtle)",
                display: "flex",
                gap: "var(--r-space-4)",
                flexWrap: "wrap",
              }}
            >
              <span>Červený pruh = řešit hned</span>
              <span>Žlutý pruh = ke kontrole</span>
              <span>Klikni na řádek pro detail</span>
            </div>
          )}
        </div>

        {selectedClient && (
          <ClientInspectorV2
            client={selectedClient}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}

