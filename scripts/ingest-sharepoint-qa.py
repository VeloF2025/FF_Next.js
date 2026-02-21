#!/usr/bin/env python3
"""
Ingest construction QA pole/joint photos from SharePoint into construction_qa_reviews + construction_qa_photos.

Usage:
  python3 scripts/ingest-sharepoint-qa.py --project Lawley --dry-run
  python3 scripts/ingest-sharepoint-qa.py --project Lawley
  python3 scripts/ingest-sharepoint-qa.py --project Lawley --folder-id 01XUF54KCFKQD3DV7WP5AL3FC4WRTHMGV6

Requires: psycopg2, requests
"""

import argparse
import hashlib
import json
import re
import sys
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import requests

# ── SharePoint Graph API config ──────────────────────────────────────────────

SP_TENANT_ID = "f22e6344-a35d-43b0-ad8c-a247f513c1ee"
SP_CLIENT_ID = "075bd672-bffa-45ba-9fd0-724535e612db"
SP_CLIENT_SECRET = "Ozw8Q~HG1PMZFPNb0Ze1f-eTYrtglVioRzy2lakF"
SP_DRIVE_ID = "b!54aBz82X_0qdf-Qc8hPv-PQzZQ4Q2eFGrzwQ6nSz79cVH1Quyz5vQavmQwdsBGRy"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# ── QA root folder + project subfolder IDs ───────────────────────────────────

QA_ROOT_ID = "01XUF54KAQP3D426U4VVA2ETUHYGBVJVHM"

# Project folders under Velocity_Quality_Assurance
PROJECT_FOLDERS = {
    "Lawley": {
        "project_db_id": "4eb13426-b2a1-472d-9b3c-277082ae9b55",
        "pole_prefix": "LAW.P.",
        "joint_prefix": "LAW.AGG.DM.",
        "folders": {
            # Poles Planted subfolders
            "poles_with_numbers": "01XUF54KG7KWED3UG7OJCJU2D56FVFVB2N",  # Lawley > Poles Planted
            # CPAC Civil Photos
            "cpac": "01XUF54KH2RS5MO7CL5NBLPZ4QH3ECQNE4",  # Lawley > CPAC
        },
        "sp_folder_id": "01XUF54KG7KWED3UG7OJCJU2D56FVFVB2N",
    },
    "Mohadin": {
        "project_db_id": None,  # Will be looked up
        "pole_prefix": "MOH.P.",
        "joint_prefix": "MOH.AGG.DM.",
        "folders": {},
        "sp_folder_id": "01XUF54KHAB25HZMV6QZH2P6IC4DVNUO3V",
    },
    "Mamelodi": {
        "project_db_id": None,
        "pole_prefix": "MAM.P.",
        "joint_prefix": "MAM.AGG.DM.",
        "folders": {},
        "sp_folder_id": "01XUF54KHNGT7BJOWTCRGKF4YU6XEHIQVZ",
    },
    "Etwatwa": {
        "project_db_id": None,
        "pole_prefix": "ETW.P.",
        "joint_prefix": "ETW.AGG.DM.",
        "folders": {},
        "sp_folder_id": "01XUF54KDR25PVMKXSHRFIIKG4SLAJ6WFP",
    },
    "Thembisa POP 1": {
        "project_db_id": "7d8b94d6-8e5a-4dbb-9ede-69ce3884e004",
        "pole_prefix": "TEM.P.",
        "joint_prefix": "TEM.AGG.DM.",
        "folders": {
            "pole_planting": "01XUF54KBLL6VWY2PRYZH3L2HSDEAYX2NH",
            "cpac_civils": "01XUF54KAE2BUB2JR4YNFLOS4LJ3NV56FF",
            "pop_civils": "01XUF54KFARNMGVRIQ3VGK3X5OJIBK4MQU",
        },
        "sp_folder_id": "01XUF54KDAUM2LVJJIZRCZSS6BFL7NUCVF",  # POP 1 root
    },
    "Thembisa POP 3": {
        "project_db_id": "1de088dd-fe24-43fb-b8d3-94fca61ef91d",
        "pole_prefix": "TEM.P.",
        "joint_prefix": "TEM.AGG.DM.",
        "folders": {
            "cpac_civils": "01XUF54KAF6EZ4SVIP2JGI3GEZFHFR42QH",
            "pop_civils": "01XUF54KA5KAE2SQUKZVDY4HT73LABBUOA",
        },
        "sp_folder_id": "01XUF54KFDHXSE3DSBCNCYMGDBVZ2H2XMC",  # POP 3 root
    },
}

# Regex to extract pole number from filenames like LAW.P.A013.JPG or LAW.P.A013_1.JPG
POLE_RE = re.compile(r"^([A-Z]{3}\.P\.[A-Z]\d{3,4})(?:_\d+)?\.(?:jpe?g|png)$", re.IGNORECASE)
# Broader pole pattern for files without standard naming
POLE_RE_BROAD = re.compile(r"([A-Z]{3}\.P\.[A-Z]\d{3,4})", re.IGNORECASE)

# Image extensions we care about
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


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
            # Recurse into subfolders (skip DR* folders and Historical folders)
            if name.startswith("DR") and name[2:].isdigit():
                continue  # Skip DR folders — handled by separate pipeline
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


def extract_pole_number(filename):
    """Extract pole number from a filename. Returns None if no match."""
    m = POLE_RE.match(filename)
    if m:
        return m.group(1).upper()
    # Try broader pattern
    m = POLE_RE_BROAD.search(filename)
    if m:
        return m.group(1).upper()
    return None


def extract_pole_from_path(path):
    """Extract pole number from parent folder name in the path.
    E.g. 'Poles Planted/Lawley Poles/Poles With Numbers/LAW.P.A001/Before 1.jpg'
    -> parent folder = 'LAW.P.A001' -> 'LAW.P.A001'
    """
    parts = path.rsplit("/", 1)
    if len(parts) < 2:
        return None
    parent = parts[0].rsplit("/", 1)[-1]
    m = POLE_RE_BROAD.search(parent)
    if m:
        return m.group(1).upper()
    return None


def classify_civil_step(filename):
    """Map a SharePoint photo filename to a civil checklist step number.
    Returns step number (1-7) or None if unclear.

    Civil steps:
      1 = Foundation/Base (Before, Depth, Compaction, Concrete)
      2 = Full Pole Visible (After)
      3 = Pole Label (Label, Tag, Number)
      4 = CCA H4 Tag (CCA, H4, Treatment)
      5 = Vertical Alignment (Vertical, Alignment, Plumb)
      6 = Guy Wires / Stays (Guy, Wire, Stay)
      7 = Slack Bracket (Slack, Bracket)
    """
    name = filename.lower().rsplit(".", 1)[0]  # strip extension

    # Step 1 — Foundation / Base
    if any(kw in name for kw in ("before", "depth", "compaction", "comapction", "compactiion", "commpaction",
                                  "beforre", "concrete", "foundation", "base", "hole", "backfill")):
        return 1

    # Step 2 — Full Pole Visible
    if any(kw in name for kw in ("after", "front", "side", "full pole", "installed", "erected", "complete")):
        return 2

    # Step 3 — Pole Label
    if any(kw in name for kw in ("label", "number", "tag number", "pole tag", "pole label")):
        return 3

    # Step 4 — CCA H4 Tag
    if any(kw in name for kw in ("cca", "h4", "treatment")):
        return 4

    # Step 5 — Vertical Alignment
    if any(kw in name for kw in ("vertical", "alignment", "plumb", "lean")):
        return 5

    # Step 6 — Guy Wires
    if any(kw in name for kw in ("guy", "wire", "stay")):
        return 6

    # Step 7 — Slack Bracket
    if any(kw in name for kw in ("slack", "bracket")):
        return 7

    return None


CIVIL_STEP_LABELS = {
    1: "Foundation / Base",
    2: "Full Pole Visible",
    3: "Pole Label",
    4: "CCA H4 Tag",
    5: "Vertical Alignment",
    6: "Guy Wires / Stays",
    7: "Slack Bracket",
}


def deterministic_uuid(namespace, key):
    """Generate a deterministic UUID from namespace + key for idempotent inserts."""
    return str(uuid.uuid5(uuid.UUID(namespace), key))


# Namespace UUID for our QA reviews
QA_NAMESPACE = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"


def run_ingestion(project_name, db_url, dry_run=False, folder_id=None):
    """Main ingestion pipeline."""
    config = PROJECT_FOLDERS.get(project_name)
    if not config:
        print(f"ERROR: Unknown project '{project_name}'. Known: {list(PROJECT_FOLDERS.keys())}")
        sys.exit(1)

    print(f"\n{'='*70}")
    print(f"  SharePoint → Construction QA Ingestion")
    print(f"  Project: {project_name}")
    print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"{'='*70}\n")

    # ── Step 1: Get Graph API token ──────────────────────────────────────
    print("  [1/5] Authenticating with MS Graph API...")
    token = get_token()
    print("    ✓ Token acquired\n")

    # ── Step 2: Connect to DB ────────────────────────────────────────────
    print("  [2/5] Connecting to database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Get project ID if not hardcoded
    project_id = config["project_db_id"]
    if not project_id:
        cur.execute("SELECT id FROM projects WHERE project_name = %s", (project_name,))
        row = cur.fetchone()
        if not row:
            print(f"    ERROR: Project '{project_name}' not found in DB")
            sys.exit(1)
        project_id = str(row["id"])

    # Load all poles for this project into a lookup dict
    cur.execute(
        "SELECT id, pole_number, zone_no, pon_no, latitude, longitude, pole_type, height "
        "FROM poles WHERE project_id = %s::uuid",
        (project_id,),
    )
    poles_by_number = {}
    for row in cur.fetchall():
        pn = row["pole_number"].upper() if row["pole_number"] else None
        if pn:
            poles_by_number[pn] = row
    print(f"    ✓ Loaded {len(poles_by_number)} poles for {project_name}\n")

    # Check existing reviews to avoid duplicates
    cur.execute(
        "SELECT feature_id FROM construction_qa_reviews WHERE project_id = %s::uuid AND discipline = 'civil'",
        (project_id,),
    )
    existing_reviews = {row["feature_id"] for row in cur.fetchall()}
    print(f"    ✓ {len(existing_reviews)} existing civil reviews (will skip)\n")

    # ── Step 3: Scan SharePoint folders ──────────────────────────────────
    print("  [3/5] Scanning SharePoint folders...")
    target_folder = folder_id or config["sp_folder_id"]

    # Scan Poles Planted subfolder specifically
    all_items = list_children(token, target_folder)
    pole_folder = None
    for item in all_items:
        if item["name"] == "Poles Planted" and "folder" in item:
            pole_folder = item["id"]
            break

    if not pole_folder:
        # Maybe the target IS the poles folder
        pole_folder = target_folder
        print(f"    Using target folder directly as scan root")

    photos = scan_folder_recursive(token, pole_folder, path="Poles Planted")
    print(f"    ✓ Found {len(photos)} image files\n")

    # ── Step 4: Match photos to poles ────────────────────────────────────
    print("  [4/5] Matching photos to poles...")
    matched = {}  # pole_number -> [photo, ...]
    add_to_existing = {}  # pole_number -> [photo, ...] for poles with existing reviews
    unmatched = []
    skipped_duplicate = 0

    # Reconnect to DB — SharePoint scan may have taken long enough to cause idle timeout
    try:
        cur.close()
        conn.close()
    except Exception:
        pass
    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Load existing photo storage_keys to avoid duplicate photo inserts
    cur.execute(
        "SELECT storage_key FROM construction_qa_photos WHERE project_id = %s::uuid",
        (project_id,),
    )
    existing_photo_keys = {row["storage_key"] for row in cur.fetchall()}
    print(f"    ✓ {len(existing_photo_keys)} existing photos in DB\n")

    for photo in photos:
        # Try filename first, then parent folder
        pole_num = extract_pole_number(photo["name"])
        if not pole_num:
            pole_num = extract_pole_from_path(photo["path"])

        if not pole_num:
            unmatched.append(photo)
            continue

        if pole_num not in poles_by_number:
            unmatched.append(photo)
            continue

        # Check if this specific photo already exists
        storage_key = f"sharepoint:{SP_DRIVE_ID}:{photo['id']}"
        if storage_key in existing_photo_keys:
            skipped_duplicate += 1
            continue

        if pole_num in existing_reviews:
            # Review exists but this is a NEW photo for it
            add_to_existing.setdefault(pole_num, []).append(photo)
        else:
            matched.setdefault(pole_num, []).append(photo)

    new_review_photos = sum(len(v) for v in matched.values())
    add_photos = sum(len(v) for v in add_to_existing.values())
    print(f"    ✓ New reviews: {len(matched)} poles ({new_review_photos} photos)")
    print(f"    ✓ Add to existing reviews: {len(add_to_existing)} poles ({add_photos} photos)")
    print(f"    ✗ Unmatched files: {len(unmatched)}")
    print(f"    ↻ Skipped (duplicate photos): {skipped_duplicate}\n")

    # Show sample new matches
    sample = list(matched.items())[:5]
    if sample:
        print("    Sample NEW review matches:")
        for pn, phs in sample:
            print(f"      {pn}: {len(phs)} photo(s) — {phs[0]['name']}")
        print()

    # Show sample add-to-existing
    sample2 = list(add_to_existing.items())[:5]
    if sample2:
        print("    Sample ADD to existing reviews:")
        for pn, phs in sample2:
            print(f"      {pn}: +{len(phs)} photo(s) — {[p['name'] for p in phs[:3]]}")
        print()

    # Show sample unmatched
    if unmatched:
        print(f"    Sample unmatched ({min(10, len(unmatched))} of {len(unmatched)}):")
        for photo in unmatched[:10]:
            pn = extract_pole_number(photo["name"])
            pfn = extract_pole_from_path(photo["path"])
            reason = f"pole {pn or pfn} not in DB" if (pn or pfn) else "no pole ref in filename or parent folder"
            print(f"      {photo['path'].rsplit('/',1)[-1]} (in {photo['path'].rsplit('/',2)[-2] if '/' in photo['path'] else 'root'}) — {reason}")
        print()

    # ── Step 5: Insert records ───────────────────────────────────────────
    if dry_run:
        print("  [5/5] DRY RUN — no records inserted\n")
    else:
        total_new_photos = new_review_photos + add_photos
        print(f"  [5/5] Inserting {len(matched)} new reviews + {total_new_photos} photos...")
        reviews_inserted = 0
        photos_inserted = 0
        reviews_updated = 0

        def insert_photos_for_review(review_id, pole_photos):
            """Insert photo records for a review. Returns count inserted."""
            count = 0
            for p in pole_photos:
                photo_id = deterministic_uuid(QA_NAMESPACE, f"{review_id}:photo:{p['id']}")
                step = classify_civil_step(p["name"])
                step_label = CIVIL_STEP_LABELS.get(step) if step else None
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
                        photo_id, review_id, project_id,
                        f"sharepoint:{SP_DRIVE_ID}:{p['id']}",
                        f"https://graph.microsoft.com/v1.0/drives/{SP_DRIVE_ID}/items/{p['id']}/content",
                        p["name"], p["size"], p.get("mime", "image/jpeg"),
                        p.get("modified"), step, step_label,
                    ))
                    count += 1
                except Exception as e:
                    print(f"    ERROR inserting photo {p['name']}: {e}")
            return count

        # ── Insert NEW reviews ───────────────────────────────────────────
        for pole_num, pole_photos in matched.items():
            pole = poles_by_number[pole_num]
            review_id = deterministic_uuid(QA_NAMESPACE, f"{project_id}:civil:{pole_num}")

            photos_json = [{
                "filename": p["name"], "storage_key": f"sharepoint:{SP_DRIVE_ID}:{p['id']}",
                "source": "sharepoint", "size": p["size"],
            } for p in pole_photos]

            try:
                cur.execute("""
                    INSERT INTO construction_qa_reviews (
                        id, project_id, discipline, feature_type, feature_id,
                        zone_no, pon_no, photo_count, photos_json, photo_sources,
                        last_photo_at, workflow_status, priority,
                        pole_latitude, pole_longitude, pole_material, pole_height_m,
                        first_submitted_at, last_submitted_at
                    ) VALUES (
                        %s::uuid, %s::uuid, 'civil', 'pole', %s,
                        %s, %s, %s, %s::jsonb, ARRAY['sharepoint'],
                        %s, 'pending', 'normal',
                        %s, %s, %s, %s,
                        now(), now()
                    )
                    ON CONFLICT DO NOTHING
                """, (
                    review_id, project_id, pole_num,
                    pole.get("zone_no"), pole.get("pon_no"),
                    len(pole_photos), json.dumps(photos_json),
                    pole_photos[0].get("modified"),
                    pole.get("latitude"), pole.get("longitude"),
                    pole.get("pole_type"), pole.get("height"),
                ))
                reviews_inserted += 1
            except Exception as e:
                print(f"    ERROR inserting review for {pole_num}: {e}")
                conn.rollback()
                continue

            photos_inserted += insert_photos_for_review(review_id, pole_photos)

            if reviews_inserted % 100 == 0:
                conn.commit()

        conn.commit()
        print(f"    ✓ Inserted {reviews_inserted} new reviews")
        print(f"    ✓ Inserted {photos_inserted} photos for new reviews")

        # ── Add photos to EXISTING reviews ───────────────────────────────
        if add_to_existing:
            print(f"\n    Adding photos to {len(add_to_existing)} existing reviews...")
            added_photos = 0

            for pole_num, new_photos in add_to_existing.items():
                review_id = deterministic_uuid(QA_NAMESPACE, f"{project_id}:civil:{pole_num}")
                added_photos += insert_photos_for_review(review_id, new_photos)

                # Update review photo_count and photos_json
                new_json_entries = [{
                    "filename": p["name"], "storage_key": f"sharepoint:{SP_DRIVE_ID}:{p['id']}",
                    "source": "sharepoint", "size": p["size"],
                } for p in new_photos]

                try:
                    cur.execute("""
                        UPDATE construction_qa_reviews
                        SET photo_count = photo_count + %s,
                            photos_json = photos_json || %s::jsonb,
                            updated_at = now()
                        WHERE id = %s::uuid
                    """, (len(new_photos), json.dumps(new_json_entries), review_id))
                    reviews_updated += 1
                except Exception as e:
                    print(f"    ERROR updating review for {pole_num}: {e}")

                if reviews_updated % 100 == 0:
                    conn.commit()

            conn.commit()
            photos_inserted += added_photos
            print(f"    ✓ Added {added_photos} photos to {reviews_updated} existing reviews\n")

    # ── Summary ──────────────────────────────────────────────────────────
    total_matched_poles = len(matched) + len(add_to_existing)
    total_matched_photos = sum(len(v) for v in matched.values()) + sum(len(v) for v in add_to_existing.values())
    print("=" * 70)
    print(f"  INGESTION {'(DRY RUN) ' if dry_run else ''}COMPLETE — {project_name}")
    print(f"  Poles in DB:         {len(poles_by_number)}")
    print(f"  Photos scanned:      {len(photos)}")
    print(f"  Poles matched:       {total_matched_poles} ({len(matched)} new + {len(add_to_existing)} existing)")
    print(f"  Photos matched:      {total_matched_photos}")
    print(f"  Unmatched files:     {len(unmatched)}")
    print(f"  Skipped duplicates:  {skipped_duplicate}")
    if not dry_run:
        print(f"  Reviews inserted:    {reviews_inserted}")
        print(f"  Reviews updated:     {reviews_updated}")
        print(f"  Photos inserted:     {photos_inserted}")
    print("=" * 70)

    cur.close()
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest SharePoint QA photos into Construction QA")
    parser.add_argument("--project", required=True, help="Project name (Lawley, Mohadin, etc.)")
    parser.add_argument("--dry-run", action="store_true", help="Scan and match only, don't insert")
    parser.add_argument("--folder-id", help="Override SharePoint folder ID to scan")
    parser.add_argument("--db-url", help="Database URL (defaults to DATABASE_URL env var)")
    args = parser.parse_args()

    import os
    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: No database URL. Set DATABASE_URL or use --db-url")
        sys.exit(1)

    if args.project.lower() == "all":
        for proj_name in PROJECT_FOLDERS:
            try:
                run_ingestion(proj_name, db_url, dry_run=args.dry_run, folder_id=args.folder_id)
            except Exception as e:
                print(f"\n  ERROR running {proj_name}: {e}\n")
    else:
        run_ingestion(args.project, db_url, dry_run=args.dry_run, folder_id=args.folder_id)
