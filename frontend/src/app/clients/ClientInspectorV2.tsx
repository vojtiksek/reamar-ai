"use client";

import Link from "next/link";
import {
  type DashboardClient,
  isStale,
  lastTouchLabel,
  nextAction,
  nextRoute,
  priorityLabel,
  stageFromClient,
  statusLabel,
} from "./_dashboard";

type Props = {
  client: DashboardClient;
  onClose: () => void;
};

export function ClientInspectorV2({ client, onClose }: Props) {
  const stage = stageFromClient(client);
  const action = nextAction(client);
  const href = nextRoute(client);

  return (
    <aside className="rv2-drawer" aria-label="Detail klienta">
      <header className="rv2-drawer-header">
        <div style={{ minWidth: 0 }}>
          <div className="rv2-drawer-title">{client.name}</div>
          <div className="rv2-drawer-subtitle">
            <span className={`rv2-badge ${stageBadgeClass(stage.label)}`}>{stage.label}</span>
            {isStale(client) && (
              <>
                {" "}
                <span className="rv2-badge rv2-badge-stale">Bez aktivity</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="rv2-drawer-close"
          onClick={onClose}
          aria-label="Zavřít detail"
        >
          ×
        </button>
      </header>

      <div className="rv2-drawer-body">
        <section className="rv2-drawer-section">
          <div className="rv2-drawer-section-label">Kontakt</div>
          <dl className="rv2-def-list">
            {client.email && (
              <>
                <dt>E-mail</dt>
                <dd>
                  <a href={`mailto:${client.email}`} style={{ color: "var(--r-brand)" }}>
                    {client.email}
                  </a>
                </dd>
              </>
            )}
            {client.phone && (
              <>
                <dt>Telefon</dt>
                <dd>
                  <a href={`tel:${client.phone}`} style={{ color: "var(--r-brand)" }}>
                    {client.phone}
                  </a>
                </dd>
              </>
            )}
            {!client.email && !client.phone && (
              <>
                <dt>Kontakt</dt>
                <dd style={{ color: "var(--r-text-tertiary)" }}>—</dd>
              </>
            )}
          </dl>
        </section>

        <section className="rv2-drawer-section">
          <div className="rv2-drawer-section-label">Stav případu</div>
          <dl className="rv2-def-list">
            <dt>Priorita</dt>
            <dd>
              <span className="rv2-priority-text" data-priority={client.priority}>
                {priorityLabel(client)}
              </span>
            </dd>
            <dt>Fáze</dt>
            <dd>{stage.label}</dd>
            <dt>Stav</dt>
            <dd>{statusLabel(client)}</dd>
            <dt>Další krok</dt>
            <dd style={{ fontWeight: 500 }}>{action}</dd>
          </dl>
        </section>

        <section className="rv2-drawer-section">
          <div className="rv2-drawer-section-label">Doporučení</div>
          <dl className="rv2-def-list">
            <dt>Celkem</dt>
            <dd>{client.recommendations_count}</dd>
          </dl>
        </section>

        <section className="rv2-drawer-section">
          <div className="rv2-drawer-section-label">Aktivita</div>
          <dl className="rv2-def-list">
            <dt>Poslední akce</dt>
            <dd>{lastTouchLabel(client)}</dd>
            <dt>Vytvořen</dt>
            <dd>{new Date(client.created_at).toLocaleDateString("cs-CZ")}</dd>
            {client.days_since_last_note != null && (
              <>
                <dt>Bez aktivity</dt>
                <dd
                  style={{
                    color: isStale(client)
                      ? "var(--r-state-warning)"
                      : "var(--r-text-primary)",
                  }}
                >
                  {client.days_since_last_note} dní
                </dd>
              </>
            )}
          </dl>
        </section>
      </div>

      <footer className="rv2-drawer-footer">
        <Link href={href} style={{ flex: 1 }}>
          <button type="button" className="rv2-button rv2-button-primary" style={{ width: "100%" }}>
            {action}
          </button>
        </Link>
        <Link href={`/cases/${client.id}/brief`}>
          <button type="button" className="rv2-button rv2-button-ghost">
            Brief
          </button>
        </Link>
      </footer>
    </aside>
  );
}

function stageBadgeClass(label: string): string {
  switch (label) {
    case "Nový":
      return "rv2-badge-neutral";
    case "Zadání hotové":
      return "rv2-badge-new";
    case "Doporučení":
      return "rv2-badge-recs";
    case "Užší výběr":
      return "rv2-badge-shortlist";
    default:
      return "rv2-badge-neutral";
  }
}

export { stageBadgeClass };
