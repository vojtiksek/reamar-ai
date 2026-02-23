#!/usr/bin/env python3
"""
Generate SQLAlchemy column definitions and JSON key -> model attribute mapping
from a JSON file of units (array of dicts). Use for schema expansion and importer mapping.

Usage:
  python -m app.dev.generate_schema_from_json path/to/units.json
  python -m app.dev.generate_schema_from_json path/to/units.json --output-mapping schema_mapping.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Type inference result: (sql_type, sa_type_str, python_type_str)
TYPE_BOOL = ("Boolean", "Boolean", "bool")
TYPE_INT = ("Integer", "Integer", "int")
TYPE_FLOAT = ("Numeric(16, 4)", "Numeric(16, 4)", "Decimal")
TYPE_DATE = ("Date", "Date", "date")
TYPE_DATETIME = ("DateTime", "TIMESTAMP(timezone=True)", "datetime")
TYPE_TEXT = ("Text", "Text", "str")
TYPE_STRING = ("String(255)", "String(255)", "str")


def load_units_json(path: Path) -> list[dict[str, Any]]:
    """Load units from JSON file (list or wrapped in 'units'/'data')."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if "units" in data:
            return data["units"]
        if "data" in data:
            return data["data"]
        raise ValueError(f"JSON object must contain 'units' or 'data', got keys: {list(data.keys())}")
    raise ValueError(f"JSON must be list or object, got {type(data)}")


def collect_keys(units: list[dict[str, Any]]) -> set[str]:
    """Collect all keys across all unit dicts (top-level only)."""
    keys: set[str] = set()
    for u in units:
        if isinstance(u, dict):
            keys.update(k for k in u.keys() if isinstance(k, str))
    return keys


def sample_non_null_values(units: list[dict[str, Any]], key: str, max_samples: int = 500) -> list[Any]:
    """Gather up to max_samples non-null values for key."""
    out: list[Any] = []
    for u in units:
        if not isinstance(u, dict):
            continue
        v = u.get(key)
        if v is None:
            continue
        out.append(v)
        if len(out) >= max_samples:
            break
    return out


def infer_type(samples: list[Any]) -> tuple[str, str, str]:
    """Infer SQLAlchemy type from sample values. Returns (short_name, sa_type, python_type)."""
    if not samples:
        return TYPE_TEXT
    has_bool = False
    has_int = False
    has_float = False
    has_date = False
    has_datetime = False
    for v in samples:
        if isinstance(v, bool):
            has_bool = True
        elif isinstance(v, int) and not isinstance(v, bool):
            has_int = True
        elif isinstance(v, (float, type(__import__("decimal").Decimal))):
            has_float = True
        elif isinstance(v, datetime):
            has_datetime = True
        elif hasattr(v, "date") and callable(getattr(v, "date", None)):  # datetime
            has_datetime = True
        else:
            s = str(v).strip()
            if len(s) >= 10 and re.match(r"^\d{4}-\d{2}-\d{2}", s):
                if "T" in s or " " in s[:11] or len(s) > 10:
                    has_datetime = True
                else:
                    has_date = True
    if has_bool and not (has_int or has_float):
        return TYPE_BOOL
    if has_datetime:
        return TYPE_DATETIME
    if has_date and not has_datetime:
        return TYPE_DATE
    if has_int and not has_float:
        return TYPE_INT
    if has_float or has_int:
        return TYPE_FLOAT
    return TYPE_TEXT


def key_to_attr(key: str) -> str:
    """Normalize JSON key to valid Python/SQL attribute name (snake_case)."""
    # Replace spaces and hyphens with underscore; remove or replace invalid chars
    s = re.sub(r"[\s\-]+", "_", key)
    s = re.sub(r"[^a-zA-Z0-9_]", "", s)
    s = s.strip("_").lower()
    if not s:
        s = "field_" + key[:50].replace(" ", "_")
    if s[0].isdigit():
        s = "_" + s
    return s or "unknown"


def generate_columns_and_mapping(
    units: list[dict[str, Any]],
    *,
    skip_keys: set[str] | None = None,
) -> tuple[list[tuple[str, str, str, str]], dict[str, str], dict[str, str]]:
    """
    Returns:
      - spec_list: [(json_key, attr_name, short_type, sa_type_str), ...]
      - mapping: {json_key: attr_name}
      - key_type: {json_key: short_type} for normalizer
    """
    skip = skip_keys or set()
    keys = collect_keys(units)
    keys = keys - skip
    spec_list: list[tuple[str, str, str, str]] = []
    mapping: dict[str, str] = {}
    key_type: dict[str, str] = {}
    for key in sorted(keys):
        samples = sample_non_null_values(units, key)
        short_type, sa_type, _ = infer_type(samples)
        attr = key_to_attr(key)
        # Avoid duplicate attrs (e.g. price and price_per_sm both valid)
        if attr in mapping.values():
            base, n = attr, 1
            while attr in {v for v in mapping.values()}:
                attr = f"{base}_{n}"
                n += 1
        spec_list.append((key, attr, short_type, sa_type))
        mapping[key] = attr
        key_type[key] = short_type
    return spec_list, mapping, key_type


def emit_python_snippet(spec_list: list[tuple[str, str, str, str]], model: str = "Unit") -> str:
    """Emit Python snippet of Mapped columns for the model."""
    lines = [f"# Generated columns for {model} (nullable).", ""]
    for json_key, attr, short_type, sa_type in spec_list:
        if short_type == "Boolean":
            py_type = "bool | None"
        elif short_type == "Integer":
            py_type = "int | None"
        elif short_type.startswith("Numeric"):
            py_type = "Decimal | None"
        elif short_type == "Date":
            py_type = "date | None"
        elif short_type == "DateTime":
            py_type = "datetime | None"
        else:
            py_type = "str | None"
        comment = f"  # JSON key: {json_key!r}"
        if sa_type == "Boolean":
            lines.append(f"    {attr}: Mapped[{py_type}] = mapped_column(Boolean, nullable=True){comment}")
        elif sa_type == "Integer":
            lines.append(f"    {attr}: Mapped[{py_type}] = mapped_column(Integer, nullable=True){comment}")
        elif sa_type.startswith("Numeric"):
            lines.append(f"    {attr}: Mapped[{py_type}] = mapped_column({sa_type}, nullable=True){comment}")
        elif sa_type == "Date":
            lines.append(f"    {attr}: Mapped[{py_type}] = mapped_column(Date, nullable=True){comment}")
        elif "TIMESTAMP" in sa_type:
            lines.append(f"    {attr}: Mapped[{py_type}] = mapped_column(TIMESTAMP(timezone=True), nullable=True){comment}")
        elif sa_type == "Text":
            lines.append(f"    {attr}: Mapped[{py_type}] = mapped_column(Text, nullable=True){comment}")
        else:
            lines.append(f"    {attr}: Mapped[{py_type}] = mapped_column({sa_type}, nullable=True){comment}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate SQLAlchemy columns and JSON key -> attr mapping from units JSON",
    )
    parser.add_argument("json_file", type=Path, help="Path to JSON file (array of unit dicts)")
    parser.add_argument(
        "--max-units",
        type=int,
        default=None,
        help="Use only first N units for key collection (default: all)",
    )
    parser.add_argument(
        "--skip-keys",
        type=str,
        default="",
        help="Comma-separated keys to skip (e.g. unique_id,project)",
    )
    parser.add_argument(
        "--output-mapping",
        type=Path,
        default=None,
        help="Write mapping and key_type JSON to this file",
    )
    parser.add_argument(
        "--output-snippet",
        type=Path,
        default=None,
        help="Write Python column snippet to this file",
    )
    args = parser.parse_args()

    if not args.json_file.exists():
        print(f"Error: file not found: {args.json_file}", file=sys.stderr)
        return 1

    skip_keys = {k.strip() for k in args.skip_keys.split(",") if k.strip()}
    # Always skip keys that are handled specially (id, project_id, external_id)
    skip_keys |= {"unique_id", "id"}

    units = load_units_json(args.json_file)
    if args.max_units is not None:
        units = units[: args.max_units]
        print(f"Using first {len(units)} units.", file=sys.stderr)
    print(f"Loaded {len(units)} units from {args.json_file}", file=sys.stderr)
    spec_list, mapping, key_type = generate_columns_and_mapping(units, skip_keys=skip_keys)
    print(f"Collected {len(spec_list)} keys (after skip).", file=sys.stderr)

    snippet = emit_python_snippet(spec_list)
    print("\n# --- Python snippet (Unit columns) ---\n")
    print(snippet)

    print("\n# --- Mapping (JSON key -> model attribute) ---\n")
    print("JSON_KEY_TO_ATTR = {")
    for k, v in sorted(mapping.items()):
        print(f"    {k!r}: {v!r},")
    print("}")

    print("\n# --- Key type (for normalizer) ---\n")
    print("JSON_KEY_TYPE = {")
    for k, v in sorted(key_type.items()):
        print(f"    {k!r}: {v!r},")
    print("}")

    if args.output_mapping:
        args.output_mapping.parent.mkdir(parents=True, exist_ok=True)
        with open(args.output_mapping, "w", encoding="utf-8") as f:
            json.dump({"mapping": mapping, "key_type": key_type}, f, indent=2)
        print(f"\nWrote mapping to {args.output_mapping}", file=sys.stderr)

    if args.output_snippet:
        args.output_snippet.parent.mkdir(parents=True, exist_ok=True)
        with open(args.output_snippet, "w", encoding="utf-8") as f:
            f.write(snippet)
        print(f"Wrote snippet to {args.output_snippet}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
