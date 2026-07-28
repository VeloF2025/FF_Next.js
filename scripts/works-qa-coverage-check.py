#!/usr/bin/env python3
"""
Works-QA ⇄ QField coverage check — the "never silently miss" guarantee.

Flags three ways QField photos fail to reach the Works-QA dashboard, for projects
linked to an active (non-archived) FibreFlow project:

  EXTRACT-GAP  photos in QFieldCloud, ZERO rows in qfield_photo_validations —
               the project was never registered in extract-gpkg-photos.py PROJECTS.
  SYNC-GAP     rows extracted, ZERO rows in pole_qa_photos — works-qa-sync is stuck.
  STALE-GPKG   MinIO holds a NEWER version of a tracked GPKG that we are not reading.

The first closes the gap that left Mahikeng's 543 photos invisible for a day: the
ingestion is deliberately a registered-projects allow-list (safe, deterministic pole
labels), and this check makes a missing registration LOUD instead of silent.

STALE-GPKG closes the sequel. On 2026-07-27 Mahikeng was missing 918 photos — 571
ingested against 1 458 in the field — because the crew renamed the GPKG
("Civil audit.gpkg" → "Civil audit updated_27_07.gpkg") and PROJECTS still pinned the
dead file. Both zero-checks passed happily: 597 rows had been extracted and synced,
just none since 22 July. A count of >0 is not evidence of a working ingest, so this
asks whether MinIO holds a NEWER version of a tracked GPKG than the one we ingested,
and flags it once that newer file has gone unread for --stale-days. Cause-agnostic on
purpose (renamed, deleted, failed download, renamed layer all present identically) —
and, critically, a dormant form can never trip it, because "nothing newer exists" is
not the same as "we are behind".

Sources of truth:
  * QFieldCloud DB (docker exec qfieldcloud-db-1) — DCIM photo counts.
  * MinIO (docker exec qfieldcloud-minio-1) — newest version of each tracked GPKG.
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
from qfield_gpkg_resolution import select_stale_gpkgs

MINIO_BUCKET = "qfieldcloud-prod"

QFC_CONTAINER = "qfieldcloud-db-1"
QFC_DB_USER = "qfieldcloud_db_admin"
QFC_DB_NAME = "qfieldcloud_db"

WA_BRIDGE_URL = "http://72.61.197.178:8083/send-message"
WA_VELO_TEST_GROUP = "120363421664266245@g.us"


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
    """{(qf_uuid, gpkg_path): newest version id} — one `mc ls` per tracked GPKG.

    This is the denominator that makes the staleness check like-for-like: the newest
    version OF THE SAME FILE, not the newest photo somewhere in the project. ~16 calls
    per run. A path that fails to list is simply absent from the result, which
    select_stale_gpkgs treats as "cannot compute" and skips.
    """
    out = {}
    for row in sync_rows:
        prefix = f"local/{MINIO_BUCKET}/projects/{row['qf_uuid']}/files/{row['gpkg_path']}/"
        try:
            res = subprocess.run(
                ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", prefix],
                capture_output=True, text=True, timeout=30,
            )
            if res.returncode != 0:
                continue
            versions = []
            for line in res.stdout.strip().split("\n"):
                idx = line.find(" STANDARD ")
                if idx != -1:
                    v = line[idx + len(" STANDARD "):].strip().rstrip("/")
                    if v:
                        versions.append(v)
            if versions:
                out[(row["qf_uuid"], row["gpkg_path"])] = sorted(versions)[-1]
        except Exception as e:  # noqa: BLE001 — a listing failure must not fail the monitor
            print(f"  WARN: mc ls failed for {row['gpkg_path']}: {e}", file=sys.stderr)
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

    # Extract gap: upstream photos in QFieldCloud but nothing in qfield_photo_validations.
    extract_gap = []
    for r in rows:
        src = dcim.get(r["qf_uuid"], 0)
        if src >= args.threshold and int(r["ingested"]) == 0:
            extract_gap.append((r["ff_name"], r["qf_name"], src))
    extract_gap.sort(key=lambda x: x[2], reverse=True)

    # Stale gap: a registered GPKG stopped advancing while photos kept arriving.
    # Reported per FILE, and measured against the GPKG's own version rather than the
    # last script run — see select_stale_gpkgs / gpkg_version_lag_days for why both
    # of those matter (the earlier per-project last_synced_at form found 1 of 16).
    stale_gap = [
        (qf_name_by_uuid.get(qf_uuid, qf_uuid), path, behind, available)
        for qf_uuid, path, behind, available in select_stale_gpkgs(
            sync_rows, minio_newest, datetime.now(timezone.utc), args.stale_days)
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
        print(f"  STALE-GPKG: {qf_name} / {path}: MinIO has {available}, unread for "
              f"{behind:.1f}d")

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
