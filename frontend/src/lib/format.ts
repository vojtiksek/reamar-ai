/**
 * Shared formatting helpers for currency, area, duration, percent, layout.
 * Used in table, summary bar, and unit detail.
 */

/** CZK: celá čísla, mezery mezi tisíci (1 234 567 Kč), bez desetinných míst. */
const CZK = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "CZK",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  useGrouping: true,
});

export function formatCurrencyCzk(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return CZK.format(Math.round(value));
}

/** Cena za m²: stejný styl jako CZK – celá čísla, mezery mezi tisíci, bez desetinných míst. */
const CZK_PER_M2 = new Intl.NumberFormat("cs-CZ", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  useGrouping: true,
});

export function formatCurrencyPerM2(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${CZK_PER_M2.format(Math.round(value))} Kč`;
}

export function formatAreaM2(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)} m²`;
}

export function formatMinutes(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  // Bez desetinných míst – jen celé minuty.
  return `${Math.round(Number(value))} min`;
}

/**
 * Percent formatter that supports both:
 * - fractions 0..1 (e.g. 0.2 -> 20 %)
 * - already-percent values 0..100 (e.g. 20 -> 20 %)
 */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const n = Number(value);
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${Math.round(pct)} %`;
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

  // Speciální slovník pro rekonstrukci (projekt/jednotka)
  if (catalogKey === "renovation") {
    const raw = String(value ?? "").toLowerCase();
    const isTrue =
      value === true ||
      ["true", "1", "yes", "ano"].includes(raw);
    return isTrue ? "rekonstrukce" : "novostavba";
  }

  // Žaluzie – necháme původní hodnoty z dat (preparation/true/false)
  if (catalogKey === "exterior_blinds") {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return num === 1 ? "true" : "false";
    }
    return String(value);
  }

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
    case "boolean": {
      const raw = String(value ?? "").toLowerCase();
      const isTrue =
        value === true ||
        ["true", "1", "yes", "ano"].includes(raw);
      return isTrue ? "ANO" : "NE";
    }
    case "integer": {
      const n = Number(value);
      return Number.isNaN(n) ? String(value) : `${Math.round(n)}`;
    }
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
 */
export function formatValue(value: unknown, meta: FormatValueMeta): string {
  const displayFormat = meta.display_format ?? "text";
  const catalogKey = meta.key;
  return formatByDisplayFormat(value, displayFormat, catalogKey);
}