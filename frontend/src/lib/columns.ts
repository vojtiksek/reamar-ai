export type GenericColumn = {
  key: string;
  label?: string;
  data_type?: string;
  unit?: string | null;
  kind?: string | null;
  entity?: string | null;
  editable?: boolean | string | number | null;
};

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
 * - Uses the `editable` flag from field_catalog (supports bool/string/number).
 * - Excludes computed columns (`kind === "computed"`).
 * - Optionally filters by entity (`unit` / `project`) when provided.
 */
export function isEditableCatalogColumn(
  col: Pick<GenericColumn, "editable" | "kind" | "entity">,
  options?: { entity?: "unit" | "project" }
): boolean {
  const editable = normalizeEditableFlag(col.editable);
  if (!editable) return false;

  const kind = (col.kind ?? "").toString().toLowerCase();
  if (kind === "computed") return false;

  const wantedEntity = options?.entity;
  if (!wantedEntity) return true;

  const entity = (col.entity ?? "").toString().toLowerCase();
  // If entity is missing, treat as matching any.
  if (!entity) return true;

  return entity === wantedEntity;
}

