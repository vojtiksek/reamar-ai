"use client";

/**
 * Normalized chip entry for displaying standards/amenities in read mode.
 * Both project detail and unit detail map their data to this format before rendering.
 */
export type ChipEntry = {
  key: string;
  label: string;
  /**
   * "yes"  — boolean true  → green "✓ Label"
   * "val"  — enum / text   → grey  "Label: value"
   * "no"   — boolean false → muted "— Label" (placed in collapsible)
   */
  variant: "yes" | "val" | "no";
  /** Display value string — required when variant="val" */
  value?: string;
};

type Props = {
  /** Positive items shown directly (variant "yes" or "val") */
  items: ChipEntry[];
  /** Items with value=false — shown inside a collapsible disclosure */
  falseItems?: ChipEntry[];
};

export function StandardsChips({ items, falseItems = [] }: Props) {
  if (items.length === 0 && falseItems.length === 0) return null;
  return (
    <>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((entry) =>
            entry.variant === "yes" ? (
              <span key={entry.key} className="rv2-chip rv2-chip-yes">✓ {entry.label}</span>
            ) : (
              <span key={entry.key} className="rv2-chip rv2-chip-val">
                <span style={{ opacity: 0.55 }}>{entry.label}:</span> {entry.value}
              </span>
            )
          )}
        </div>
      )}

      {falseItems.length > 0 && (
        <details className="mt-3 group">
          <summary
            className="cursor-pointer text-xs font-medium hover:opacity-80 transition-opacity"
            style={{ color: "var(--r-text-tertiary)" }}
          >
            <span className="group-open:hidden">+ {falseItems.length} s hodnotou Ne</span>
            <span className="hidden group-open:inline">Skrýt</span>
          </summary>
          <div
            className="mt-2 flex flex-wrap gap-2 rounded-lg p-3"
            style={{ background: "var(--r-surface-0)" }}
          >
            {falseItems.map((entry) => (
              <span key={entry.key} className="rv2-chip rv2-chip-no">— {entry.label}</span>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
