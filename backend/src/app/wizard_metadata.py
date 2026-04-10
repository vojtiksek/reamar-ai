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
METADATA_VERSION = 1


def _opt(value: str, label: str) -> dict:
    return {"value": value, "label": label}


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

NOISE_FIELDS: dict[str, dict] = {
    "main_road": {
        "key": "main_road",
        "field_type": "feature",
        "label": "Hlavní silnice",
        "section": "noise",
        "scoring_role": "preference",
    },
    "tram": {
        "key": "tram",
        "field_type": "feature",
        "label": "Tramvajové koleje",
        "section": "noise",
        "scoring_role": "preference",
    },
    "railway": {
        "key": "railway",
        "field_type": "feature",
        "label": "Vlakové koleje",
        "section": "noise",
        "scoring_role": "preference",
    },
    "airport": {
        "key": "airport",
        "field_type": "feature",
        "label": "Letiště",
        "section": "noise",
        "scoring_role": "preference",
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
        "options": [
            _opt("shell_and_core", "Holá stavba"),
            _opt("white_wall", "Bílé stěny"),
            _opt("fit_out", "Kompletní"),
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
        "options": [
            _opt("yes", "Ano, důležité"),
            _opt("no", "Ne"),
            _opt("irrelevant", "Neřeší"),
        ],
    },
}


def get_wizard_metadata() -> dict:
    """Build the complete wizard metadata response."""
    fields: dict[str, dict] = {}
    fields.update(ENUM_FIELDS)
    fields.update({f"std_{k}": v for k, v in FEATURE_FIELDS.items()})
    fields.update({f"amenity_{k}": v for k, v in AMENITY_FIELDS.items()})
    fields.update({f"noise_{k}": v for k, v in NOISE_FIELDS.items()})
    fields.update(TOGGLE_FIELDS)

    # Use field key as the dict key (not the prefixed version)
    # Prefix is only for internal dedup — expose by section + key
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

    return {
        "version": METADATA_VERSION,
        "fields": flat,
    }
