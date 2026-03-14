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
 * Formát pro počet dní (např. „Dní na trhu“).
 */
export function formatDays(value: number | null | undefined): string {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value))} dní`;
}

/**
 * Percent formatter for display.
 * - Fractions 0..1 (e.g. 0.2) are always shown as percent (20 %).
 * - Values already in 0..100 are shown as-is (20 -> 20 %).
 * @param fractionDigits - optional number of decimal places (e.g. 1 -> "85.6 %")
 * @param treatZeroAsEmpty - if true, 0 is shown as "—" (for financing where 0 = nevyplněno)
 */
export function formatPercent(
  value: number | null | undefined,
  fractionDigits?: number,
  treatZeroAsEmpty?: boolean
): string {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  if (treatZeroAsEmpty && n === 0) return "—";
  const pct = n > 1 ? n : n * 100;
  if (fractionDigits != null && fractionDigits >= 0) {
    return `${pct.toFixed(fractionDigits)} %`;
  }
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

  // Odchylka od trhu je z backendu už v procentech (44.33 = 44,33 %) – nezobrazovat jako 4433 %
  if (
    catalogKey != null &&
    (catalogKey === "local_price_diff_1000m" || catalogKey === "local_price_diff_2000m")
  ) {
    const n = Number(value);
    if (Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return `${sign}${Math.abs(n).toFixed(1)} %`;
  }

  // Hluk (dB) – denní / noční
  if (catalogKey === "noise_day_db" || catalogKey === "noise_night_db") {
    const n = Number(value);
    if (value == null || value === "" || Number.isNaN(n)) return "—";
    return `${n} dB`;
  }
  // Hluk lokality (klasifikace)
  if (catalogKey === "noise_label") {
    if (value == null || String(value).trim() === "") return "—";
    return String(value);
  }

  switch (displayFormat) {
    case "currency":
      return formatCurrencyCzk(Number(value));
    case "currency_per_m2":
      return formatCurrencyPerM2(Number(value));
    case "area_m2":
      return formatAreaM2(Number(value));
    case "duration_minutes":
      return formatMinutes(Number(value));
    case "duration_days":
      return formatDays(Number(value));
    case "percent": {
      const isFinancing =
        catalogKey != null &&
        (catalogKey.includes("payment_contract") ||
          catalogKey.includes("payment_construction") ||
          catalogKey.includes("payment_occupancy"));
      return formatPercent(Number(value), undefined, isFinancing);
    }
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