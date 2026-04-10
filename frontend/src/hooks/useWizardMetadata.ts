/**
 * useWizardMetadata — fetches wizard field metadata from the backend.
 *
 * Backend is source of truth for enum options, labels, and field types.
 * Results are cached in memory for the page lifetime (static data).
 *
 * Usage:
 *   const { fields, loaded } = useWizardMetadata();
 *   const heatingOptions = fields["heating_type"]?.options ?? FALLBACK;
 */

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────

export type MetadataOption = {
  value: string;
  label: string;
};

export type CompoundInfo = {
  states?: string[];
  state_labels?: Record<string, string>;
  sub_options?: MetadataOption[];
};

export type FieldMetadata = {
  key: string;
  field_type: string;
  label: string;
  section: string;
  scoring_role: string;
  options?: MetadataOption[];
  compound?: CompoundInfo;
  note?: string;
  /** Rendering semantics hint. "negative_constraint" = noise-style tri-state
   *  (ignore / prefer / must) where higher severity = more restrictive filter. */
  semantics?: "negative_constraint" | string;
  /** Labels for semantic states, keyed by state token. Used with `semantics`. */
  custom_state_labels?: Record<string, string>;
  /** Autocomplete hint for text fields — when set, the frontend renders an
   *  input + dropdown backed by GET /locations/suggest?scope=<suggest>.
   *  Free-text entry is still allowed; suggestions are a quick-pick. */
  suggest?: string;
  /** Multi-value text field — paired with `suggest`, renders chip selector. */
  multi?: boolean;
  /** Numeric field display hints (used by renderNumericField). */
  placeholder?: string;
  unit?: string;
  format?: "currency" | "percent" | "plain";
  min?: number;
  max?: number;
};

export type WizardMetadataResponse = {
  version: number;
  fields: Record<string, FieldMetadata>;
};

// ── Module-level cache ───────────────────────────────────────────────

let cached: WizardMetadataResponse | null = null;
let fetchPromise: Promise<WizardMetadataResponse> | null = null;

function fetchMetadata(): Promise<WizardMetadataResponse> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch(`${API_BASE}/wizard-metadata`)
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText);
      return res.json() as Promise<WizardMetadataResponse>;
    })
    .then((data) => {
      cached = data;
      return data;
    })
    .catch(() => {
      // On failure, return empty — frontend falls back to hardcoded options
      const empty: WizardMetadataResponse = { version: 0, fields: {} };
      cached = empty;
      return empty;
    });
  return fetchPromise;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useWizardMetadata(): {
  fields: Record<string, FieldMetadata>;
  loaded: boolean;
  version: number;
} {
  const [data, setData] = useState<WizardMetadataResponse | null>(cached);

  useEffect(() => {
    if (cached) {
      setData(cached);
      return;
    }
    fetchMetadata().then(setData);
  }, []);

  return {
    fields: data?.fields ?? {},
    loaded: !!data,
    version: data?.version ?? 0,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Get options for a wizard field, preferring backend metadata over fallback.
 * Use this in wizard renderers to get the correct options.
 *
 * @param fields - metadata fields from useWizardMetadata()
 * @param fieldKey - the field key as used in wizardModel (e.g. "heating_type")
 * @param sectionPrefix - optional section prefix for namespaced fields (e.g. "standards")
 * @param fallbackOptions - hardcoded options from wizardModel as fallback
 */
export function getFieldOptions(
  fields: Record<string, FieldMetadata>,
  fieldKey: string,
  sectionPrefix: string | undefined,
  fallbackOptions: MetadataOption[] | undefined,
): MetadataOption[] {
  // Try section-prefixed key first (e.g. "standards.recuperation")
  if (sectionPrefix) {
    const prefixed = fields[`${sectionPrefix}.${fieldKey}`];
    if (prefixed?.options?.length) return prefixed.options;
  }
  // Try bare key (e.g. "heating_type", "renovation_preference")
  const bare = fields[fieldKey];
  if (bare?.options?.length) return bare.options;
  // Fallback to hardcoded
  return fallbackOptions ?? [];
}

/**
 * Get compound info for a feature field (e.g. sub_options for air_conditioning).
 */
export function getCompoundInfo(
  fields: Record<string, FieldMetadata>,
  fieldKey: string,
  sectionPrefix?: string,
): CompoundInfo | undefined {
  if (sectionPrefix) {
    const prefixed = fields[`${sectionPrefix}.${fieldKey}`];
    if (prefixed?.compound) return prefixed.compound;
  }
  const bare = fields[fieldKey];
  return bare?.compound;
}

/**
 * Get semantic rendering hint for a field: `semantics` + ordered state labels.
 *
 * Returns undefined for fields that use the default priority picker.
 * Returns `{ semantics, states }` when the field declares a non-default
 * rendering mode such as `negative_constraint` (noise-style tri-state).
 *
 * `states` is an ordered array of `[stateKey, label]` pairs, preserving the
 * order declared in the backend metadata (Python dict insertion order).
 */
export function getFieldSemantics(
  fields: Record<string, FieldMetadata>,
  fieldKey: string,
  sectionPrefix?: string,
): { semantics: string; states: Array<[string, string]> } | undefined {
  const meta =
    (sectionPrefix && fields[`${sectionPrefix}.${fieldKey}`]) || fields[fieldKey];
  if (!meta?.semantics || !meta.custom_state_labels) return undefined;
  const states = Object.entries(meta.custom_state_labels);
  if (states.length === 0) return undefined;
  return { semantics: meta.semantics, states };
}
