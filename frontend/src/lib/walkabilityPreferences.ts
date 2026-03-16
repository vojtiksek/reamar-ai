/**
 * Client walkability preferences: persisted in localStorage, used for personalized score.
 * Keys match backend WalkabilityPreferences (supermarket, pharmacy, park, …).
 */

export type WalkabilityPreferenceValue = "high" | "normal" | "ignore";

export type WalkabilityPreferences = {
  supermarket: WalkabilityPreferenceValue;
  pharmacy: WalkabilityPreferenceValue;
  park: WalkabilityPreferenceValue;
  restaurant: WalkabilityPreferenceValue;
  cafe: WalkabilityPreferenceValue;
  fitness: WalkabilityPreferenceValue;
  playground: WalkabilityPreferenceValue;
  kindergarten: WalkabilityPreferenceValue;
  primary_school: WalkabilityPreferenceValue;
  metro: WalkabilityPreferenceValue;
  tram: WalkabilityPreferenceValue;
  bus: WalkabilityPreferenceValue;
};

const STORAGE_KEY = "reamar_walkability_preferences";

export const DEFAULT_PREFERENCES: WalkabilityPreferences = {
  supermarket: "normal",
  pharmacy: "normal",
  park: "normal",
  restaurant: "normal",
  cafe: "normal",
  fitness: "normal",
  playground: "normal",
  kindergarten: "normal",
  primary_school: "normal",
  metro: "normal",
  tram: "normal",
  bus: "normal",
};

const VALID_VALUES: Set<string> = new Set(["high", "normal", "ignore"]);

function normalize(value: unknown): WalkabilityPreferenceValue {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_VALUES.has(s) ? (s as WalkabilityPreferenceValue) : "normal";
}

export function getDefaultPreferences(): WalkabilityPreferences {
  return { ...DEFAULT_PREFERENCES };
}

/**
 * Load preferences from localStorage. Falls back to defaults if missing or invalid.
 */
export function loadPreferences(): WalkabilityPreferences {
  if (typeof window === "undefined") {
    return getDefaultPreferences();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultPreferences();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: WalkabilityPreferences = { ...DEFAULT_PREFERENCES };
    for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof WalkabilityPreferences)[]) {
      if (key in parsed) {
        out[key] = normalize(parsed[key]);
      }
    }
    return out;
  } catch {
    return getDefaultPreferences();
  }
}

/**
 * Persist preferences to localStorage.
 */
export function savePreferences(prefs: WalkabilityPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota or other storage errors
  }
}

/**
 * Reset to default and clear from localStorage (optional: still save defaults).
 */
export function resetPreferences(): WalkabilityPreferences {
  const def = getDefaultPreferences();
  savePreferences(def);
  return def;
}

export function isPersonalizedActive(prefs: WalkabilityPreferences): boolean {
  const def = DEFAULT_PREFERENCES;
  return (Object.keys(def) as (keyof WalkabilityPreferences)[]).some((k) => prefs[k] !== def[k]);
}

const CATEGORY_LABELS_CZ: Record<keyof WalkabilityPreferences, string> = {
  supermarket: "Supermarket",
  pharmacy: "Lékárna",
  park: "Park",
  restaurant: "Restaurace",
  cafe: "Kavárna",
  fitness: "Fitness",
  playground: "Hřiště",
  kindergarten: "Školka",
  primary_school: "ZŠ",
  metro: "Metro",
  tram: "Tramvaj",
  bus: "Bus",
};

function preferenceLabel(value: WalkabilityPreferenceValue): string {
  if (value === "high") return "vysoká";
  if (value === "ignore") return "nezajímá";
  return "normální";
}

export function getNonDefaultChips(prefs: WalkabilityPreferences): string[] {
  const def = DEFAULT_PREFERENCES;
  const chips: string[] = [];
  for (const key of Object.keys(def) as (keyof WalkabilityPreferences)[]) {
    if (prefs[key] !== def[key]) {
      const label = CATEGORY_LABELS_CZ[key] ?? key;
      chips.push(`${label}: ${preferenceLabel(prefs[key])}`);
    }
  }
  return chips;
}
