/**
 * Shared formatting helpers for currency, area, duration, percent, layout.
 * Used in table, summary bar, and unit detail.
 */

const CZK = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "CZK",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

export function formatCurrencyCzk(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return CZK.format(Math.round(value));
}

const CZK_PER_M2 = new Intl.NumberFormat("cs-CZ", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

export function formatCurrencyPerM2(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${CZK_PER_M2.format(Math.round(value))} Kč/m²`;
}

export function formatAreaM2(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)} m²`;
}

export function formatMinutes(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)} min`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value)} %`;
}

/**
 * Map layout value from API (e.g. "layout_2", "1+1") to display "2+kk", "1+kk".
 * layout_0 -> "garsonka", layout_1 -> "1+kk", layout_2 -> "2+kk", etc.
 */
export function formatLayout(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const s = String(value).trim();
  const match = /^layout_(\d+)$/i.exec(s);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n === 0) return "garsonka";
    return `${n}+kk`;
  }
  if (/^\d+\+\d+$/i.test(s)) return s;
  return s;
}

/**
 * Format a cell value by display_format from catalog.
 */
export function formatByDisplayFormat(
  value: unknown,
  displayFormat: string,
  catalogKey?: string
): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "ANO" : "NE";
  if (catalogKey === "layout" && typeof value === "string") return formatLayout(value);
  switch (displayFormat) {
    case "currency":
      return formatCurrencyCzk(Number(value));
    case "currency_per_m2":
      return formatCurrencyPerM2(Number(value));
    case "area_m2":
      return formatAreaM2(Number(value));
    case "duration_minutes":
      return formatMinutes(Number(value));
    case "percent":
      return formatPercent(Number(value));
    case "integer":
      return Number.isNaN(Number(value)) ? String(value) : `${Math.round(Number(value))}`;
    default:
      return String(value);
  }
}

export type FormatValueMeta = {
  display_format?: string;
  unit_label?: string;
  key?: string;
};

/**
 * Format a value for display using catalog meta (display_format, unit_label, key).
 * Uses display_format for currency, area_m2, duration_minutes, percent, boolean, layout enum.
 */
export function formatValue(value: unknown, meta: FormatValueMeta): string {
  const displayFormat = meta.display_format ?? "text";
  const catalogKey = meta.key;
  return formatByDisplayFormat(value, displayFormat, catalogKey);
}
