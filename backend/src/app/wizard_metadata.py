"""
Wizard field metadata — single source of truth for enum options,
field types, and labels used by the frontend wizard.

The frontend wizardModel.ts defines STRUCTURE (steps, groups, render hints).
This module defines CONTENT (canonical options, labels, scoring roles).

Frontend fetches this via GET /wizard-metadata and merges options into its
local model, using its own hardcoded options as fallback only.
"""

from __future__ import annotations

from .import_semantics import (
    CANONICAL_HEATING_OPTIONS,
    CANONICAL_WINDOWS_OPTIONS,
    CANONICAL_PARTITION_WALLS_OPTIONS,
)

# Version — bump when field definitions change so frontend can cache-bust.
#
# v1: enum / feature / toggle fields, compound (sub_options, states) for AC / blinds.
# v2: add numeric / date / text / toggle_bool field types, visible_when conditionals,
#     visibility hints, semantics for noise negative-constraint fields.
METADATA_VERSION = 6


def _opt(value: str, label: str, desc: str | None = None) -> dict:
    out: dict = {"value": value, "label": label}
    if desc:
        out["desc"] = desc
    return out


# ── Enum field definitions ────────────────────────────────────────────
# These are the fields where the backend has richer knowledge than the
# frontend's hardcoded options.  Keys match wizardModel field keys.

ENUM_FIELDS: dict[str, dict] = {
    "heating_type": {
        "key": "heating_type",
        "field_type": "enum",
        "label": "Typ vytápění",
        "section": "standards",
        "scoring_role": "preference",
        "options": [
            _opt("underfloor", "Podlahové"),
            _opt("radiators", "Radiátory"),
            _opt("ceiling", "Stropní"),
            _opt("central", "Centrální"),
            _opt("conventional", "Konvenční"),
        ],
    },
    "heating_source": {
        "key": "heating_source",
        "field_type": "enum",
        "label": "Zdroj vytápění",
        "section": "standards",
        "scoring_role": "preference",
        "options": [
            _opt("heat_pump", "Tepelné čerpadlo"),
            _opt("gas", "Plyn"),
            _opt("central_heating", "Centrální zásobování teplem"),
            _opt("electric", "Elektřina"),
        ],
    },
    "window_material": {
        "key": "window_material",
        "field_type": "enum",
        "label": "Typ oken",
        "section": "standards",
        "scoring_role": "preference",
        "options": [
            _opt("pvc", "Plast"),
            _opt("wood", "Dřevo"),
            _opt("aluminum", "Hliník"),
            _opt("aluminum_wood", "Hliník-dřevo"),
            _opt("aluminum_pvc", "Hliník-plast"),
        ],
    },
    "partitions": {
        "key": "partitions",
        "field_type": "enum",
        "label": "Materiál příček",
        "section": "standards",
        "scoring_role": "preference",
        "options": [
            _opt("drywall", "SDK"),
            _opt("brick", "Cihla"),
            _opt("concrete", "Beton"),
        ],
    },
    "flooring": {
        "key": "flooring",
        "field_type": "enum",
        "label": "Podlahová krytina",
        "section": "standards",
        "scoring_role": "preference",
        "options": [
            _opt("hardwood", "Dřevo"),
            _opt("laminate", "Laminát"),
            _opt("vinyl", "Vinyl"),
            _opt("tile", "Dlažba"),
            _opt("carpet", "Koberec"),
        ],
    },
}

# ── Feature field definitions ─────────────────────────────────────────
# Feature fields use priority picker (must/prefer/bonus/ignore).
# Some are "compound-ready" — they have a sub-type dimension that we
# expose as future_sub_options for gradual frontend adoption.

FEATURE_FIELDS: dict[str, dict] = {
    "recuperation": {
        "key": "recuperation",
        "field_type": "feature",
        "label": "Rekuperace",
        "section": "standards",
        "scoring_role": "preference",
    },
    "exterior_blinds": {
        "key": "exterior_blinds",
        "field_type": "feature",
        "label": "Venkovní žaluzie",
        "section": "standards",
        "scoring_role": "preference",
        "compound": {
            "states": ["true", "preparation", "false"],
            "state_labels": {
                "true": "Ano",
                "preparation": "Příprava",
                "false": "Ne",
            },
        },
    },
    "air_conditioning": {
        "key": "air_conditioning",
        "field_type": "feature",
        "label": "Klimatizace",
        "section": "standards",
        "scoring_role": "preference",
        "compound": {
            "sub_options": [
                _opt("split", "Split"),
                _opt("central", "Centrální"),
                _opt("vrv", "VRV"),
            ],
        },
    },
    "smart_home": {
        "key": "smart_home",
        "field_type": "feature",
        "label": "Smart home",
        "section": "standards",
        "scoring_role": "preference",
    },
    "elevator": {
        "key": "elevator",
        "field_type": "feature",
        "label": "Výtah",
        "section": "standards",
        "scoring_role": "preference",
        "note": "not_scored",
    },
    "cellar": {
        "key": "cellar",
        "field_type": "feature",
        "label": "Sklep",
        "section": "standards",
        "scoring_role": "preference",
        "note": "not_scored",
    },
    "parking": {
        "key": "parking",
        "field_type": "feature",
        "label": "Parkování",
        "section": "standards",
        "scoring_role": "preference",
        "compound": {
            "sub_options": [
                _opt("indoor", "Garáž"),
                _opt("outdoor", "Venkovní stání"),
            ],
        },
    },
}

# ── Amenity features ──────────────────────────────────────────────────

AMENITY_FIELDS: dict[str, dict] = {
    "parking": {
        "key": "parking",
        "field_type": "feature",
        "label": "Parkování v domě",
        "section": "amenities",
        "scoring_role": "preference",
    },
    "cellar": {
        "key": "cellar",
        "field_type": "feature",
        "label": "Sklepní kóje",
        "section": "amenities",
        "scoring_role": "preference",
    },
    "bike_room": {
        "key": "bike_room",
        "field_type": "feature",
        "label": "Kolárna",
        "section": "amenities",
        "scoring_role": "preference",
    },
    "stroller_room": {
        "key": "stroller_room",
        "field_type": "feature",
        "label": "Kočárkárna",
        "section": "amenities",
        "scoring_role": "preference",
    },
    "fitness": {
        "key": "fitness",
        "field_type": "feature",
        "label": "Fitness",
        "section": "amenities",
        "scoring_role": "preference",
    },
    "courtyard_garden": {
        "key": "courtyard_garden",
        "field_type": "feature",
        "label": "Vnitroblok / zahrada",
        "section": "amenities",
        "scoring_role": "preference",
    },
    "concierge": {
        "key": "concierge",
        "field_type": "feature",
        "label": "Recepce / concierge",
        "section": "amenities",
        "scoring_role": "preference",
    },
}

# ── Noise features ────────────────────────────────────────────────────
# Noise fields use negative-constraint semantics: "ignore" = fine, "prefer" =
# annoys me, "must" = exclude.  They piggy-back on the same priority picker
# state machine as other feature fields, but UI labels differ.  Expose this
# via `semantics` + `custom_state_labels` so consumers (fullscreen wizard,
# broker quick-edit, summary) can render consistent language.

_NOISE_SEMANTICS = {
    "semantics": "negative_constraint",
    "custom_state_labels": {
        "ignore": "Neřeším",
        "prefer": "Vadí mi",
        "must": "Vyloučit",
    },
}

NOISE_FIELDS: dict[str, dict] = {
    "main_road": {
        "key": "main_road",
        "field_type": "feature",
        "label": "Hlavní silnice",
        "section": "noise",
        "scoring_role": "preference",
        **_NOISE_SEMANTICS,
    },
    "tram": {
        "key": "tram",
        "field_type": "feature",
        "label": "Tramvajové koleje",
        "section": "noise",
        "scoring_role": "preference",
        **_NOISE_SEMANTICS,
    },
    "railway": {
        "key": "railway",
        "field_type": "feature",
        "label": "Vlakové koleje",
        "section": "noise",
        "scoring_role": "preference",
        **_NOISE_SEMANTICS,
    },
    "airport": {
        "key": "airport",
        "field_type": "feature",
        "label": "Letiště",
        "section": "noise",
        "scoring_role": "preference",
        **_NOISE_SEMANTICS,
    },
}

# ── Toggle field definitions ──────────────────────────────────────────

TOGGLE_FIELDS: dict[str, dict] = {
    "renovation_preference": {
        "key": "renovation_preference",
        "field_type": "toggle",
        "label": "Novostavba nebo rekonstrukce?",
        "section": "completion",
        "scoring_role": "hard_filter",
        "visibility": "client",
        "options": [
            _opt("any", "Nezáleží"),
            _opt("prefer_new", "Raději novostavba"),
            _opt("only_new", "Pouze novostavba"),
            _opt("prefer_renovation", "Raději rekonstrukce"),
            _opt("only_renovation", "Pouze rekonstrukce"),
        ],
    },
    "completion_standard": {
        "key": "completion_standard",
        "field_type": "toggle",
        "label": "Standard dokončení",
        "section": "completion",
        "scoring_role": "context",
        "visibility": "client",
        "options": [
            _opt("doesnt_matter", "Je mi to jedno", "Nerozlišuji standard dokončení"),
            _opt("shell_and_core", "Holá stavba", "Bez vnitřního vybavení"),
            _opt("white_wall", "Bílé stěny", "Základní bílá povrchová úprava"),
            _opt("fit_out", "Kompletní dokončení", "Nastěhování ihned"),
        ],
    },
    "floor_rule": {
        "key": "floor_rule",
        "field_type": "toggle",
        "label": "Patro",
        "section": "layout",
        "scoring_role": "hard_filter",
        "options": [
            _opt("ignore", "Neřeším"),
            _opt("no_ground", "Ne přízemí"),
            _opt("top_3", "Horní 3 patra"),
            _opt("top_1", "Nejvyšší patro"),
        ],
    },
    "calm_vs_city": {
        "key": "calm_vs_city",
        "field_type": "toggle",
        "label": "Klidné bydlení vs. městský život",
        "section": "location",
        "scoring_role": "preference",
        "options": [
            _opt("calm", "Klidné okolí"),
            _opt("city", "Městský život"),
            _opt("ignore", "Neřeším"),
        ],
    },
    "purchase_purpose": {
        "key": "purchase_purpose",
        "field_type": "toggle",
        "label": "K čemu bydlení hledáte?",
        "section": "about",
        "scoring_role": "context",
        "options": [
            _opt("own_use", "Vlastní bydlení"),
            _opt("investment", "Investice"),
        ],
    },
    "client_type": {
        "key": "client_type",
        "field_type": "toggle",
        "label": "Kdo bude v bytě bydlet?",
        "section": "about",
        "scoring_role": "context",
        "options": [
            _opt("family", "Rodina"),
            _opt("couple", "Pár"),
            _opt("single", "Jednotlivec"),
            _opt("downsizing", "Downsizing"),
        ],
    },
    "purchase_timeline": {
        "key": "purchase_timeline",
        "field_type": "toggle",
        "label": "Časový horizont",
        "section": "about",
        "scoring_role": "context",
        "options": [
            _opt("now", "Hned"),
            _opt("3m", "Do 3 měsíců"),
            _opt("6m", "Do 6 měsíců"),
            _opt("1y", "Do roka"),
            _opt("2y+", "Za 2+ let"),
            _opt("mapping", "Jen mapuji"),
        ],
    },
    "financing_type": {
        "key": "financing_type",
        "field_type": "toggle",
        "label": "Jak budete financovat?",
        "section": "budget",
        "scoring_role": "context",
        "options": [
            _opt("cash", "Hotově"),
            _opt("mortgage", "Hypotéka"),
            _opt("combo", "Kombinace"),
            _opt("unknown", "Nevím"),
        ],
    },
    "move_in_timeline": {
        "key": "move_in_timeline",
        "field_type": "toggle",
        "label": "Kdy chcete bydlet?",
        "section": "completion",
        "scoring_role": "context",
        "visibility": "client",
        "options": [
            _opt("asap", "Co nejdříve"),
            _opt("by_date", "Do konkrétního data"),
            _opt("flexible", "Flexibilní"),
        ],
    },
    "assignment_important": {
        "key": "assignment_important",
        "field_type": "toggle",
        "label": "Postoupení smlouvy",
        "section": "completion",
        "scoring_role": "context",
        "visibility": "broker",
        "options": [
            _opt("yes", "Ano, důležité"),
            _opt("no", "Ne"),
            _opt("irrelevant", "Neřeší"),
        ],
    },
}


# ── Date field definitions (v2) ───────────────────────────────────────
# Top-level wizard fields storing ISO date strings.  `visible_when` expresses
# conditional visibility in declarative form (consumer may ignore).

DATE_FIELDS: dict[str, dict] = {
    "completion_date": {
        "key": "completion_date",
        "field_type": "date",
        "label": "Nejpozději do",
        "section": "completion",
        "scoring_role": "hard_filter",
        "visibility": "client",
        "visible_when": {"field": "move_in_timeline", "equals": "by_date"},
    },
    "earliest_move_in": {
        "key": "earliest_move_in",
        "field_type": "date",
        "label": "Nejdříve nastěhování",
        "section": "completion",
        "scoring_role": "preference",
        "visibility": "broker",
    },
    "latest_move_in": {
        "key": "latest_move_in",
        "field_type": "date",
        "label": "Nejpozději nastěhování",
        "section": "completion",
        "scoring_role": "hard_filter",
        "visibility": "broker",
    },
}

# ── Text field definitions (v2) ───────────────────────────────────────
# Free-text inputs used for administrative area / region names.  Backend
# reads these from wizard.location.* as hard filters.

TEXT_FIELDS: dict[str, dict] = {
    "administrative_area": {
        "key": "administrative_area",
        "field_type": "text",
        "label": "Preferované části v této oblasti",
        "section": "location",
        # Default role is a soft preference: the area list boosts/demotes
        # ranking inside the polygon.  When the broker opts in to
        # `method_admin`, the same list also acts as a hard filter.
        "scoring_role": "preference",
        "visibility": "client",
        "placeholder": "Např. Praha 6",
        "note": (
            "Ovlivní pořadí výsledků uvnitř vybrané oblasti. "
            "Pro striktní filtr zapněte 'Použít i jako striktní požadavek'."
        ),
        # Autocomplete hint — frontend calls
        # GET /locations/suggest?scope=area to populate suggestions.
        # Free text remains allowed; suggestions are just a quick-pick.
        "suggest": "area",
        # Multi-value: broker/client selects multiple preferred areas as
        # chips.  Frontend dispatches to the MultiSuggestInput variant when
        # both `suggest` and `multi` are set.
        "multi": True,
    },
    "administrative_region": {
        "key": "administrative_region",
        "field_type": "text",
        "label": "Region / kraj",
        "section": "location",
        "scoring_role": "hard_filter",
        "visibility": "client",
        "placeholder": "Např. Praha, Středočeský kraj",
        "suggest": "region",
    },
}

# ── Numeric field definitions (v2) ────────────────────────────────────
# Budget / area / tolerances.  Currency / percent / plain formats drive
# formatting in the UI.  `visibility: broker` marks fields that brokers
# tweak on behalf of the client (tolerances, payment schedule limits).

NUMERIC_FIELDS: dict[str, dict] = {
    # `ideal_price` was removed from the wizard — the product model now only
    # asks for max price + tolerance.  Legacy JSONB values remain readable
    # but are no longer exposed via metadata.
    "budget_max": {
        "key": "budget_max",
        "field_type": "numeric",
        "label": "Maximální cena",
        "section": "profile",  # stored on ClientProfile.budget_max, not wizard.budget
        "scoring_role": "hard_filter",
        "visibility": "client",
        "unit": "Kč",
        "format": "currency",
        "placeholder": "Absolutní strop",
    },
    "max_price_tolerance_pct": {
        "key": "max_price_tolerance_pct",
        "field_type": "numeric",
        "label": "Tolerance rozpočtu",
        "section": "budget",
        "scoring_role": "hard_filter",
        # Client-facing in the fullscreen wizard — tolerance is part of the
        # primary budget question.  Kept in sync with wizardModel.ts.
        "visibility": "both",
        "unit": "%",
        "format": "percent",
        "min": 0,
        "max": 100,
        "placeholder": "Např. 10",
    },
    # `ideal_area` was removed from the wizard — the product model now only
    # asks for min area + tolerance.  Backend scoring still has a fallback
    # path reading `wizard.budget.ideal_area` for legacy cases; it degrades
    # gracefully to neutral when absent.
    "area_min": {
        "key": "area_min",
        "field_type": "numeric",
        "label": "Minimální plocha",
        "section": "profile",
        "scoring_role": "hard_filter",
        "visibility": "client",
        "unit": "m²",
        "format": "plain",
        "placeholder": "Absolutní minimum",
    },
    "max_area_tolerance_pct": {
        "key": "max_area_tolerance_pct",
        "field_type": "numeric",
        "label": "Tolerance plochy",
        "section": "budget",
        "scoring_role": "hard_filter",
        # Client-facing — tolerance is part of the primary area question.
        "visibility": "both",
        "unit": "%",
        "format": "percent",
        "min": 0,
        "max": 100,
        "placeholder": "Např. 10",
    },
    "min_outdoor_area_m2": {
        "key": "min_outdoor_area_m2",
        "field_type": "numeric",
        "label": "Minimální venkovní prostor",
        # Moved from "budget" to "outdoor" to match wizardTransform and
        # backend unit_report which both read `wizard.outdoor.min_outdoor_area_m2`.
        "section": "outdoor",
        "scoring_role": "hard_filter",
        "visibility": "client",
        "unit": "m²",
        "format": "plain",
        "placeholder": "Např. 5",
    },
    "max_outdoor_tolerance_pct": {
        "key": "max_outdoor_tolerance_pct",
        "field_type": "numeric",
        "label": "Tolerance venkovní plochy",
        "section": "budget",
        "scoring_role": "hard_filter",
        # Client-facing — tolerance is part of the outdoor question in
        # the fullscreen wizard.
        "visibility": "both",
        "unit": "%",
        "format": "percent",
        "min": 0,
        "max": 100,
        "placeholder": "Např. 10",
    },
    "max_payment_contract_pct": {
        "key": "max_payment_contract_pct",
        "field_type": "numeric",
        "label": "Max. záloha při smlouvě",
        "section": "budget",
        "scoring_role": "hard_filter",
        "visibility": "broker",
        "unit": "%",
        "format": "percent",
        "min": 0,
        "max": 100,
        "placeholder": "Např. 20",
    },
    "max_payment_construction_pct": {
        "key": "max_payment_construction_pct",
        "field_type": "numeric",
        "label": "Max. platba při výstavbě",
        "section": "budget",
        "scoring_role": "hard_filter",
        "visibility": "broker",
        "unit": "%",
        "format": "percent",
        "min": 0,
        "max": 100,
        "placeholder": "Např. 30",
    },
    "max_days_on_market": {
        "key": "max_days_on_market",
        "field_type": "numeric",
        "label": "Max. dnů na trhu",
        "section": "budget",
        "scoring_role": "hard_filter",
        "visibility": "broker",
        "unit": "dní",
        "format": "plain",
        "placeholder": "Např. 90",
    },
}

# ── Location method flags (v2) ────────────────────────────────────────
# These boolean toggles express HOW the broker defined the location
# constraint.  Polygon and commute are edited on map surfaces elsewhere
# and surface here as read-only indicators; admin is the fallback text path.

BOOL_TOGGLE_FIELDS: dict[str, dict] = {
    "method_polygon": {
        "key": "method_polygon",
        "field_type": "toggle_bool",
        "label": "Vybraná oblast na mapě",
        "section": "location",
        "scoring_role": "hard_filter",
        "visibility": "broker",
        "note": "edited_on_map",
    },
    "method_commute": {
        "key": "method_commute",
        "field_type": "toggle_bool",
        "label": "Dojezdové body",
        "section": "location",
        "scoring_role": "hard_filter",
        "visibility": "broker",
        "note": "edited_on_map",
    },
    "method_admin": {
        "key": "method_admin",
        "field_type": "toggle_bool",
        # Wording shift: this is no longer a "separate location method",
        # it's an opt-in to promote the preferred admin areas to a hard
        # filter.  By default the area list is soft (ranking-only).
        "label": "Použít preferované oblasti i jako striktní požadavek",
        "section": "location",
        "scoring_role": "hard_filter_opt_in",
        "visibility": "both",
        "note": (
            "Bez zaškrtnutí jsou preferované části jen soft preference uvnitř "
            "vybrané oblasti na mapě. Zaškrtnutím se stanou striktním filtrem."
        ),
    },
}


def get_wizard_metadata() -> dict:
    """Build the complete wizard metadata response.

    Keys in the returned ``fields`` dict are section-prefixed for
    section-nested fields (e.g. ``standards.recuperation``) and bare for
    top-level fields (e.g. ``renovation_preference``).  The frontend
    ``getFieldOptions`` helper tries both lookups.
    """
    flat: dict[str, dict] = {}
    for v in ENUM_FIELDS.values():
        flat[v["key"]] = v
    for v in FEATURE_FIELDS.values():
        flat[f"standards.{v['key']}"] = v
    for v in AMENITY_FIELDS.values():
        flat[f"amenities.{v['key']}"] = v
    for v in NOISE_FIELDS.values():
        flat[f"noise.{v['key']}"] = v
    for v in TOGGLE_FIELDS.values():
        flat[v["key"]] = v
    # v2 additions
    for v in DATE_FIELDS.values():
        flat[v["key"]] = v
    for v in TEXT_FIELDS.values():
        flat[f"{v['section']}.{v['key']}"] = v
    for v in NUMERIC_FIELDS.values():
        # Section drives the prefix: "profile.*" for profile-backed numerics
        # (budget_max, area_min), "budget.*" for tolerances/payment limits,
        # "outdoor.*" for min_outdoor_area_m2.
        flat[f"{v['section']}.{v['key']}"] = v
    for v in BOOL_TOGGLE_FIELDS.values():
        flat[f"{v['section']}.{v['key']}"] = v

    return {
        "version": METADATA_VERSION,
        "fields": flat,
    }
