#!/usr/bin/env python3
"""
Ingest dome joint photos from SharePoint Optical QA folders into construction_qa_photos.

Walks SharePoint Optical QA folders, finds dome joint photo folders, extracts the pole
number from the folder name, spatially matches the pole to the nearest joint in the DB,
and inserts photos linked to the existing construction_qa_reviews stubs (from migration 191).

With --vlm-fallback, unmatched photos are sent to the VLM (Qwen3-VL on Velocity:8100)
to extract GPS coordinates printed on the photos, then spatially matched to the nearest joint.

Usage:
  python3 scripts/ingest-sharepoint-joint-qa.py --project Lawley --dry-run
  python3 scripts/ingest-sharepoint-joint-qa.py --project Lawley --vlm-fallback --dry-run
  python3 scripts/ingest-sharepoint-joint-qa.py --project all --dry-run

Requires: psycopg2, requests, Pillow (for --vlm-fallback)
"""

import argparse
import base64
import io
import json
import math
import re
import sys
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import requests

# -- SharePoint Graph API config (same as pole ingestion) ----------------------

SP_TENANT_ID = "f22e6344-a35d-43b0-ad8c-a247f513c1ee"
SP_CLIENT_ID = "075bd672-bffa-45ba-9fd0-724535e612db"
SP_CLIENT_SECRET = "Ozw8Q~HG1PMZFPNb0Ze1f-eTYrtglVioRzy2lakF"
SP_DRIVE_ID = "b!54aBz82X_0qdf-Qc8hPv-PQzZQ4Q2eFGrzwQ6nSz79cVH1Quyz5vQavmQwdsBGRy"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# -- Optical QA folder roots per project (from deep SharePoint scan) -----------

JOINT_FOLDER_ROOTS = {
    "Lawley": {
        "project_db_id": "4eb13426-b2a1-472d-9b3c-277082ae9b55",
        "pole_prefix": "LAW.P.",
        "roots": [
            # Lawley QA Photos (Velocity_Optical_Department)
            ("Lawley QA Photos", "01XUF54KEPCFWG56X3A5GJHXQ2R2CIQNT7"),
            # Lawley Cut Over
            ("Lawley Cut Over", "01XUF54KDEV2M6WCCPYJFLBXLG4MEWDKO3"),
        ],
    },
    "Mohadin": {
        "project_db_id": None,  # Looked up from DB
        "pole_prefix": "MOH.P.",
        "roots": [
            # Mohadin QA Photos
            ("Mohadin QA Photos", "01XUF54KEXEYY6PGRGBVEIRC6RYBGWQQJ7"),
            # Mohadin Main Feeder Joints
            ("Mohadin Main Feeder Joints", "01XUF54KEG6R6B5V2RCZAL4NVDHT3NVAMM"),
        ],
    },
    "Mamelodi": {
        "project_db_id": None,
        "pole_prefix": "MAM.P.",
        "roots": [
            # Mamelodi QA Pictures
            ("Mamelodi QA Pictures", "01XUF54KH2PEC2EVXIMNA3ZHCXYG2U3JDJ"),
        ],
    },
}

# Keywords that identify a dome joint folder
JOINT_FOLDER_KEYWORDS = ["joint", "dome", "splitter", "dj", "feeder joint", "main joint"]

# Regex to extract pole number from folder names like:
#   "LAW.P.C099_Feeder Joint"  -> LAW.P.C099
#   "MOA.P.A381 Feeder Joint"  -> MOA.P.A381
#   "MAM.P.A335A_Joint"        -> MAM.P.A335A (try with suffix first, strip if not found)
POLE_FROM_FOLDER_RE = re.compile(
    r"([A-Z]{3}\.P\.[A-Z]\d{3,4}[A-Z]?)", re.IGNORECASE
)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# Namespace UUID for deterministic photo IDs (same as pole ingestion)
QA_NAMESPACE = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

# Spatial matching thresholds (meters)
MAX_MATCH_DISTANCE_M = 50
WARN_DISTANCE_M = 25

# VLM config (Qwen3-VL on Velocity)
VLM_URL = "http://100.96.203.105:8100"
VLM_MODEL = "QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ"
VLM_MAX_DIM = 1024  # Max image dimension for VLM token budget


def get_token():
    """Get MS Graph API bearer token."""
    resp = requests.post(
        f"https://login.microsoftonline.com/{SP_TENANT_ID}/oauth2/v2.0/token",
        data={
            "client_id": SP_CLIENT_ID,
            "client_secret": SP_CLIENT_SECRET,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def list_children(token, folder_id, top=200):
    """List all children of a SharePoint folder, handling pagination."""
    items = []
    url = f"{GRAPH_BASE}/drives/{SP_DRIVE_ID}/items/{folder_id}/children"
    params = {"$top": str(top), "$select": "name,id,folder,size,file,lastModifiedDateTime,parentReference"}
    headers = {"Authorization": f"Bearer {token}"}
    while url:
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        items.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
        params = None
    return items


def scan_folder_recursive(token, folder_id, path="", depth=0, max_depth=5):
    """Recursively scan SharePoint folder and collect all image files with metadata."""
    if depth > max_depth:
        return []

    results = []
    items = list_children(token, folder_id)

    for item in items:
        name = item["name"]
        item_path = f"{path}/{name}" if path else name

        if "folder" in item:
            sub = scan_folder_recursive(token, item["id"], item_path, depth + 1, max_depth)
            results.extend(sub)
        elif "file" in item:
            ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if ext in IMAGE_EXTS:
                results.append({
                    "name": name,
                    "path": item_path,
                    "id": item["id"],
                    "size": item.get("size", 0),
                    "mime": item.get("file", {}).get("mimeType", "image/jpeg"),
                    "modified": item.get("lastModifiedDateTime"),
                    "parent_id": item.get("parentReference", {}).get("id"),
                    "parent_path": item.get("parentReference", {}).get("path", ""),
                })
    return results


def is_joint_folder(name):
    """Check if a folder name indicates it contains dome joint photos."""
    lower = name.lower()
    return any(kw in lower for kw in JOINT_FOLDER_KEYWORDS)


def extract_pole_from_folder(folder_name):
    """Extract pole number from a joint folder name.

    Examples:
      "LAW.P.C099_Feeder Joint" -> "LAW.P.C099"
      "MOA.P.A381 Feeder Joint" -> "MOA.P.A381"
      "MAM.P.A335A_Joint"       -> "MAM.P.A335A"
    """
    m = POLE_FROM_FOLDER_RE.search(folder_name)
    if m:
        return m.group(1).upper()
    return None


def haversine_m(lat1, lon1, lat2, lon2):
    """Haversine distance in meters between two lat/lon points."""
    R = 6_371_000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def spatial_match_joint(pole_lat, pole_lon, project_joints):
    """Find the nearest joint to a pole within the same project.

    Args:
        pole_lat: Pole latitude
        pole_lon: Pole longitude
        project_joints: List of joint dicts with latitude, longitude, joint_label

    Returns:
        (joint_label, distance_m) or (None, None)
    """
    best_label = None
    best_dist = float("inf")

    for j in project_joints:
        jlat = j.get("latitude")
        jlon = j.get("longitude")
        if jlat is None or jlon is None:
            continue
        dist = haversine_m(float(pole_lat), float(pole_lon), float(jlat), float(jlon))
        if dist < best_dist:
            best_dist = dist
            best_label = j["joint_label"]

    if best_label and best_dist <= MAX_MATCH_DISTANCE_M:
        return best_label, best_dist
    return None, best_dist if best_label else None


def detect_before_after(photo_path):
    """Detect Before/After from subfolder or filename.

    Returns 'before', 'after', or None.
    """
    lower = photo_path.lower()
    if "/before" in lower or "\\before" in lower or lower.startswith("before"):
        return "before"
    if "/after" in lower or "\\after" in lower or lower.startswith("after"):
        return "after"
    # Check filename
    fname = lower.rsplit("/", 1)[-1] if "/" in lower else lower
    if fname.startswith("before"):
        return "before"
    if fname.startswith("after"):
        return "after"
    return None


def deterministic_uuid(namespace, key):
    """Generate a deterministic UUID from namespace + key for idempotent inserts."""
    return str(uuid.uuid5(uuid.UUID(namespace), key))


# -- VLM GPS extraction functions ----------------------------------------------

def download_sp_photo_bytes(token, item_id, max_bytes=10_000_000):
    """Download a photo from SharePoint and return raw bytes."""
    url = f"{GRAPH_BASE}/drives/{SP_DRIVE_ID}/items/{item_id}/content"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60, stream=True)
    resp.raise_for_status()
    data = resp.content
    if len(data) > max_bytes:
        return None
    return data


def resize_photo_for_vlm(photo_bytes):
    """Resize photo to fit within VLM token limits. Returns JPEG base64 string.

    Requires Pillow.
    """
    from PIL import Image

    img = Image.open(io.BytesIO(photo_bytes))
    img.thumbnail((VLM_MAX_DIM, VLM_MAX_DIM), Image.LANCZOS)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


GPS_DECIMAL_RE = re.compile(
    r"(-?\d{1,3}\.\d{3,8})\s*[,\s]\s*(-?\d{1,3}\.\d{3,8})"
)

GPS_DMS_RE = re.compile(
    r"""
    ([NS])\s*(\d{1,3})[°]\s*(\d{1,2})[′']\s*(\d{1,2}(?:\.\d+)?)[″"]\s*
    ([EW])\s*(\d{1,3})[°]\s*(\d{1,2})[′']\s*(\d{1,2}(?:\.\d+)?)[″"]
    """,
    re.VERBOSE | re.IGNORECASE,
)

# Also match: S 25° 45' 12.3" E 28° 15' 45.6"
GPS_DMS_RE2 = re.compile(
    r"""
    ([NS])\s*(\d{1,3})\s*[°]\s*(\d{1,2})\s*[′']\s*(\d{1,2}(?:\.\d+)?)\s*[″"]\s*
    ([EW])\s*(\d{1,3})\s*[°]\s*(\d{1,2})\s*[′']\s*(\d{1,2}(?:\.\d+)?)\s*[″"]
    """,
    re.VERBOSE | re.IGNORECASE,
)


def parse_gps_from_vlm(text):
    """Parse GPS coordinates from VLM response text.

    Handles:
      - Decimal: -25.753417, 28.262667
      - DMS: S 25° 45' 12.3" E 28° 15' 45.6"
      - JSON: {"latitude": -25.753, "longitude": 28.262}

    Returns (lat, lon) as floats or (None, None).
    """
    # Try JSON first
    try:
        json_match = re.search(r"\{[^}]*\}", text)
        if json_match:
            parsed = json.loads(json_match.group())
            lat = parsed.get("latitude") or parsed.get("lat")
            lon = parsed.get("longitude") or parsed.get("lon") or parsed.get("lng")
            if lat is not None and lon is not None:
                lat, lon = float(lat), float(lon)
                if -90 <= lat <= 90 and -180 <= lon <= 180:
                    return lat, lon
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # Try decimal degrees (common GPS stamp format: -25.753417, 28.262667)
    m = GPS_DECIMAL_RE.search(text)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        # South Africa is around lat -23 to -35, lon 16 to 33
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return lat, lon
        # Maybe swapped
        if -90 <= lon <= 90 and -180 <= lat <= 180:
            return lon, lat

    # Try DMS format
    for pattern in (GPS_DMS_RE, GPS_DMS_RE2):
        m = pattern.search(text)
        if m:
            ns, lat_d, lat_m, lat_s, ew, lon_d, lon_m, lon_s = m.groups()
            lat = float(lat_d) + float(lat_m) / 60 + float(lat_s) / 3600
            lon = float(lon_d) + float(lon_m) / 60 + float(lon_s) / 3600
            if ns.upper() == "S":
                lat = -lat
            if ew.upper() == "W":
                lon = -lon
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return lat, lon

    return None, None


def vlm_extract_gps(photo_b64):
    """Send a photo to the VLM and extract GPS coordinates printed on it.

    Returns (lat, lon) or (None, None).
    """
    prompt = (
        "This photo has GPS coordinates printed/stamped on it (usually in a corner or overlay). "
        "Read the GPS coordinates exactly as shown. Respond with ONLY a JSON object:\n"
        '{"latitude": <decimal_degrees>, "longitude": <decimal_degrees>}\n'
        "If the coordinates are in DMS format (degrees, minutes, seconds), convert to decimal degrees. "
        "South latitudes should be negative. East longitudes should be positive. "
        "If no GPS coordinates are visible, respond: {\"latitude\": null, \"longitude\": null}"
    )

    try:
        resp = requests.post(
            f"{VLM_URL}/v1/chat/completions",
            json={
                "model": VLM_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}", "detail": "high"},
                        },
                        {"type": "text", "text": prompt},
                    ],
                }],
                "max_tokens": 256,
                "temperature": 0.1,
            },
            timeout=60,
        )
        resp.raise_for_status()
        text = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
        return parse_gps_from_vlm(text)
    except Exception as e:
        print(f"      VLM error: {e}")
        return None, None


def vlm_fallback_match(unmatched_folders, token, project_joints, existing_photo_keys):
    """Use VLM to extract GPS from unmatched folder photos and match to nearest joint.

    For each unmatched folder, downloads one sample photo, sends to VLM for GPS extraction,
    then spatially matches to the nearest joint.

    Returns list of matched entries (same format as main matched list).
    """
    vlm_matched = []
    vlm_no_gps = []
    vlm_no_joint = []
    vlm_errors = 0

    total = len(unmatched_folders)
    print(f"    Processing {total} unmatched folders through VLM GPS extraction...")

    for i, jf in enumerate(unmatched_folders):
        folder_name = jf["joint_folder_name"]
        photos = jf["photos"]
        if not photos:
            continue

        # Pick the largest photo as sample (more likely to have readable GPS stamp)
        sample = max(photos, key=lambda p: p.get("size", 0))

        print(f"      [{i+1}/{total}] {folder_name} — downloading {sample['name']}...", end=" ", flush=True)

        try:
            photo_bytes = download_sp_photo_bytes(token, sample["id"])
            if not photo_bytes:
                print("too large, skip")
                vlm_errors += 1
                continue

            photo_b64 = resize_photo_for_vlm(photo_bytes)
            lat, lon = vlm_extract_gps(photo_b64)

            if lat is None or lon is None:
                print("no GPS found")
                vlm_no_gps.append(jf)
                continue

            print(f"GPS: {lat:.6f}, {lon:.6f}", end=" ")

            # Spatial match to nearest joint
            joint_label, dist = spatial_match_joint(lat, lon, project_joints)

            if not joint_label:
                dist_str = f"{round(dist, 1)}m" if dist else "no joints"
                print(f"-> no joint within {MAX_MATCH_DISTANCE_M}m (nearest: {dist_str})")
                vlm_no_joint.append((jf, lat, lon, dist))
                continue

            print(f"-> {joint_label} ({round(dist, 1)}m)")

            # Filter duplicates
            new_photos = []
            for p in photos:
                sk = f"sharepoint:{SP_DRIVE_ID}:{p['id']}"
                if sk not in existing_photo_keys:
                    new_photos.append(p)

            if new_photos:
                vlm_matched.append({
                    "joint_label": joint_label,
                    "distance_m": round(dist, 1),
                    "pole_number": f"VLM-GPS({lat:.5f},{lon:.5f})",
                    "folder_name": folder_name,
                    "sp_path": jf["sp_path"],
                    "photos": new_photos,
                    "vlm_gps": (lat, lon),
                })
        except Exception as e:
            print(f"error: {e}")
            vlm_errors += 1

    print()
    print(f"    VLM fallback results:")
    print(f"      Matched via GPS:   {len(vlm_matched)} folders ({sum(len(m['photos']) for m in vlm_matched)} photos)")
    print(f"      No GPS visible:    {len(vlm_no_gps)}")
    print(f"      No joint in range: {len(vlm_no_joint)}")
    print(f"      Errors:            {vlm_errors}")
    print()

    return vlm_matched


def walk_optical_qa_roots(token, roots, project_name):
    """Walk Optical QA root folders, find dome joint folders, and collect photos.

    Returns list of dicts:
      { "joint_folder_name": str, "pole_number": str|None, "photos": [...], "sp_path": str }
    """
    joint_folders = []

    for root_label, root_id in roots:
        print(f"    Scanning root: {root_label} ({root_id[:12]}...)")

        # Walk Zone -> PON -> look for joint folders
        zone_items = list_children(token, root_id)
        for zone_item in zone_items:
            if "folder" not in zone_item:
                continue
            zone_name = zone_item["name"]

            # Check if this zone-level folder IS a joint folder
            if is_joint_folder(zone_name):
                pole_num = extract_pole_from_folder(zone_name)
                photos = scan_folder_recursive(
                    token, zone_item["id"],
                    path=f"{root_label}/{zone_name}",
                    max_depth=3,
                )
                if photos:
                    joint_folders.append({
                        "joint_folder_name": zone_name,
                        "pole_number": pole_num,
                        "photos": photos,
                        "sp_path": f"{root_label}/{zone_name}",
                    })
                continue

            # Recurse into Zone -> PON level
            pon_items = list_children(token, zone_item["id"])
            for pon_item in pon_items:
                if "folder" not in pon_item:
                    continue
                pon_name = pon_item["name"]

                # Check if PON-level folder IS a joint folder
                if is_joint_folder(pon_name):
                    pole_num = extract_pole_from_folder(pon_name)
                    photos = scan_folder_recursive(
                        token, pon_item["id"],
                        path=f"{root_label}/{zone_name}/{pon_name}",
                        max_depth=3,
                    )
                    if photos:
                        joint_folders.append({
                            "joint_folder_name": pon_name,
                            "pole_number": pole_num,
                            "photos": photos,
                            "sp_path": f"{root_label}/{zone_name}/{pon_name}",
                        })
                    continue

                # Recurse one more level: PON -> individual folders
                leaf_items = list_children(token, pon_item["id"])
                for leaf_item in leaf_items:
                    if "folder" not in leaf_item:
                        continue
                    leaf_name = leaf_item["name"]

                    if is_joint_folder(leaf_name):
                        pole_num = extract_pole_from_folder(leaf_name)
                        photos = scan_folder_recursive(
                            token, leaf_item["id"],
                            path=f"{root_label}/{zone_name}/{pon_name}/{leaf_name}",
                            max_depth=3,
                        )
                        if photos:
                            joint_folders.append({
                                "joint_folder_name": leaf_name,
                                "pole_number": pole_num,
                                "photos": photos,
                                "sp_path": f"{root_label}/{zone_name}/{pon_name}/{leaf_name}",
                            })

    return joint_folders


def run_ingestion(project_name, db_url, dry_run=False, vlm_fallback=False):
    """Main ingestion pipeline for dome joint photos."""
    config = JOINT_FOLDER_ROOTS.get(project_name)
    if not config:
        print(f"ERROR: Unknown project '{project_name}'. Known: {list(JOINT_FOLDER_ROOTS.keys())}")
        sys.exit(1)

    step_count = 7 if vlm_fallback else 6

    print(f"\n{'='*70}")
    print(f"  SharePoint Dome Joint Photos -> Construction QA")
    print(f"  Project: {project_name}")
    print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    if vlm_fallback:
        print(f"  VLM Fallback: ENABLED (GPS extraction for unmatched)")
    print(f"{'='*70}\n")

    # -- Step 1: Get Graph API token -------------------------------------------
    print(f"  [1/{step_count}] Authenticating with MS Graph API...")
    token = get_token()
    print("    OK Token acquired\n")

    # -- Step 2: Connect to DB -------------------------------------------------
    print(f"  [2/{step_count}] Connecting to database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Get project ID
    project_id = config["project_db_id"]
    if not project_id:
        cur.execute("SELECT id FROM projects WHERE project_name = %s", (project_name,))
        row = cur.fetchone()
        if not row:
            print(f"    ERROR: Project '{project_name}' not found in DB")
            sys.exit(1)
        project_id = str(row["id"])

    # Load poles for this project (need coordinates for spatial matching)
    cur.execute(
        "SELECT id, pole_number, latitude, longitude FROM poles "
        "WHERE project_id = %s::uuid AND latitude IS NOT NULL AND longitude IS NOT NULL",
        (project_id,),
    )
    poles_by_number = {}
    for row in cur.fetchall():
        pn = row["pole_number"].upper() if row["pole_number"] else None
        if pn:
            poles_by_number[pn] = row
    print(f"    Loaded {len(poles_by_number)} poles with coordinates for {project_name}")

    # Load joints for this project (spatial matching targets)
    cur.execute(
        "SELECT joint_label, latitude, longitude, zone_no, pon_no FROM joints "
        "WHERE project_id = %s::uuid AND latitude IS NOT NULL AND longitude IS NOT NULL",
        (project_id,),
    )
    project_joints = [dict(r) for r in cur.fetchall()]
    print(f"    Loaded {len(project_joints)} joints with coordinates for {project_name}")

    # Load existing splicing reviews (from migration 191)
    cur.execute(
        "SELECT id, feature_id, photo_count FROM construction_qa_reviews "
        "WHERE project_id = %s::uuid AND discipline = 'splicing' AND feature_type = 'joint'",
        (project_id,),
    )
    reviews_by_joint = {}
    for row in cur.fetchall():
        reviews_by_joint[row["feature_id"]] = {
            "id": str(row["id"]),
            "photo_count": row["photo_count"] or 0,
        }
    print(f"    Loaded {len(reviews_by_joint)} existing splicing reviews\n")

    # -- Step 3: Walk SharePoint Optical QA folders ----------------------------
    print(f"  [3/{step_count}] Walking SharePoint Optical QA folders...")
    joint_folders = walk_optical_qa_roots(token, config["roots"], project_name)
    total_photos = sum(len(jf["photos"]) for jf in joint_folders)
    print(f"    Found {len(joint_folders)} joint folders containing {total_photos} photos\n")

    # -- Step 4: Extract pole numbers + spatial match to joints ----------------
    print(f"  [4/{step_count}] Matching folders to joints via pole -> spatial lookup...")

    # Reconnect to DB (SP walk may have taken a while)
    try:
        cur.close()
        conn.close()
    except Exception:
        pass
    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Load existing photo storage_keys to skip duplicates
    cur.execute(
        "SELECT storage_key FROM construction_qa_photos WHERE project_id = %s::uuid AND source = 'sharepoint'",
        (project_id,),
    )
    existing_photo_keys = {row["storage_key"] for row in cur.fetchall()}
    print(f"    {len(existing_photo_keys)} existing SP photos in DB\n")

    matched = []       # Successfully matched: { joint_label, distance_m, photos, folder_name, pole_number }
    no_pole_ref = []   # Folder has no extractable pole number
    pole_not_found = []  # Pole number not in poles table
    no_joint_match = []  # No joint within threshold
    warn_distance = []   # Matched but >25m (for review)
    skipped_dup = 0

    for jf in joint_folders:
        pole_num = jf["pole_number"]

        if not pole_num:
            no_pole_ref.append(jf)
            continue

        # Try exact match first, then strip trailing letter
        pole_row = poles_by_number.get(pole_num)
        if not pole_row and len(pole_num) > 7 and pole_num[-1].isalpha():
            pole_num_stripped = pole_num[:-1]
            pole_row = poles_by_number.get(pole_num_stripped)
            if pole_row:
                pole_num = pole_num_stripped

        if not pole_row:
            pole_not_found.append(jf)
            continue

        plat = pole_row["latitude"]
        plon = pole_row["longitude"]
        if plat is None or plon is None:
            pole_not_found.append(jf)
            continue

        joint_label, dist = spatial_match_joint(plat, plon, project_joints)

        if not joint_label:
            no_joint_match.append((jf, dist))
            continue

        # Filter out duplicate photos
        new_photos = []
        for p in jf["photos"]:
            sk = f"sharepoint:{SP_DRIVE_ID}:{p['id']}"
            if sk in existing_photo_keys:
                skipped_dup += 1
            else:
                new_photos.append(p)

        if not new_photos:
            skipped_dup += len(jf["photos"]) - len(new_photos)
            continue

        entry = {
            "joint_label": joint_label,
            "distance_m": round(dist, 1),
            "pole_number": pole_num,
            "folder_name": jf["joint_folder_name"],
            "sp_path": jf["sp_path"],
            "photos": new_photos,
        }
        matched.append(entry)
        if dist > WARN_DISTANCE_M:
            warn_distance.append(entry)

    total_matched_photos = sum(len(m["photos"]) for m in matched)
    print(f"    Matched: {len(matched)} folders -> {total_matched_photos} new photos")
    print(f"    No pole ref in folder name: {len(no_pole_ref)}")
    print(f"    Pole not found in DB: {len(pole_not_found)}")
    print(f"    No joint within {MAX_MATCH_DISTANCE_M}m: {len(no_joint_match)}")
    print(f"    Skipped duplicates: {skipped_dup}\n")

    # -- Step 5 (optional): VLM GPS fallback for unmatched folders -------------
    vlm_matched = []
    if vlm_fallback:
        unmatched_all = no_pole_ref + pole_not_found + [jf for jf, _ in no_joint_match]
        if unmatched_all:
            print(f"  [5/{step_count}] VLM GPS fallback for {len(unmatched_all)} unmatched folders...")
            vlm_matched = vlm_fallback_match(unmatched_all, token, project_joints, existing_photo_keys)
            matched.extend(vlm_matched)
            total_matched_photos = sum(len(m["photos"]) for m in matched)
        else:
            print(f"  [5/{step_count}] VLM GPS fallback — no unmatched folders to process\n")

    # -- Show match details ----------------------------------------------------
    detail_step = 6 if vlm_fallback else 5
    print(f"  [{detail_step}/{step_count}] Match details:\n")

    if matched:
        print(f"    Matched folders ({len(matched)}):")
        for m in matched[:20]:
            dist_flag = " [!>25m]" if m["distance_m"] > WARN_DISTANCE_M else ""
            review_exists = "review-exists" if m["joint_label"] in reviews_by_joint else "NO-REVIEW"
            print(f"      {m['folder_name']} -> pole {m['pole_number']} -> joint {m['joint_label']} "
                  f"({m['distance_m']}m) [{len(m['photos'])} photos] [{review_exists}]{dist_flag}")
        if len(matched) > 20:
            print(f"      ... and {len(matched) - 20} more")
        print()

    if warn_distance:
        print(f"    WARNING: {len(warn_distance)} matches with distance > {WARN_DISTANCE_M}m:")
        for w in warn_distance[:10]:
            print(f"      {w['folder_name']} -> {w['joint_label']} @ {w['distance_m']}m")
        print()

    if no_pole_ref:
        print(f"    No pole reference ({len(no_pole_ref)}):")
        for jf in no_pole_ref[:10]:
            print(f"      {jf['joint_folder_name']} ({len(jf['photos'])} photos)")
        print()

    if pole_not_found:
        print(f"    Pole not in DB ({len(pole_not_found)}):")
        for jf in pole_not_found[:10]:
            print(f"      {jf['joint_folder_name']} -> pole {jf['pole_number']}")
        print()

    if no_joint_match:
        print(f"    No joint within {MAX_MATCH_DISTANCE_M}m ({len(no_joint_match)}):")
        for jf, dist in no_joint_match[:10]:
            dist_str = f"{round(dist, 1)}m" if dist else "no joints with coords"
            print(f"      {jf['joint_folder_name']} -> pole {jf['pole_number']} (nearest: {dist_str})")
        print()

    if vlm_matched:
        print(f"    VLM GPS matches ({len(vlm_matched)}):")
        for m in vlm_matched[:20]:
            gps = m.get("vlm_gps", (0, 0))
            print(f"      {m['folder_name']} -> GPS ({gps[0]:.5f},{gps[1]:.5f}) -> {m['joint_label']} ({m['distance_m']}m) [{len(m['photos'])} photos]")
        if len(vlm_matched) > 20:
            print(f"      ... and {len(vlm_matched) - 20} more")
        print()

    # -- Insert records --------------------------------------------------------
    insert_step = step_count
    if dry_run:
        print(f"  [{insert_step}/{step_count}] DRY RUN -- no records inserted\n")
    else:
        print(f"  [{insert_step}/{step_count}] Inserting {total_matched_photos} photos for {len(matched)} joints...")
        photos_inserted = 0
        reviews_updated = 0
        no_review_skipped = 0

        for m in matched:
            joint_label = m["joint_label"]
            review = reviews_by_joint.get(joint_label)

            if not review:
                no_review_skipped += 1
                continue

            review_id = review["id"]

            for p in m["photos"]:
                photo_id = deterministic_uuid(QA_NAMESPACE, f"{review_id}:photo:{p['id']}")
                storage_key = f"sharepoint:{SP_DRIVE_ID}:{p['id']}"
                storage_url = f"https://graph.microsoft.com/v1.0/drives/{SP_DRIVE_ID}/items/{p['id']}/content"

                # Detect before/after from path
                ba = detect_before_after(p["path"])
                step_label = ba.capitalize() if ba else None

                try:
                    cur.execute("""
                        INSERT INTO construction_qa_photos (
                            id, review_id, project_id, source, storage_key,
                            storage_url, filename, file_size_bytes, mime_type,
                            captured_at, checklist_step, step_label
                        ) VALUES (
                            %s::uuid, %s::uuid, %s::uuid, 'sharepoint', %s,
                            %s, %s, %s, %s,
                            %s, %s, %s
                        )
                        ON CONFLICT DO NOTHING
                    """, (
                        photo_id, review_id, project_id, storage_key,
                        storage_url, p["name"], p["size"], p.get("mime", "image/jpeg"),
                        p.get("modified"), None, step_label,
                    ))
                    photos_inserted += 1
                except Exception as e:
                    print(f"    ERROR inserting photo {p['name']}: {e}")

            # Update review photo_count and metadata
            new_photo_count = len(m["photos"])
            photos_json_entries = [{
                "filename": p["name"],
                "storage_key": f"sharepoint:{SP_DRIVE_ID}:{p['id']}",
                "source": "sharepoint",
                "size": p["size"],
            } for p in m["photos"]]

            try:
                cur.execute("""
                    UPDATE construction_qa_reviews
                    SET photo_count = photo_count + %s,
                        photos_json = COALESCE(photos_json, '[]'::jsonb) || %s::jsonb,
                        photo_sources = CASE
                            WHEN 'sharepoint' = ANY(photo_sources) THEN photo_sources
                            ELSE array_append(COALESCE(photo_sources, ARRAY[]::text[]), 'sharepoint')
                        END,
                        last_photo_at = %s,
                        first_submitted_at = COALESCE(first_submitted_at, now()),
                        last_submitted_at = now(),
                        updated_at = now()
                    WHERE id = %s::uuid
                """, (
                    new_photo_count,
                    json.dumps(photos_json_entries),
                    m["photos"][0].get("modified"),
                    review_id,
                ))
                reviews_updated += 1
            except Exception as e:
                print(f"    ERROR updating review for {joint_label}: {e}")

            if reviews_updated % 50 == 0:
                conn.commit()

        conn.commit()

        print(f"    Photos inserted:     {photos_inserted}")
        print(f"    Reviews updated:     {reviews_updated}")
        if no_review_skipped:
            print(f"    Skipped (no review): {no_review_skipped}")
        print()

    # -- Summary ---------------------------------------------------------------
    pole_matched_count = len(matched) - len(vlm_matched)
    pole_matched_photos = sum(len(m["photos"]) for m in matched if "vlm_gps" not in m)
    vlm_matched_photos = sum(len(m["photos"]) for m in vlm_matched)

    print("=" * 70)
    print(f"  INGESTION {'(DRY RUN) ' if dry_run else ''}COMPLETE -- {project_name}")
    print(f"  Joint folders found:   {len(joint_folders)} ({total_photos} photos)")
    print(f"  Matched (pole+spatial):{pole_matched_count} ({pole_matched_photos} photos)")
    if vlm_fallback:
        print(f"  Matched (VLM GPS):     {len(vlm_matched)} ({vlm_matched_photos} photos)")
    print(f"  Total matched:         {len(matched)} ({total_matched_photos} photos)")
    print(f"  No pole ref:           {len(no_pole_ref)}")
    print(f"  Pole not in DB:        {len(pole_not_found)}")
    print(f"  No joint match:        {len(no_joint_match)}")
    print(f"  Skipped duplicates:    {skipped_dup}")
    if warn_distance:
        print(f"  Distance warnings:     {len(warn_distance)} (>{WARN_DISTANCE_M}m)")
    if not dry_run:
        print(f"  Photos inserted:       {photos_inserted}")
        print(f"  Reviews updated:       {reviews_updated}")
    print("=" * 70)

    cur.close()
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest SharePoint dome joint photos into Construction QA")
    parser.add_argument("--project", required=True, help="Project name (Lawley, Mohadin, Mamelodi) or 'all'")
    parser.add_argument("--dry-run", action="store_true", help="Scan and match only, don't insert")
    parser.add_argument("--vlm-fallback", action="store_true",
                        help="Use VLM to extract GPS from unmatched photos and match to nearest joint")
    parser.add_argument("--db-url", help="Database URL (defaults to DATABASE_URL env var)")
    args = parser.parse_args()

    if args.vlm_fallback:
        try:
            from PIL import Image  # noqa: F401
        except ImportError:
            print("ERROR: --vlm-fallback requires Pillow. Install with: pip install Pillow")
            sys.exit(1)

    import os
    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: No database URL. Set DATABASE_URL or use --db-url")
        sys.exit(1)

    if args.project.lower() == "all":
        for proj in JOINT_FOLDER_ROOTS:
            run_ingestion(proj, db_url, dry_run=args.dry_run, vlm_fallback=args.vlm_fallback)
    else:
        run_ingestion(args.project, db_url, dry_run=args.dry_run, vlm_fallback=args.vlm_fallback)
