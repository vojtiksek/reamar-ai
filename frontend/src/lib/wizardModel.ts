/**
 * wizardModel.ts — Shared wizard field & step definitions.
 *
 * Single source of truth for:
 *   - what fields exist in the wizard
 *   - their labels, types, options
 *   - which section/step they belong to
 *   - who sees them (client / broker / both)
 *   - whether they are hard filters, preferences, or context
 *
 * Used by: fullscreen client wizard, broker quick-edit (future), summary views.
 * Does NOT contain save/load logic (that stays in useCaseData).
 * Does NOT contain backend transform (that stays in wizardTransform).
 */

// ── Types ─────────────────────────────────────────────────────────────

/** How the field is rendered in the UI. */
export type FieldRender =
  | "toggle"       // single-select option cards
  | "multi-toggle" // multi-select option cards
  | "enum"         // multi-select chips (e.g. heating_type)
  | "feature"      // priority picker (must / prefer / bonus)
  | "numeric"      // number input
  | "text"         // text input
  | "date"         // date input
  | "bool_toggle"  // boolean status pill (read-only when `note: "edited_on_map"`)
  | "layout"       // layout selector (special: reads from profile + selectedLayouts)
  | "readonly";    // display only (legacy — prefer bool_toggle for new fields)

/** What role this field plays in the scoring pipeline. */
export type FieldRole =
  | "hard_filter"  // can exclude units (budget_max, area_min, must_*)
  | "preference"   // ranks but doesn't exclude (prefer_*, enum values)
  | "context";     // metadata, not used in scoring (client_type, timeline)

/** Who sees this field. */
export type FieldVisibility = "client" | "broker" | "both";

/** A single option for toggle/enum fields. */
export type FieldOption = {
  value: string;
  label: string;
  icon?: string;
  desc?: string;
};

/** Conditional visibility rule.
 *  The field is rendered only when the referenced wizard field equals
 *  the given value.  `field` uses the same dot-notation as `dataPath`
 *  (top-level key, or "section.key"). */
export type FieldVisibleWhen = {
  field: string;
  equals: string | boolean | number;
};

/** Core field definition. */
export type WizardField = {
  key: string;
  label: string;
  render: FieldRender;
  role: FieldRole;
  visibility: FieldVisibility;
  /** Dot-notation path in wizardExtras, e.g. "standards.heating_type" or "budget.max_price_tolerance_pct".
   *  Top-level keys omit the dot: "client_type", "renovation_preference". */
  dataPath: string;
  /** For toggle/enum fields. */
  options?: FieldOption[];
  /** For numeric fields. */
  unit?: string;
  /** Numeric format hint — drives display formatting. */
  format?: "currency" | "percent" | "plain";
  placeholder?: string;
  /** Group within a step (for visual sub-sections). */
  group?: string;
  /** Conditional visibility — hides the field unless the rule matches.
   *  Renderers read this via `isFieldVisible(f, wizardExtras)`. */
  visible_when?: FieldVisibleWhen;
  /** For toggle fields: whether clicking the active card clears the value.
   *  Default true.  Set to false when the field has no meaningful "unset"
   *  state (e.g. renovation_preference always holds a value). */
  allow_deselect?: boolean;
};

/** A group of fields rendered together with a heading. */
export type WizardFieldGroup = {
  key: string;
  heading: string;
  description?: string;
  fields: WizardField[];
};

/** A wizard step. */
export type WizardStep = {
  key: string;
  index: number;
  label: string;
  visibility: FieldVisibility;
  groups: WizardFieldGroup[];
};

// ── Field definitions ─────────────────────────────────────────────────

// Step 1: O vás

const PURCHASE_PURPOSE: WizardField = {
  key: "purchase_purpose",
  label: "K čemu bydlení hledáte?",
  render: "toggle",
  role: "context",
  visibility: "client",
  dataPath: "profile.purchase_purpose",
  // You always either buy for own use or investment — clicking the active
  // option should NOT clear it (preserves the original hardcoded behavior).
  allow_deselect: false,
  options: [
    { value: "own_use", label: "Vlastní bydlení", icon: "🏠", desc: "Bydlení pro sebe nebo rodinu" },
    { value: "investment", label: "Investice", icon: "📈", desc: "Nákup za účelem investice" },
  ],
};

const CLIENT_TYPE: WizardField = {
  key: "client_type",
  label: "Kdo bude v bytě bydlet?",
  render: "toggle",
  role: "context",
  visibility: "client",
  dataPath: "client_type",
  options: [
    { value: "family", label: "Rodina", icon: "👨‍👩‍👧‍👦" },
    { value: "couple", label: "Pár", icon: "💑" },
    { value: "single", label: "Jednotlivec", icon: "🧑" },
    { value: "downsizing", label: "Downsizing", icon: "🏡" },
  ],
};

const PURCHASE_TIMELINE: WizardField = {
  key: "purchase_timeline",
  label: "Časový horizont",
  render: "toggle",
  role: "context",
  visibility: "client",
  dataPath: "purchase_timeline",
  options: [
    { value: "now", label: "Hned" },
    { value: "3m", label: "Do 3 měsíců" },
    { value: "6m", label: "Do 6 měsíců" },
    { value: "1y", label: "Do roka" },
    { value: "2y+", label: "Za 2+ let" },
    { value: "mapping", label: "Jen mapuji" },
  ],
};

// Step 2: Rozpočet

const BUDGET_MAX: WizardField = {
  key: "budget_max",
  label: "Maximální cena",
  render: "numeric",
  role: "hard_filter",
  visibility: "client",
  dataPath: "profile.budget_max",
  unit: "Kč",
  format: "currency",
  placeholder: "Absolutní strop",
};

const BUDGET_MAX_TOLERANCE: WizardField = {
  key: "budget_max_tolerance_pct",
  label: "Tolerance rozpočtu",
  render: "numeric",
  role: "hard_filter",
  // Client-facing in the fullscreen wizard — tolerance is part of the
  // primary budget question, not a broker-only override.
  visibility: "both",
  dataPath: "budget.max_price_tolerance_pct",
  unit: "%",
  format: "percent",
  placeholder: "Např. 10",
};

const FINANCING_TYPE: WizardField = {
  key: "financing_type",
  label: "Jak budete financovat?",
  render: "toggle",
  role: "context",
  visibility: "client",
  dataPath: "financing_type",
  options: [
    { value: "cash", label: "Hotově", desc: "Celá částka v hotovosti" },
    { value: "mortgage", label: "Hypotéka", desc: "Financování hypotékou" },
    { value: "combo", label: "Kombinace", desc: "Hotovost + hypotéka" },
    { value: "unknown", label: "Nevím", desc: "Zatím nerozhodnutý/á" },
  ],
};

const MAX_PAYMENT_CONTRACT: WizardField = {
  key: "max_payment_contract_pct",
  label: "Max. záloha při smlouvě",
  render: "numeric",
  role: "hard_filter",
  visibility: "broker",
  dataPath: "budget.max_payment_contract_pct",
  unit: "%",
  placeholder: "Např. 20",
};

const MAX_PAYMENT_CONSTRUCTION: WizardField = {
  key: "max_payment_construction_pct",
  label: "Max. platba při výstavbě",
  render: "numeric",
  role: "hard_filter",
  visibility: "broker",
  dataPath: "budget.max_payment_construction_pct",
  unit: "%",
  placeholder: "Např. 30",
};

const MAX_DAYS_ON_MARKET: WizardField = {
  key: "max_days_on_market",
  label: "Max. dní na trhu",
  render: "numeric",
  role: "hard_filter",
  visibility: "broker",
  dataPath: "budget.max_days_on_market",
  unit: "dní",
  format: "plain",
  placeholder: "Např. 180",
};

// Step 3: Dispozice a prostor

const LAYOUTS: WizardField = {
  key: "layouts",
  label: "Jakou dispozici hledáte?",
  render: "layout",
  role: "hard_filter",
  visibility: "client",
  dataPath: "selectedLayouts",
};

const AREA_MIN: WizardField = {
  key: "area_min",
  label: "Minimální plocha",
  render: "numeric",
  role: "hard_filter",
  visibility: "client",
  dataPath: "profile.area_min",
  unit: "m²",
  format: "plain",
  placeholder: "Absolutní minimum",
};

const AREA_MIN_TOLERANCE: WizardField = {
  key: "area_min_tolerance_pct",
  label: "Tolerance plochy",
  render: "numeric",
  role: "hard_filter",
  visibility: "both",
  dataPath: "budget.max_area_tolerance_pct",
  unit: "%",
  format: "percent",
  placeholder: "Např. 10",
};

const MIN_OUTDOOR_AREA: WizardField = {
  key: "min_outdoor_area_m2",
  label: "Minimální venkovní prostor",
  render: "numeric",
  role: "hard_filter",
  visibility: "client",
  // NOTE: moved from "budget.*" to "outdoor.*" to align with
  // wizardTransform (reads outdoor.min_outdoor_area_m2) and backend
  // unit_report (reads wizard.outdoor.min_outdoor_area_m2).  The old
  // budget path was a dead write that never reached scoring.
  dataPath: "outdoor.min_outdoor_area_m2",
  unit: "m²",
  format: "plain",
  placeholder: "Např. 5",
};

const OUTDOOR_TOLERANCE: WizardField = {
  key: "outdoor_tolerance_pct",
  label: "Tolerance venkovní plochy",
  render: "numeric",
  role: "hard_filter",
  visibility: "both",
  dataPath: "budget.max_outdoor_tolerance_pct",
  unit: "%",
  format: "percent",
  placeholder: "Např. 10",
};

// OUTDOOR_TYPE (balcony/terrace/garden priority picker) was removed.
// Developer naming for outdoor spaces varies significantly and asking the
// client to pick a type created more friction than value.  The outdoor
// section now only asks for minimum outdoor area + broker tolerance.

const FLOOR_RULE: WizardField = {
  key: "floor_rule",
  label: "Patro",
  render: "toggle",
  role: "hard_filter",
  visibility: "client",
  dataPath: "outdoor.floor_rule",
  // Deselect is covered by the explicit "ignore" option.  Matches the
  // historical hardcoded behavior (clicking active option was a no-op).
  allow_deselect: false,
  options: [
    { value: "ignore", label: "Neřeším" },
    { value: "no_ground", label: "Ne přízemí" },
    { value: "top_3", label: "Horní 3 patra" },
    { value: "top_1", label: "Nejvyšší patro" },
  ],
};

// Step 4: Lokalita

const ADMIN_AREA: WizardField = {
  key: "administrative_area",
  label: "Preferované části v této oblasti",
  render: "text",
  // Default role is soft preference: ranking boost inside the polygon.
  // Promoted to hard filter only when the broker opts in via METHOD_ADMIN.
  role: "preference",
  visibility: "client",
  dataPath: "location.administrative_area",
  placeholder: "Např. Praha 6",
};

const ADMIN_REGION: WizardField = {
  key: "administrative_region",
  label: "Region / kraj",
  render: "text",
  role: "hard_filter",
  visibility: "client",
  dataPath: "location.administrative_region",
  placeholder: "Např. Praha, Středočeský kraj",
};

const CALM_VS_CITY: WizardField = {
  key: "calm_vs_city",
  label: "Klidné bydlení vs. městský život",
  render: "toggle",
  role: "preference",
  visibility: "client",
  // dataPath intentionally NOT migrated — stays at character.calm_vs_city
  // so backend/transform contract doesn't change.  Only the rendering
  // switches to the generic renderToggleField.
  dataPath: "character.calm_vs_city",
  // Deselect is covered by the explicit "ignore" option.
  allow_deselect: false,
  options: [
    { value: "calm", label: "Klidné okolí" },
    { value: "city", label: "Městský život" },
    { value: "ignore", label: "Neřeším" },
  ],
};

const CENTER_PREFERENCE: WizardField = {
  key: "center_preference",
  label: "Vzdálenost od centra",
  render: "toggle" as const,
  role: "preference" as const,
  visibility: "both" as const,
  dataPath: "character.center_preference",
  options: [
    { value: "closer", label: "Blíž k centru" },
    { value: "farther", label: "Dál od centra" },
  ],
  allow_deselect: true,
};

// Location method status fields — edited via the map editor / commute
// editor, displayed here as metadata-driven status pills so the broker
// sees at a glance whether the methods are active on a given case.
// Keys mirror backend metadata (`location.method_polygon`, etc.) so the
// generic metadata lookup finds them by section-prefixed key.

const POLYGON_LOCATION: WizardField = {
  key: "method_polygon",
  label: "Vybraná oblast na mapě",
  render: "bool_toggle",
  role: "hard_filter",
  visibility: "both",
  dataPath: "location.method_polygon",
};

const COMMUTE_LOCATION: WizardField = {
  key: "method_commute",
  label: "Dojezdové body",
  render: "bool_toggle",
  role: "hard_filter",
  visibility: "both",
  dataPath: "location.method_commute",
};

const COMMUTE_MODE: WizardField = {
  key: "commute_mode",
  label: "Režim dojezdů",
  render: "toggle" as const,
  role: "preference" as const,
  visibility: "broker" as const,
  dataPath: "location.commute_mode",
  options: [
    { value: "compromise", label: "Kompromis" },
    { value: "primary", label: "Hlavní bod" },
    { value: "sum", label: "Celkový čas" },
  ],
  allow_deselect: true,
};

// Opt-in toggle that promotes `administrative_area` from soft preference
// to hard filter.  Wording is intentionally explicit — without this flag
// the area list only boosts ranking inside the polygon.
const METHOD_ADMIN: WizardField = {
  key: "method_admin",
  label: "Hledat pouze v preferovaných oblastech",
  render: "bool_toggle",
  role: "hard_filter",
  visibility: "both",
  dataPath: "location.method_admin",
};

// Step 5: Standardy bytu — enum attributes

export const STANDARD_ENUMS: WizardField[] = [
  {
    key: "heating_type", label: "Typ vytápění", render: "enum",
    role: "preference", visibility: "client", dataPath: "standards.heating_type",
    options: [
      { value: "underfloor", label: "Podlahové" },
      { value: "radiators", label: "Radiátory" },
      { value: "combined", label: "Kombinace" },
    ],
  },
  {
    key: "heating_source", label: "Zdroj vytápění", render: "enum",
    role: "preference", visibility: "client", dataPath: "standards.heating_source",
    options: [
      { value: "heat_pump", label: "Tepelné čerpadlo" },
      { value: "gas", label: "Plyn" },
      { value: "central", label: "Centrální" },
    ],
  },
  {
    key: "window_material", label: "Typ oken", render: "enum",
    role: "preference", visibility: "client", dataPath: "standards.window_material",
    options: [
      { value: "pvc", label: "Plast" },
      { value: "wood", label: "Dřevo" },
      { value: "aluminum", label: "Hliník" },
    ],
  },
  {
    key: "partitions", label: "Materiál příček", render: "enum",
    role: "preference", visibility: "client", dataPath: "standards.partitions",
    options: [
      { value: "drywall", label: "SDK" },
      { value: "brick", label: "Cihla" },
      { value: "concrete", label: "Beton" },
    ],
  },
  {
    key: "flooring", label: "Podlahová krytina", render: "enum",
    role: "preference", visibility: "client", dataPath: "standards.flooring",
    options: [
      { value: "wood", label: "Dřevo" },
      { value: "vinyl", label: "Vinyl" },
      { value: "tile", label: "Dlažba" },
    ],
  },
];

// Step 5: Standardy bytu — feature attributes

export const STANDARD_FEATURES: WizardField[] = [
  { key: "recuperation", label: "Rekuperace", render: "feature", role: "preference", visibility: "client", dataPath: "standards.recuperation" },
  { key: "exterior_blinds", label: "Venkovní žaluzie", render: "feature", role: "preference", visibility: "client", dataPath: "standards.exterior_blinds" },
  { key: "air_conditioning", label: "Klimatizace", render: "feature", role: "preference", visibility: "client", dataPath: "standards.air_conditioning" },
  { key: "smart_home", label: "Smart home", render: "feature", role: "preference", visibility: "client", dataPath: "standards.smart_home" },
  { key: "elevator", label: "Výtah", render: "feature", role: "preference", visibility: "client", dataPath: "standards.elevator" },
  { key: "cellar", label: "Sklep", render: "feature", role: "preference", visibility: "client", dataPath: "standards.cellar" },
  { key: "parking", label: "Parkování", render: "feature", role: "preference", visibility: "client", dataPath: "standards.parking" },
];

// Step 6: Vybavení domu

export const AMENITY_FEATURES: WizardField[] = [
  { key: "parking", label: "Parkování v domě", render: "feature", role: "preference", visibility: "client", dataPath: "house_amenities.parking" },
  { key: "cellar", label: "Sklepní kóje", render: "feature", role: "preference", visibility: "client", dataPath: "house_amenities.cellar" },
  { key: "bike_room", label: "Kolárna", render: "feature", role: "preference", visibility: "client", dataPath: "house_amenities.bike_room" },
  { key: "stroller_room", label: "Kočárkárna", render: "feature", role: "preference", visibility: "client", dataPath: "house_amenities.stroller_room" },
  { key: "fitness", label: "Fitness", render: "feature", role: "preference", visibility: "client", dataPath: "house_amenities.fitness" },
  { key: "courtyard_garden", label: "Vnitroblok / zahrada", render: "feature", role: "preference", visibility: "client", dataPath: "house_amenities.courtyard_garden" },
  { key: "concierge", label: "Recepce / concierge", render: "feature", role: "preference", visibility: "client", dataPath: "house_amenities.concierge" },
];

// Step 7: Okolí a hluk

export const NOISE_FEATURES: WizardField[] = [
  { key: "main_road", label: "Hlavní silnice", render: "feature", role: "preference", visibility: "client", dataPath: "noise.main_road" },
  { key: "tram", label: "Tramvajové koleje", render: "feature", role: "preference", visibility: "client", dataPath: "noise.tram" },
  { key: "railway", label: "Vlakové koleje", render: "feature", role: "preference", visibility: "client", dataPath: "noise.railway" },
  { key: "airport", label: "Letiště", render: "feature", role: "preference", visibility: "client", dataPath: "noise.airport" },
];

// Step 8: Dokončení

const RENOVATION_PREFERENCE: WizardField = {
  key: "renovation_preference",
  label: "Novostavba nebo rekonstrukce?",
  render: "toggle",
  role: "hard_filter",
  visibility: "client",
  dataPath: "renovation_preference",
  allow_deselect: false,
  options: [
    { value: "any", label: "Nezáleží" },
    { value: "prefer_new", label: "Raději novostavba" },
    { value: "only_new", label: "Pouze novostavba" },
    { value: "prefer_renovation", label: "Raději rekonstrukce" },
    { value: "only_renovation", label: "Pouze rekonstrukce" },
  ],
};

const MOVE_IN_TIMELINE: WizardField = {
  key: "move_in_timeline",
  label: "Kdy chcete bydlet?",
  render: "toggle",
  role: "context",
  visibility: "client",
  dataPath: "move_in_timeline",
  options: [
    { value: "asap", label: "Co nejdříve" },
    { value: "by_date", label: "Do konkrétního data" },
    { value: "flexible", label: "Flexibilní" },
  ],
};

const COMPLETION_DATE: WizardField = {
  key: "completion_date",
  label: "Nejpozději do",
  render: "date",
  role: "hard_filter",
  visibility: "client",
  dataPath: "completion_date",
  visible_when: { field: "move_in_timeline", equals: "by_date" },
};

const COMPLETION_PREFERENCE: WizardField = {
  key: "completion_preference",
  label: "Preferuji nastěhování",
  render: "toggle" as const,
  role: "preference" as const,
  visibility: "both" as const,
  dataPath: "completion_preference",
  options: [
    { value: "sooner", label: "Co nejdřív" },
    { value: "later", label: "Co nejpozději" },
  ],
  allow_deselect: true,
};

const COMPLETION_STANDARD: WizardField = {
  key: "completion_standard",
  label: "Standard dokončení",
  render: "toggle",
  role: "context",
  visibility: "client",
  dataPath: "completion_standard",
  allow_deselect: true,
  options: [
    { value: "doesnt_matter", label: "Je mi to jedno", desc: "Nerozlišuji standard dokončení" },
    { value: "shell_and_core", label: "Holá stavba", desc: "Bez vnitřního vybavení" },
    { value: "white_wall", label: "Bílé stěny", desc: "Základní bílá povrchová úprava" },
    { value: "fit_out", label: "Kompletní dokončení", desc: "Nastěhování ihned" },
  ],
};

// Broker-only fields

const ASSIGNMENT_IMPORTANT: WizardField = {
  key: "assignment_important",
  label: "Postoupení smlouvy",
  render: "toggle",
  role: "context",
  visibility: "broker",
  dataPath: "assignment_important",
  options: [
    { value: "yes", label: "Ano, důležité" },
    { value: "no", label: "Ne" },
    { value: "irrelevant", label: "Neřeší" },
  ],
};

const LATEST_MOVE_IN: WizardField = {
  key: "latest_move_in",
  label: "Nejpozději nastěhování",
  render: "date",
  role: "hard_filter",
  visibility: "broker",
  dataPath: "latest_move_in",
};

const EARLIEST_MOVE_IN: WizardField = {
  key: "earliest_move_in",
  label: "Nejdříve nastěhování",
  render: "date",
  role: "hard_filter",
  visibility: "broker",
  dataPath: "earliest_move_in",
};

// ── Step definitions ──────────────────────────────────────────────────

export const WIZARD_STEPS: WizardStep[] = [
  {
    key: "about",
    index: 1,
    label: "O vás",
    visibility: "client",
    groups: [
      { key: "purpose", heading: "K čemu bydlení hledáte?", fields: [PURCHASE_PURPOSE] },
      { key: "who", heading: "Kdo bude v bytě bydlet?", fields: [CLIENT_TYPE] },
      { key: "timeline", heading: "Časový horizont", fields: [PURCHASE_TIMELINE] },
    ],
  },
  {
    key: "budget",
    index: 2,
    label: "Rozpočet",
    visibility: "both",
    groups: [
      {
        key: "price",
        heading: "Jaký je váš rozpočet?",
        fields: [BUDGET_MAX, BUDGET_MAX_TOLERANCE, MAX_PAYMENT_CONTRACT, MAX_PAYMENT_CONSTRUCTION, MAX_DAYS_ON_MARKET],
      },
      { key: "financing", heading: "Jak budete financovat?", fields: [FINANCING_TYPE] },
    ],
  },
  {
    key: "layout",
    index: 3,
    label: "Dispozice a prostor",
    visibility: "both",
    groups: [
      { key: "layouts", heading: "Jakou dispozici hledáte?", fields: [LAYOUTS] },
      {
        key: "area",
        heading: "Jak velký byt potřebujete?",
        fields: [AREA_MIN, AREA_MIN_TOLERANCE],
      },
      {
        key: "outdoor",
        heading: "Venkovní prostor",
        fields: [MIN_OUTDOOR_AREA, OUTDOOR_TOLERANCE],
      },
      { key: "floor", heading: "Patro", fields: [FLOOR_RULE] },
    ],
  },
  {
    key: "location",
    index: 4,
    label: "Lokalita",
    visibility: "both",
    groups: [
      {
        key: "area",
        heading: "Kde chcete bydlet?",
        description:
          "Oblast na mapě určuje, kde se vůbec hledá. Uvnitř oblasti " +
          "můžete zvýraznit preferované části — ty ovlivňují jen pořadí. " +
          "Aktivujte níže, pokud chcete preferované oblasti jako tvrdý filtr.",
        fields: [POLYGON_LOCATION, COMMUTE_LOCATION, COMMUTE_MODE, ADMIN_AREA, METHOD_ADMIN, ADMIN_REGION],
      },
      { key: "character", heading: "Charakter okolí", fields: [CALM_VS_CITY, CENTER_PREFERENCE] },
    ],
  },
  {
    key: "standards",
    index: 5,
    label: "Standardy bytu",
    visibility: "client",
    groups: [
      {
        key: "enum",
        heading: "Jaké standardy preferujete?",
        description: "Vyberte preferované hodnoty. Můžete zvolit i více možností.",
        fields: STANDARD_ENUMS,
      },
      {
        key: "features",
        heading: "Důležité vlastnosti",
        description: "U každé vlastnosti zvolte, jak moc je pro vás důležitá.",
        fields: STANDARD_FEATURES,
      },
    ],
  },
  {
    key: "amenities",
    index: 6,
    label: "Vybavení domu",
    visibility: "client",
    groups: [
      {
        key: "house",
        heading: "Vybavení bytového domu",
        description: "Co by měl nabízet bytový dům?",
        fields: AMENITY_FEATURES,
      },
    ],
  },
  {
    key: "noise",
    index: 7,
    label: "Okolí a hluk",
    visibility: "client",
    groups: [
      {
        key: "noise",
        heading: "Jaké zdroje hluku vám vadí?",
        description: "U každého zdroje zvolte, zda vám vadí (penalizace v hodnocení) nebo chcete vyloučit projekty v blízkosti.",
        fields: NOISE_FEATURES,
      },
    ],
  },
  {
    key: "completion",
    index: 8,
    label: "Dokončení",
    visibility: "both",
    groups: [
      { key: "reno", heading: "Novostavba nebo rekonstrukce?", fields: [RENOVATION_PREFERENCE] },
      { key: "when", heading: "Kdy chcete bydlet?", fields: [MOVE_IN_TIMELINE, COMPLETION_DATE, COMPLETION_PREFERENCE] },
      { key: "standard", heading: "Standard dokončení", fields: [COMPLETION_STANDARD] },
      { key: "broker_dates", heading: "Upřesnění termínu (broker)", fields: [EARLIEST_MOVE_IN, LATEST_MOVE_IN, ASSIGNMENT_IMPORTANT] },
    ],
  },
  {
    key: "summary",
    index: 9,
    label: "Shrnutí",
    visibility: "client",
    groups: [],
  },
];

/** All fields across all steps, flat list. */
export const ALL_FIELDS: WizardField[] = WIZARD_STEPS.flatMap((s) =>
  s.groups.flatMap((g) => g.fields),
);

/** Steps visible to the client in fullscreen wizard (excludes summary, which is custom-rendered). */
export const CLIENT_STEPS = WIZARD_STEPS.filter(
  (s) => s.visibility === "client" || s.visibility === "both",
);

// ── Label lookup helpers (for summary / portal) ───────────────────────

/** Map of enum field key → { optionValue → label } */
export const ENUM_OPTION_LABELS: Record<string, Record<string, string>> = Object.fromEntries(
  ALL_FIELDS.filter((f) => f.render === "enum" && f.options)
    .map((f) => [f.key, Object.fromEntries(f.options!.map((o) => [o.value, o.label]))])
);

/** Map of enum field key → field label */
export const ENUM_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  ALL_FIELDS.filter((f) => f.render === "enum").map((f) => [f.key, f.label])
);

/** Map of feature field key → field label (standards only) */
export const STANDARD_FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  STANDARD_FEATURES.map((f) => [f.key, f.label])
);

/** Map of amenity field key → field label */
export const AMENITY_LABELS: Record<string, string> = Object.fromEntries(
  AMENITY_FEATURES.map((f) => [f.key, f.label])
);

/** Map of noise field key → field label */
export const NOISE_LABELS: Record<string, string> = Object.fromEntries(
  NOISE_FEATURES.map((f) => [f.key, f.label])
);

// ── Field data-path helpers ───────────────────────────────────────────

/** Read a value from wizardExtras using dot-notation dataPath.
 *  Returns undefined if any intermediate key is missing.  Top-level keys
 *  (no dot) read directly from root.  "profile.X" and "selectedLayouts"
 *  are NOT resolved here — those are profile-column / separate-state
 *  paths and the caller must handle them explicitly. */
export function readFromDataPath(
  wizardExtras: Record<string, unknown> | null | undefined,
  dataPath: string,
): unknown {
  if (!wizardExtras) return undefined;
  if (dataPath.startsWith("profile.") || dataPath === "selectedLayouts") {
    return undefined;
  }
  const parts = dataPath.split(".");
  let cur: unknown = wizardExtras;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Evaluate a field's `visible_when` rule against the current wizardExtras.
 *  Fields without a rule are always visible.  Unknown reference paths
 *  resolve to undefined, which never equals the expected value, so the
 *  field stays hidden — safe default. */
export function isFieldVisible(
  f: WizardField,
  wizardExtras: Record<string, unknown> | null | undefined,
): boolean {
  if (!f.visible_when) return true;
  const current = readFromDataPath(wizardExtras, f.visible_when.field);
  return current === f.visible_when.equals;
}
