#!/usr/bin/env python3
"""
Read GeoPackage files from QFieldCloud MinIO or local filesystem.

Decodes GPKG binary geometry (with envelope handling), auto-detects layer
types by column heuristics, and outputs structured JSON to stdout.

Usage:
    # Read from MinIO by QFieldCloud project ID
    python3 read_gpkg.py --project-id e849b878-f8a8-4f84-a3f1-9fbd051686c0

    # Read a local GPKG file
    python3 read_gpkg.py --file /tmp/survey.gpkg

    # Preview mode (counts + sample fields only, no feature data)
    python3 read_gpkg.py --file /tmp/survey.gpkg --preview

Author: Hein/Claude Code
Date: 2026-02-13
"""

import argparse
import json
import logging
import os
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional, Tuple

# Logging to stderr so JSON goes cleanly to stdout
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logger = logging.getLogger(__name__)

# South Africa coordinate bounds for filtering bad GPS data
SA_BOUNDS = {
    "min_lat": -35.0,
    "max_lat": -22.0,
    "min_lon": 16.0,
    "max_lon": 33.0,
}

# Envelope sizes indexed by envelope type (bits 1-3 of flags byte)
ENVELOPE_SIZES = {
    0: 0,   # no envelope
    1: 32,  # min/max XY (4 doubles)
    2: 48,  # min/max XYZ (6 doubles)
    3: 64,  # min/max XYZM (8 doubles)
}


def is_valid_sa_coordinate(lat: float, lon: float) -> bool:
    """Check if coordinates fall within South Africa bounds."""
    return (
        SA_BOUNDS["min_lat"] <= lat <= SA_BOUNDS["max_lat"]
        and SA_BOUNDS["min_lon"] <= lon <= SA_BOUNDS["max_lon"]
    )


def decode_gpkg_geometry(blob: bytes) -> Optional[Dict[str, Any]]:
    """
    Decode GeoPackage binary geometry into GeoJSON-style dict.

    GPKG binary header:
      - 2 bytes: magic 'GP'
      - 1 byte: version
      - 1 byte: flags (bits 1-3 = envelope type)
      - 4 bytes: SRID (int32 LE)
      - variable: envelope (size depends on flags)
      - remainder: WKB geometry

    WKB types:
      1 = Point, 2 = LineString, 3 = Polygon,
      5 = MultiLineString, 6 = MultiPolygon
    """
    if not blob or len(blob) < 8:
        return None

    magic = blob[0:2]
    if magic != b"GP":
        logger.debug("Invalid GPKG magic: %r", magic)
        return None

    flags = blob[3]
    envelope_type = (flags >> 1) & 0x07
    envelope_size = ENVELOPE_SIZES.get(envelope_type, 0)

    # Header is 8 bytes (magic + version + flags + SRID) + envelope
    wkb_offset = 8 + envelope_size

    if len(blob) < wkb_offset + 5:
        logger.debug("Blob too short for WKB after header+envelope")
        return None

    return _decode_wkb(blob, wkb_offset)


def _decode_wkb(data: bytes, offset: int) -> Optional[Dict[str, Any]]:
    """Decode WKB geometry starting at the given offset."""
    if offset + 5 > len(data):
        return None

    byte_order = data[offset]
    fmt_prefix = "<" if byte_order == 1 else ">"
    offset += 1

    wkb_type = struct.unpack_from(f"{fmt_prefix}I", data, offset)[0]
    offset += 4

    if wkb_type == 1:
        return _decode_point(data, offset, fmt_prefix)
    if wkb_type == 2:
        return _decode_linestring(data, offset, fmt_prefix)
    if wkb_type == 3:
        return _decode_polygon(data, offset, fmt_prefix)
    if wkb_type == 5:
        return _decode_multi_linestring(data, offset, fmt_prefix)
    if wkb_type == 6:
        return _decode_multi_polygon(data, offset, fmt_prefix)

    logger.debug("Unsupported WKB type: %d", wkb_type)
    return None


def _decode_point(
    data: bytes, offset: int, fmt: str
) -> Optional[Dict[str, Any]]:
    """Decode WKB Point (type 1): two doubles (x, y)."""
    if offset + 16 > len(data):
        return None
    x, y = struct.unpack_from(f"{fmt}dd", data, offset)
    return {"type": "Point", "coordinates": [x, y]}


def _decode_linestring(
    data: bytes, offset: int, fmt: str
) -> Optional[Tuple[Dict[str, Any], int]]:
    """Decode WKB LineString (type 2)."""
    if offset + 4 > len(data):
        return None
    num_points = struct.unpack_from(f"{fmt}I", data, offset)[0]
    offset += 4
    coords = []
    for _ in range(num_points):
        if offset + 16 > len(data):
            return None
        x, y = struct.unpack_from(f"{fmt}dd", data, offset)
        coords.append([x, y])
        offset += 16
    return {"type": "LineString", "coordinates": coords}


def _read_linestring_coords(
    data: bytes, offset: int, fmt: str
) -> Tuple[List[List[float]], int]:
    """Read LineString coordinates and return (coords, new_offset)."""
    num_points = struct.unpack_from(f"{fmt}I", data, offset)[0]
    offset += 4
    coords = []
    for _ in range(num_points):
        x, y = struct.unpack_from(f"{fmt}dd", data, offset)
        coords.append([x, y])
        offset += 16
    return coords, offset


def _read_ring_coords(
    data: bytes, offset: int, fmt: str
) -> Tuple[List[List[float]], int]:
    """Read a polygon ring (same structure as linestring coords)."""
    return _read_linestring_coords(data, offset, fmt)


def _decode_polygon(
    data: bytes, offset: int, fmt: str
) -> Optional[Dict[str, Any]]:
    """Decode WKB Polygon (type 3)."""
    if offset + 4 > len(data):
        return None
    num_rings = struct.unpack_from(f"{fmt}I", data, offset)[0]
    offset += 4
    rings = []
    for _ in range(num_rings):
        ring, offset = _read_ring_coords(data, offset, fmt)
        rings.append(ring)
    return {"type": "Polygon", "coordinates": rings}


def _decode_multi_linestring(
    data: bytes, offset: int, fmt: str
) -> Optional[Dict[str, Any]]:
    """Decode WKB MultiLineString (type 5)."""
    if offset + 4 > len(data):
        return None
    num_geoms = struct.unpack_from(f"{fmt}I", data, offset)[0]
    offset += 4
    lines = []
    for _ in range(num_geoms):
        # Each sub-geometry has its own WKB header (endian + type)
        offset += 1  # endian byte
        offset += 4  # type (should be 2)
        coords, offset = _read_linestring_coords(data, offset, fmt)
        lines.append(coords)
    return {"type": "MultiLineString", "coordinates": lines}


def _decode_multi_polygon(
    data: bytes, offset: int, fmt: str
) -> Optional[Dict[str, Any]]:
    """Decode WKB MultiPolygon (type 6)."""
    if offset + 4 > len(data):
        return None
    num_geoms = struct.unpack_from(f"{fmt}I", data, offset)[0]
    offset += 4
    polygons = []
    for _ in range(num_geoms):
        # Each sub-geometry has its own WKB header
        offset += 1  # endian byte
        offset += 4  # type (should be 3)
        num_rings = struct.unpack_from(f"{fmt}I", data, offset)[0]
        offset += 4
        rings = []
        for _ in range(num_rings):
            ring, offset = _read_ring_coords(data, offset, fmt)
            rings.append(ring)
        polygons.append(rings)
    return {"type": "MultiPolygon", "coordinates": polygons}


def detect_layer_type(
    columns: List[str],
    sample_geom_type: Optional[str],
    table_name: str = "",
) -> str:
    """
    Auto-detect layer type using column name heuristics, geometry type,
    and table name as fallback.

    Returns one of: poles, joints, cable_spans, drops,
                    zone_boundaries, pon_boundaries, pops, unknown
    """
    col_set = {c.lower() for c in columns}
    tname = table_name.lower()

    # Poles: has "pole type" or "photopole"
    if "pole type" in col_set or "poletype" in col_set or "photopole" in col_set:
        return "poles"

    # POPs: has "node" column
    if "node" in col_set:
        return "pops"

    # Cable spans: has "cable size", "cable_size", or "cablesize"
    if "cable size" in col_set or "cable_size" in col_set or "cablesize" in col_set:
        return "cable_spans"

    # Drops: has "cblcpty" AND geometry is MultiLineString
    if "cblcpty" in col_set and sample_geom_type == "MultiLineString":
        return "drops"

    # Drops: has "strtfeat" + "endfeat" AND MultiLineString (MAM-style drop cables)
    if "strtfeat" in col_set and "endfeat" in col_set and sample_geom_type == "MultiLineString":
        # Distinguish from cable spans: cable spans have cable size/type columns
        if "cablesize" not in col_set and "cable size" not in col_set:
            return "drops"

    # PON boundaries: MultiPolygon with pon_no
    if sample_geom_type == "MultiPolygon" and "pon_no" in col_set:
        return "pon_boundaries"

    # Zone boundaries: MultiPolygon with zone_no (but no pon_no)
    if sample_geom_type == "MultiPolygon" and "zone_no" in col_set:
        return "zone_boundaries"

    # Joints: has "type" column with values like Enclosure/Splitter,
    # or has "cblcpty" with point geometry
    if "type" in col_set and sample_geom_type == "Point":
        # Check table name to avoid misclassifying POPs as joints
        if "pop" in tname:
            return "pops"
        return "joints"
    if "cblcpty" in col_set and sample_geom_type == "Point":
        return "joints"

    # --- Table name fallback when column heuristics fail ---
    if "pop" in tname:
        return "pops"
    if "pole" in tname:
        return "poles"
    if "joint" in tname:
        return "joints"
    if "cablespan" in tname or "cable_span" in tname:
        return "cable_spans"
    if "drop" in tname:
        return "drops"
    if "pon" in tname and sample_geom_type == "MultiPolygon":
        return "pon_boundaries"
    if "zone" in tname and sample_geom_type == "MultiPolygon":
        return "zone_boundaries"

    return "unknown"


def _get_field(row: Dict[str, Any], *candidates: str) -> Any:
    """Return the value of the first matching field name (case-insensitive)."""
    for candidate in candidates:
        for key, val in row.items():
            if key.lower() == candidate.lower():
                return val
    return None


def _safe_int(val: Any) -> Optional[int]:
    """Parse a value to int — handles comma-separated strings like '67,80,81'."""
    if val is None:
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val) if not (val != val) else None  # NaN check
    s = str(val).split(",")[0].strip()
    if not s:
        return None
    try:
        return int(s)
    except (ValueError, TypeError):
        # Try float first (e.g. "67.0")
        try:
            return int(float(s))
        except (ValueError, TypeError):
            return None


def map_feature_fields(
    layer_type: str, row: Dict[str, Any], geom: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Map raw row fields to standardized output fields per layer type."""
    feature: Dict[str, Any] = {}

    if layer_type == "poles":
        feature["pole_number"] = _get_field(
            row, "PoleNumber", "Pole_No", "Pole Nr", "pole_number",
            "label_1", "label",  # MAM-style: label_1 is the pole number
        )
        feature["type"] = _get_field(row, "Pole Type", "PoleType", "pole_type")
        feature["dome_joint"] = _get_field(row, "Dome Joint", "DomeJoint")
        feature["type_of_join"] = _get_field(row, "Type of join", "TypeOfJoin")
        feature["splitter"] = _get_field(row, "Splitter", "splitter")
        feature["slack_on_pole"] = _get_field(
            row, "Slack on Pole", "SlackOnPole", "SlackonPol",
        )
        feature["field_agent"] = _get_field(row, "Field Agent", "FieldAgent")
        feature["pole_planted"] = _get_field(
            row, "Pole Planted", "PolePlanted", "Pole Plant",
        )
        feature["audit_complete"] = _get_field(
            row, "Audit Complete", "AuditComplete", "AuditCompl",
        )
        feature["zone_no"] = _safe_int(_get_field(row, "zone_no"))
        feature["pon_no"] = _safe_int(_get_field(row, "pon_no"))
        if geom and geom["type"] == "Point":
            feature["longitude"] = geom["coordinates"][0]
            feature["latitude"] = geom["coordinates"][1]

    elif layer_type == "joints":
        # Check 'label' before 'fid' — fid is just a row ID
        feature["joint_label"] = _get_field(row, "label", "name", "fid")
        feature["joint_type"] = _get_field(row, "type", "joint_type")
        feature["cable_capacity"] = _get_field(row, "cblcpty", "cable_capacity")
        feature["zone_no"] = _safe_int(_get_field(row, "zone_no"))
        feature["pon_no"] = _safe_int(_get_field(row, "pon_no"))
        if geom and geom["type"] == "Point":
            feature["longitude"] = geom["coordinates"][0]
            feature["latitude"] = geom["coordinates"][1]

    elif layer_type == "cable_spans":
        feature["span_label"] = _get_field(row, "label", "fid", "span_label")
        feature["cable_size"] = _get_field(
            row, "Cable size", "Cable_size", "cable_size", "CableSize",
        )
        feature["span_type"] = _get_field(
            row, "SpanType", "Span_Type", "span_type", "type",
        )
        feature["pon_no"] = _safe_int(_get_field(row, "pon_no"))
        feature["zone_no"] = _safe_int(_get_field(row, "zone_no"))
        feature["length_meters"] = _get_field(row, "Length", "length", "length_m")
        if geom:
            feature["geojson"] = geom

    elif layer_type == "drops":
        feature["drop_number"] = _get_field(
            row, "DropNumber", "drop_number", "label", "fid",
        )
        feature["cable_capacity"] = _get_field(row, "cblcpty", "cable_capacity")
        feature["pon_no"] = _safe_int(_get_field(row, "pon_no"))
        feature["zone_no"] = _safe_int(_get_field(row, "zone_no"))
        if geom:
            feature["geojson"] = geom

    elif layer_type == "zone_boundaries":
        feature["zone_no"] = _safe_int(
            _get_field(row, "zone_no", "section_na", "zone", "Zone")
        )
        if geom:
            feature["geojson"] = geom

    elif layer_type == "pon_boundaries":
        feature["pon_no"] = _safe_int(_get_field(row, "pon_no"))
        feature["zone_no"] = _safe_int(_get_field(row, "zone_no", "Zone"))
        feature["pon_label"] = _get_field(row, "pon_label", "Label", "label")
        if geom:
            feature["geojson"] = geom

    elif layer_type == "pops":
        feature["pop_label"] = _get_field(row, "Node", "label", "name")
        if geom and geom["type"] == "Point":
            feature["longitude"] = geom["coordinates"][0]
            feature["latitude"] = geom["coordinates"][1]
        elif geom:
            feature["geojson"] = geom

    else:
        # Unknown layer: pass through all non-geometry fields
        for key, val in row.items():
            feature[key] = val
        if geom:
            feature["geojson"] = geom

    return feature


def read_gpkg_layers(gpkg_path: str) -> Dict[str, Any]:
    """
    Read all layers from a GeoPackage file.

    Returns dict with layer metadata and decoded features.
    """
    if not os.path.exists(gpkg_path):
        logger.error("File not found: %s", gpkg_path)
        return {}

    conn = sqlite3.connect(gpkg_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Read layer list from gpkg_contents
    try:
        cur.execute(
            "SELECT table_name, identifier, data_type "
            "FROM gpkg_contents WHERE data_type = 'features'"
        )
        content_rows = cur.fetchall()
    except sqlite3.OperationalError:
        logger.error("Not a valid GeoPackage (no gpkg_contents table)")
        conn.close()
        return {}

    if not content_rows:
        logger.warning("No feature layers found in %s", gpkg_path)
        conn.close()
        return {}

    # Read geometry column names
    geom_columns: Dict[str, str] = {}
    try:
        cur.execute(
            "SELECT table_name, column_name FROM gpkg_geometry_columns"
        )
        for row in cur.fetchall():
            geom_columns[row["table_name"]] = row["column_name"]
    except sqlite3.OperationalError:
        logger.warning("No gpkg_geometry_columns table")

    layers: Dict[str, Dict[str, Any]] = {}

    for content_row in content_rows:
        table_name = content_row["table_name"]
        geom_col = geom_columns.get(table_name, "geom")

        logger.info("Reading layer: %s (geom col: %s)", table_name, geom_col)

        try:
            cur.execute(f'SELECT * FROM "{table_name}" LIMIT 1')
            sample = cur.fetchone()
        except sqlite3.OperationalError as exc:
            logger.warning("Cannot read table %s: %s", table_name, exc)
            continue

        if sample is None:
            logger.info("Layer %s is empty", table_name)
            layers[table_name] = {
                "count": 0,
                "sample_fields": [],
                "layer_type": "unknown",
                "features": [],
            }
            continue

        columns = [desc[0] for desc in cur.description]
        non_geom_columns = [c for c in columns if c != geom_col]

        # Decode sample geometry to determine type
        sample_geom = None
        if geom_col in columns and sample[geom_col]:
            sample_geom = decode_gpkg_geometry(sample[geom_col])

        sample_geom_type = sample_geom["type"] if sample_geom else None
        layer_type = detect_layer_type(non_geom_columns, sample_geom_type, table_name)

        logger.info(
            "  Detected type: %s (geom: %s)", layer_type, sample_geom_type
        )

        # Read all rows
        cur.execute(f'SELECT * FROM "{table_name}"')
        all_rows = cur.fetchall()

        features = []
        skipped = 0

        for db_row in all_rows:
            row_dict = {
                col: db_row[col] for col in non_geom_columns
            }
            geom = None
            if geom_col in columns and db_row[geom_col]:
                geom = decode_gpkg_geometry(db_row[geom_col])

            # Filter points outside SA bounds
            if geom and geom["type"] == "Point":
                lon, lat = geom["coordinates"]
                if not is_valid_sa_coordinate(lat, lon):
                    skipped += 1
                    continue

            feature = map_feature_fields(layer_type, row_dict, geom)
            features.append(feature)

        if skipped > 0:
            logger.info(
                "  Filtered %d features outside SA bounds", skipped
            )

        # Store under layer_type key, merging if multiple tables map
        # to the same type
        if layer_type in layers:
            layers[layer_type]["count"] += len(features)
            layers[layer_type]["features"].extend(features)
            existing_fields = set(layers[layer_type]["sample_fields"])
            for col in non_geom_columns:
                if col not in existing_fields:
                    layers[layer_type]["sample_fields"].append(col)
        else:
            layers[layer_type] = {
                "count": len(features),
                "sample_fields": non_geom_columns,
                "source_table": table_name,
                "geometry_type": sample_geom_type,
                "features": features,
            }

        logger.info("  Read %d features (%s)", len(features), table_name)

    conn.close()
    return layers


def fetch_gpkg_from_minio(
    project_id: str, work_dir: str
) -> List[str]:
    """
    Find and copy GPKG files from QFieldCloud MinIO for a project.

    QFieldCloud stores files as versioned objects in MinIO.  Each .gpkg
    "file" is actually a directory of versions (e.g. LAWPoles.gpkg/v202...).
    We list the project files dir, find .gpkg/ entries, then for each one
    fetch the latest version and rename it to the .gpkg filename.

    Uses docker exec to run mc commands inside the MinIO container, then
    docker cp to pull files to the host.
    Returns list of local GPKG file paths.
    """
    container = "qfieldcloud-minio-1"
    minio_path = (
        f"local/qfieldcloud-prod/projects/{project_id}/files/"
    )

    logger.info("Listing files in MinIO: %s", minio_path)

    result = subprocess.run(
        ["docker", "exec", container, "mc", "ls", minio_path],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        logger.error("Failed to list MinIO files: %s", result.stderr.strip())
        return []

    # Collect .gpkg entries (shown as directories with trailing /)
    gpkg_dirs = []
    for line in result.stdout.strip().splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        filename = parts[-1].rstrip("/")
        if filename.lower().endswith(".gpkg"):
            gpkg_dirs.append(filename)

    if not gpkg_dirs:
        logger.warning("No GPKG files found for project %s", project_id)
        return []

    logger.info("Found %d GPKG file(s): %s", len(gpkg_dirs), gpkg_dirs)

    local_paths = []
    for gpkg_name in gpkg_dirs:
        # List versions inside the .gpkg/ directory using --json
        ver_path = f"{minio_path}{gpkg_name}/"
        ver_result = subprocess.run(
            [
                "docker", "exec", container, "mc", "ls",
                "--json", ver_path,
            ],
            capture_output=True,
            text=True,
        )
        if ver_result.returncode != 0:
            logger.error(
                "Failed to list versions for %s: %s",
                gpkg_name,
                ver_result.stderr.strip(),
            )
            continue

        # Parse JSON lines, pick the latest version by lastModified
        versions = []
        for json_line in ver_result.stdout.strip().splitlines():
            try:
                obj = json.loads(json_line)
                key = obj.get("key", "")
                ts = obj.get("lastModified", "")
                if key and ts:
                    versions.append((ts, key))
            except json.JSONDecodeError:
                continue

        if not versions:
            logger.warning("No versions found for %s", gpkg_name)
            continue

        versions.sort(reverse=True)
        latest_version = versions[0][1]
        logger.info(
            "%s: %d versions, using latest: %s",
            gpkg_name, len(versions), latest_version,
        )

        # mc cp the latest version file to /tmp inside the container
        remote_src = f"{ver_path}{latest_version}"
        container_tmp = f"/tmp/{gpkg_name}"

        cp_result = subprocess.run(
            [
                "docker", "exec", container, "mc", "cp",
                remote_src, container_tmp,
            ],
            capture_output=True,
            text=True,
        )
        if cp_result.returncode != 0:
            logger.error(
                "Failed to copy %s in container: %s",
                gpkg_name,
                cp_result.stderr.strip(),
            )
            continue

        # Docker cp from container to host
        local_path = os.path.join(work_dir, gpkg_name)
        dcp_result = subprocess.run(
            [
                "docker", "cp",
                f"{container}:{container_tmp}",
                local_path,
            ],
            capture_output=True,
            text=True,
        )
        if dcp_result.returncode != 0:
            logger.error(
                "Failed docker cp for %s: %s",
                gpkg_name,
                dcp_result.stderr.strip(),
            )
            continue

        logger.info("Copied %s to %s", gpkg_name, local_path)
        local_paths.append(local_path)

    return local_paths


def build_output(
    gpkg_files: List[str],
    all_layers: Dict[str, Dict[str, Any]],
    project_id: Optional[str],
    preview: bool,
) -> Dict[str, Any]:
    """Build the final JSON output structure."""
    output: Dict[str, Any] = {}

    if project_id:
        output["project_id"] = project_id

    output["gpkg_files"] = [os.path.basename(f) for f in gpkg_files]

    layers_out: Dict[str, Any] = {}
    for layer_key, layer_data in all_layers.items():
        entry: Dict[str, Any] = {
            "count": layer_data["count"],
            "sample_fields": layer_data["sample_fields"],
        }
        if layer_data.get("geometry_type"):
            entry["geometry_type"] = layer_data["geometry_type"]
        if layer_data.get("source_table"):
            entry["source_table"] = layer_data["source_table"]
        if not preview:
            entry["features"] = layer_data["features"]
        layers_out[layer_key] = entry

    output["layers"] = layers_out
    return output


def main() -> None:
    """Entry point: parse args, read GPKGs, output JSON."""
    parser = argparse.ArgumentParser(
        description="Read GeoPackage files and output JSON"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--project-id",
        type=str,
        help="QFieldCloud project UUID (fetches GPKG from MinIO)",
    )
    group.add_argument(
        "--file",
        type=str,
        help="Path to a local GPKG file",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Only output counts and sample fields (no features)",
    )

    args = parser.parse_args()

    gpkg_paths: List[str] = []
    project_id: Optional[str] = None
    work_dir: Optional[str] = None

    if args.project_id:
        project_id = args.project_id
        work_dir = tempfile.mkdtemp(prefix="gpkg_reader_")
        logger.info("Work directory: %s", work_dir)
        gpkg_paths = fetch_gpkg_from_minio(project_id, work_dir)
        if not gpkg_paths:
            logger.error("No GPKG files retrieved from MinIO")
            sys.exit(1)
    else:
        if not os.path.exists(args.file):
            logger.error("File not found: %s", args.file)
            sys.exit(1)
        gpkg_paths = [args.file]

    # Read all GPKG files and merge layers by type
    merged_layers: Dict[str, Dict[str, Any]] = {}

    for gpkg_path in gpkg_paths:
        logger.info("Processing: %s", gpkg_path)
        file_layers = read_gpkg_layers(gpkg_path)

        for layer_key, layer_data in file_layers.items():
            if layer_key in merged_layers:
                merged_layers[layer_key]["count"] += layer_data["count"]
                merged_layers[layer_key]["features"].extend(
                    layer_data["features"]
                )
                existing_fields = set(
                    merged_layers[layer_key]["sample_fields"]
                )
                for col in layer_data["sample_fields"]:
                    if col not in existing_fields:
                        merged_layers[layer_key]["sample_fields"].append(col)
            else:
                merged_layers[layer_key] = layer_data

    # Build output
    output = build_output(gpkg_paths, merged_layers, project_id, args.preview)

    # Summary to stderr
    total_features = sum(
        layer["count"] for layer in merged_layers.values()
    )
    logger.info("=" * 50)
    logger.info("SUMMARY: %d files, %d layers, %d features",
                len(gpkg_paths), len(merged_layers), total_features)
    for layer_key, layer_data in merged_layers.items():
        logger.info(
            "  %-20s %6d features  [%s]",
            layer_key,
            layer_data["count"],
            layer_data.get("geometry_type", "?"),
        )
    logger.info("=" * 50)

    # JSON to stdout
    json.dump(output, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")

    # Clean up temp dir if we created one
    if work_dir:
        shutil.rmtree(work_dir, ignore_errors=True)
        logger.info("Cleaned up work directory: %s", work_dir)


if __name__ == "__main__":
    main()
