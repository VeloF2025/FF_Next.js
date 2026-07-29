"""Pure QField audit hierarchy parsing.

The extractor receives several verified project shapes:
  * FT audits: ``pon_no`` / ``zone_no``
  * Tonga: ``BL`` ending in ``_B<number>`` (all zone 1)
  * HT audits: project-configured ``PON`` and ``Phase`` columns
  * HT Mahikeng: ``Phase`` plus a pole-to-PON spatial design map

This module has no DB, MinIO, or GeoPandas dependency so every mapping stays
covered by the dependency-free local CI gate.
"""
import re
from collections.abc import Mapping
from typing import Any

_NUMBER_RE = re.compile(r"^(?:phase\s*)?0*(\d+)(?:\.0+)?$", re.IGNORECASE)
_BLOCK_RE = re.compile(r"_B(\d+)$", re.IGNORECASE)


def _value(row: Mapping[str, Any], column: str | None) -> Any:
    if not column:
        return None
    try:
        return row[column]
    except (KeyError, IndexError):
        return None


def _number(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    if not text:
        return None
    # Preserve the existing GPKG behaviour: "30,035" represents PON 30.
    text = text.split(",", 1)[0].strip()
    match = _NUMBER_RE.fullmatch(text)
    return int(match.group(1)) if match else None


def resolve_hierarchy(
    row: Mapping[str, Any],
    *,
    label: str,
    pon_col: str | None = None,
    zone_col: str | None = None,
    spatial_pon_map: Mapping[str, Mapping[str, Any]] | None = None,
) -> tuple[int | None, int | None]:
    """Return ``(pon_no, zone_no)`` for one verified audit row."""
    direct_pon_col = pon_col or "pon_no"
    direct_zone_col = zone_col or "zone_no"
    pon_no = _number(_value(row, direct_pon_col))
    zone_no = _number(_value(row, direct_zone_col))

    spatial = spatial_pon_map.get(label) if spatial_pon_map else None
    if spatial:
        if pon_no is None:
            pon_no = _number(spatial.get("pon"))
        if zone_no is None:
            zone_no = _number(spatial.get("zone"))

    if pon_no is None:
        block = _value(row, "BL")
        match = _BLOCK_RE.search(str(block).strip()) if block else None
        if match:
            pon_no = int(match.group(1))
            if zone_no is None:
                zone_no = 1

    return pon_no, zone_no
