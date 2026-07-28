#!/usr/bin/env python3
"""
Works-QA ⇄ QField coverage check — the "never silently miss" guarantee.

Flags three ways QField photos fail to reach the Works-QA dashboard, for projects
linked to an active (non-archived) FibreFlow project:

  EXTRACT-GAP  photos in QFieldCloud, ZERO rows in qfield_photo_validations —
               the project was never registered in extract-gpkg-photos.py PROJECTS.
  SYNC-GAP     rows extracted, ZERO rows in pole_qa_photos — works-qa-sync is stuck.
  STALE-GPKG   a newer file exists that we are not ingesting — either a newer
               version of the tracked GPKG, or a newer same-family sibling (a rename).

The first closes the gap that left Mahikeng's 543 photos invisible for a day: the
ingestion is deliberately a registered-projects allow-list (safe, deterministic pole
labels), and this check makes a missing registration LOUD instead of silent.

STALE-GPKG closes the sequel. On 2026-07-27 Mahikeng was missing 918 photos — 571
ingested against 1 458 in the field — because the crew renamed the GPKG
("Civil audit.gpkg" → "Civil audit updated_27_07.gpkg") and PROJECTS still pinned the
dead file. Both zero-checks passed happily: 597 rows had been extracted and synced,
just none since 22 July. A count of >0 is not evidence of a working ingest, so this
asks whether a newer file exists that we are not reading — either a newer version of
the tracked path, or a newer same-family SIBLING (which is how a rename presents: the
tracked path stops changing and looks perfectly dormant). Flagged once that file has
gone unread for --stale-days. A dormant form can never trip it, because "nothing newer
exists" is not the same as "we are behind".

Not covered: a GPKG deleted outright from MinIO. gpkg_behind_days fails quiet on a
missing listing so a transient mc failure cannot page, which means a genuine deletion
reads the same as a blip.

Sources of truth:
  * QFieldCloud DB (docker exec qfieldcloud-db-1) — DCIM photo counts.
  * MinIO (docker exec qfieldcloud-minio-1) — newest version of each tracked GPKG
    and of its same-family siblings.
  * FibreFlow DB (DATABASE_URL) — links, qfield_photo_validations, qfield_gpkg_sync_state.

A single WhatsApp summary is posted (Velo Test group) when anything is flagged.
Run on velo (needs docker + DATABASE_URL). Read-only; writes nothing.

Usage:
  DATABASE_URL=… python3 scripts/works-qa-coverage-check.py \
      [--threshold 20] [--stale-days 3] [--no-wa]
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

# Pure staleness arithmetic (no DB deps) — unit-tested/CI-gated by
# scripts/test_qfield_gpkg_resolution.py.
from qfield_gpkg_resolution import is_family_member, parse_mc_gpkg_names
from qfield_staleness import select_stale_gpkgs

MINIO_BUCKET = "qfieldcloud-prod"

QFC_CONTAINER = "qfieldcloud-db-1"
QFC_DB_USER = "qfieldcloud_db_admin"
QFC_DB_NAME = "qfieldcloud_db"

WA_BRIDGE_URL = "http://72.61.197.178:8083/send-message"
WA_VELO_TEST_GROUP = "120363421664266245@g.us"


def _mc_ls(prefix, timeout=30):
    """`mc ls <prefix>` stdout, or None if the listing failed."""
    try:
        res = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", prefix],
            capture_output=True, text=True, timeout=timeout,
        )
        return res.stdout if res.returncode == 0 else None
    except Exception as e:  # noqa: BLE001 — a listing failure must not fail the monitor
        print(f"  WARN: mc ls failed for {prefix}: {e}", file=sys.stderr)
        return None


def _newest_version(prefix):
    """Newest version id under a versioned-file prefix, or None."""
    out = _mc_ls(prefix)
    if out is None:
        return None
    versions = []
    for line in out.strip().split("\n"):
        idx = line.find(" STANDARD ")
        if idx != -1:
            v = line[idx + len(" STANDARD "):].strip().rstrip("/")
            if v:
                versions.append(v)
    return sorted(versions)[-1] if versions else None


def qfc_dcim_counts():
    """{qfield_project_uuid(str): dcim_photo_count(int)} from QFieldCloud."""
    sql = (
        "SELECT p.id::text, COUNT(f.id) "
        "FROM core_project p JOIN filestorage_file f ON f.project_id = p.id "
        "WHERE f.name LIKE 'DCIM/%' GROUP BY p.id"
    )
    out = subprocess.run(
        ["docker", "exec", QFC_CONTAINER, "psql", "-U", QFC_DB_USER, "-d", QFC_DB_NAME,
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        print(f"ERROR reading QFieldCloud DB: {out.stderr.strip()}", file=sys.stderr)
        sys.exit(2)
    counts = {}
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line or "\t" not in line:
            continue
        uid, n = line.split("\t", 1)
        counts[uid.strip()] = int(n.strip())
    return counts


def minio_newest_versions(sync_rows):
    """{(qf_uuid, gpkg_path): newest version id} for each tracked GPKG's OWN path.

    The denominator that makes staleness like-for-like: the newest version of the same
    file, not the newest photo somewhere in the project. A path that fails to list is
    absent from the result, which select_stale_gpkgs treats as "cannot compute".
    """
    out = {}
    for row in sync_rows:
        newest = _newest_version(
            f"local/{MINIO_BUCKET}/projects/{row['qf_uuid']}/files/{row['gpkg_path']}/")
        if newest:
            out[(row["qf_uuid"], row["gpkg_path"])] = newest
    return out


def minio_sibling_newest(sync_rows):
    """{(qf_uuid, gpkg_path): (sibling_name, version)} — newest same-family sibling.

    Catches a RENAME, where the new work lives at a different path and the tracked one
    just sits there looking dormant. Uses the LOOSE family rule (no version-marker
    requirement), because the resolver deliberately declines non-numeric renames like
    "Civil audit new.gpkg" — this is the only thing that would ever report one.

    Lists each project's files/ directory once, then version-lists only the siblings.
    """
    out = {}
    dir_cache = {}
    for row in sync_rows:
        qf, path = row["qf_uuid"], row["gpkg_path"]
        if qf not in dir_cache:
            listing = _mc_ls(f"local/{MINIO_BUCKET}/projects/{qf}/files/")
            dir_cache[qf] = parse_mc_gpkg_names(listing) if listing else []
        best = None
        for name in dir_cache[qf]:
            if name == path or not is_family_member(path, name, require_version_marker=False):
                continue
            v = _newest_version(f"local/{MINIO_BUCKET}/projects/{qf}/files/{name}/")
            if v and (best is None or v > best[1]):
                best = (name, v)
        if best:
            out[(qf, path)] = best
    return out


def gpkg_sync_rows(conn):
    """One row PER REGISTERED GPKG: {qf_uuid, gpkg_path, last_version}.

    Deliberately NOT aggregated. An earlier version took MAX(last_synced_at) per
    project and reported a single figure; measured against production that hid three
    live multi-day freezes behind an actively-syncing sibling, because 8 of 9 projects
    register two or more GPKGs. It also used last_synced_at, which the pending-rescan
    path refreshes for an unchanged file — see select_stale_gpkgs.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT qf_project_id::text AS qf_uuid, gpkg_path, last_version
            FROM qfield_gpkg_sync_state
        """)
        return [dict(r) for r in cur.fetchall()]


def linked_active_qfield_projects(conn):
    """Rows for QField projects linked to an active (non-archived) FF project,
    with their FF project name and ingested (qfield_photo_validations) count.
    IS DISTINCT FROM (not <>) so a NULL-status project is still included."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT qp.qfield_project_id AS qf_uuid,
                   qp.name              AS qf_name,
                   p.project_name       AS ff_name,
                   (SELECT COUNT(*) FROM qfield_photo_validations q
                     WHERE q.project_id::text = qp.qfield_project_id) AS ingested
            FROM qfield_projects qp
            JOIN qfield_project_links l ON l.qfield_project_id = qp.id
            JOIN projects p ON p.id = l.fibreflow_project_id
            WHERE p.status IS DISTINCT FROM 'archived'
        """)
        return cur.fetchall()


def stuck_sync_projects(conn, threshold):
    """Active FF projects whose photos were EXTRACTED (qfield_photo_validations) but
    never SYNCED (pole_qa_photos is empty) — so they still don't reach the dashboard.

    Extract success ≠ dashboard visibility: aliased QField projects only appear once
    works-qa-sync populates pole_qa_photos. Checking only qfield_photo_validations
    (linked_active_qfield_projects) would miss a stuck/half-run sync, so we check the
    sync output here. Returns [(ff_name, ingested, threshold_used)]."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT p.project_name AS ff_name,
                   (SELECT COUNT(*) FROM qfield_photo_validations q
                      JOIN qfield_projects qp ON qp.qfield_project_id = q.project_id::text
                      JOIN qfield_project_links l ON l.qfield_project_id = qp.id
                     WHERE l.fibreflow_project_id = p.id
                       AND q.feature_type IN ('pole', 'joint')) AS ingested,
                   (SELECT COUNT(*) FROM pole_qa_photos pq WHERE pq.project_id = p.id) AS synced
            FROM projects p
            WHERE p.status IS DISTINCT FROM 'archived'
              AND EXISTS (SELECT 1 FROM qfield_project_links l WHERE l.fibreflow_project_id = p.id)
        """)
        out = []
        for r in cur.fetchall():
            if int(r["ingested"]) >= threshold and int(r["synced"]) == 0:
                out.append((r["ff_name"], int(r["ingested"])))
        out.sort(key=lambda x: x[1], reverse=True)
        return out


def post_wa(message):
    payload = json.dumps({"group_jid": WA_VELO_TEST_GROUP, "message": message}).encode()
    req = urllib.request.Request(WA_BRIDGE_URL, data=payload,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            print(f"  WA posted: HTTP {resp.status}")
    except Exception as e:  # noqa: BLE001 — best-effort alert, never fail the cron on WA
        print(f"  WARN: WA post failed: {e}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=int, default=20,
                    help="Min QFieldCloud DCIM photos before flagging a 0-ingested project (default 20)")
    ap.add_argument("--stale-days", type=float, default=3.0,
                    help="Flag a GPKG when MinIO has held a newer version this many days "
                         "without it being ingested (default 3). A dormant form never trips "
                         "this, however old it is — only an unread newer file does. The margin "
                         "absorbs the 4x/day cron plus a weekend.")
    ap.add_argument("--no-wa", action="store_true", help="Log only; do not post to WhatsApp")
    args = ap.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    dcim = qfc_dcim_counts()
    # Self-check the source-of-truth query: if the `DCIM/%` filter ever stops matching
    # (schema/path change in QFieldCloud), it returns nothing and the extract-gap check
    # below would silently report all-clear forever. Fail loud instead.
    if not dcim:
        print("WARN: QFieldCloud returned 0 projects with DCIM photos — the "
              "`filestorage_file.name LIKE 'DCIM/%'` assumption may be broken; "
              "the extract-gap check cannot function.", file=sys.stderr)

    conn = psycopg2.connect(db_url)
    try:
        rows = linked_active_qfield_projects(conn)
        stuck = stuck_sync_projects(conn, args.threshold)
        sync_rows = gpkg_sync_rows(conn)
    finally:
        conn.close()

    qf_name_by_uuid = {r["qf_uuid"]: r["qf_name"] for r in rows}
    minio_newest = minio_newest_versions(sync_rows)
    sibling_newest = minio_sibling_newest(sync_rows)

    # Extract gap: upstream photos in QFieldCloud but nothing in qfield_photo_validations.
    extract_gap = []
    for r in rows:
        src = dcim.get(r["qf_uuid"], 0)
        if src >= args.threshold and int(r["ingested"]) == 0:
            extract_gap.append((r["ff_name"], r["qf_name"], src))
    extract_gap.sort(key=lambda x: x[2], reverse=True)

    # Stale gap: a newer file exists that we are not ingesting — either a newer version
    # of the tracked path, or a newer same-family sibling (a rename). Reported PER FILE;
    # see select_stale_gpkgs for why per-project aggregation and photo-based lag both
    # failed on live data.
    stale_gap = [
        (qf_name_by_uuid.get(qf_uuid, qf_uuid), path, behind, available)
        for qf_uuid, path, behind, available in select_stale_gpkgs(
            sync_rows, minio_newest, sibling_newest, datetime.now(timezone.utc), args.stale_days)
    ]

    print(f"Coverage check: {len(rows)} linked/active QField project(s) examined, "
          f"{len(sync_rows)} registered GPKG(s) tracked, threshold={args.threshold}, "
          f"stale-days={args.stale_days}. extract-gap={len(extract_gap)}, "
          f"sync-gap={len(stuck)}, stale-gpkg={len(stale_gap)}.")
    for ff_name, qf_name, src in extract_gap:
        print(f"  EXTRACT-GAP: {ff_name} ← {qf_name}: {src} photos upstream, 0 extracted")
    for ff_name, ingested in stuck:
        print(f"  SYNC-GAP: {ff_name}: {ingested} photos extracted, 0 on the dashboard (pole_qa_photos empty)")
    for qf_name, path, behind, available in stale_gap:
        print(f"  STALE-GPKG: {qf_name} / {path}: newer file available ({available}), "
              f"unread for {behind:.1f}d")

    if (extract_gap or stuck or stale_gap) and not args.no_wa:
        lines = ["⚠️ Works-QA: QField photos not reaching the dashboard", ""]
        for ff_name, qf_name, src in extract_gap:
            lines.append(f"• {ff_name} ({qf_name}): {src} photos upstream, not extracted — register in extract-gpkg-photos.py")
        for ff_name, ingested in stuck:
            lines.append(f"• {ff_name}: {ingested} photos extracted but sync produced 0 pole rows — check works-qa-sync")
        for qf_name, path, behind, _available in stale_gap:
            lines.append(f"• {qf_name} / {path}: a newer version has been in MinIO for "
                         f"{behind:.1f} days and is not being ingested — check extract-gpkg-photos.py")
        post_wa("\n".join(lines))

    # Exit 0 always — this is a monitor, not a gate; the cron continues.
    return 0


if __name__ == "__main__":
    sys.exit(main())
