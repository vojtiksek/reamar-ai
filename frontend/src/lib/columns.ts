export type GenericColumn = {
  key: string;
  label?: string;
  data_type?: string;
  unit?: string | null;
  kind?: string | null;
  entity?: string | null;
  editable?: boolean | string | number | null;
};

// Keep in sync with backend OVERRIDEABLE_FIELDS in overrides.py
const UNIT_OVERRIDEABLE_FIELDS = new Set<string>([
  "price_czk",
  "price_per_m2_czk",
  "available",
  "availability_status",
  "floor_area_m2",
  "equivalent_area_m2",
  "exterior_area_m2",
]);

function normalizeEditableFlag(raw: GenericColumn["editable"]): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  if (typeof raw === "number") return raw === 1;
  const s = String(raw).trim().toLowerCase();
  if (!s) return false;
  return s === "ano" || s === "yes" || s === "true" || s === "1";
}

/**
 * Shared helper for deciding if a catalog column is editable.
 *
 * - For unit columns: uses backend UNIT_OVERRIDEABLE_FIELDS (attr-keyed).
 * - For project columns: uses the `editable` flag from field_catalog (supports bool/string/number),
 *   and excludes computed columns (`kind === "computed"`).
 * - Optionally filters by entity (`unit` / `project`) when provided.
 */
export function isEditableCatalogColumn(
  col: Pick<GenericColumn, "key" | "editable" | "kind" | "entity">,
  options?: { entity?: "unit" | "project" }
): boolean {
  const colEntity = (col.entity ?? options?.entity ?? "").toString().toLowerCase();

  // Units: use explicit overrideable allowlist, keyed by DB attribute / accessor
  if (colEntity === "unit") {
    const key = (col.key ?? "").toString();
    if (!key) return false;
    return UNIT_OVERRIDEABLE_FIELDS.has(key);
  }

  // Projects (and any other entities): use CSV Editable flag + non-computed
  const editable = normalizeEditableFlag(col.editable);
  if (!editable) return false;

  const kind = (col.kind ?? "").toString().toLowerCase();
  if (kind === "computed") return false;

  const wantedEntity = options?.entity;
  if (!wantedEntity) return true;

  const entity = colEntity;
  // If entity is missing, treat as matching any.
  if (!entity) return true;

  return entity === wantedEntity;
}


