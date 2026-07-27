#!/usr/bin/env python3
"""
Works-QA ⇄ QField coverage check — the "never silently miss" guarantee.

Flags three ways QField photos fail to reach the Works-QA dashboard, for projects
linked to an active (non-archived) FibreFlow project:

  EXTRACT-GAP  photos in QFieldCloud, ZERO rows in qfield_photo_validations —
               the project was never registered in extract-gpkg-photos.py PROJECTS.
  SYNC-GAP     rows extracted, ZERO rows in pole_qa_photos — works-qa-sync is stuck.
  STALE-GPKG   extraction WORKED but stopped advancing while photos kept arriving.

The first closes the gap that left Mahikeng's 543 photos invisible for a day: the
ingestion is deliberately a registered-projects allow-list (safe, deterministic pole
labels), and this check makes a missing registration LOUD instead of silent.

STALE-GPKG closes the sequel. On 2026-07-27 Mahikeng was missing 918 photos — 571
ingested against 1 458 in the field — because the crew renamed the GPKG
("Civil audit.gpkg" → "Civil audit updated_27_07.gpkg") and PROJECTS still pinned the
dead file. Both zero-checks passed happily: 597 rows had been extracted and synced,
just none since 22 July. A count of >0 is not evidence of a working ingest, so this
compares the last successful GPKG sync against the newest photo upstream and flags
any project whose ingest has fallen behind. That is cause-agnostic on purpose —
renamed GPKG, deleted GPKG, failed download, renamed layer all present identically.

Sources of truth:
  * QFieldCloud DB (docker exec qfieldcloud-db-1) — DCIM photo counts + newest upload.
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

import psycopg2
import psycopg2.extras

# Pure staleness arithmetic (no DB deps) — unit-tested/CI-gated by
# scripts/test_qfield_gpkg_resolution.py.
from qfield_gpkg_resolution import gpkg_sync_lag_days

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


def qfc_latest_dcim_upload():
    """{qfield_project_uuid(str): newest DCIM upload timestamp(str)} from QFieldCloud.

    Joins filestorage_fileversion because filestorage_file has no per-upload time —
    a re-uploaded photo gets a new version row, and it is version time that says
    'the crew is still working here'.
    """
    sql = (
        "SELECT p.id::text, MAX(fv.created_at) "
        "FROM core_project p "
        "JOIN filestorage_file f ON f.project_id = p.id "
        "JOIN filestorage_fileversion fv ON fv.file_id = f.id "
        "WHERE f.name LIKE 'DCIM/%' GROUP BY p.id"
    )
    out = subprocess.run(
        ["docker", "exec", QFC_CONTAINER, "psql", "-U", QFC_DB_USER, "-d", QFC_DB_NAME,
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        print(f"WARN: could not read newest DCIM uploads: {out.stderr.strip()[:200]}", file=sys.stderr)
        return {}
    latest = {}
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line or "\t" not in line:
            continue
        uid, ts = line.split("\t", 1)
        if ts.strip():
            latest[uid.strip()] = ts.strip()
    return latest


def last_gpkg_sync(conn):
    """{qfield_project_uuid(str): last successful GPKG scan(datetime)}.

    MAX across gpkg_path rows: a project can have several registered GPKGs (civil +
    optical), and one of them still advancing means the pipeline is alive for that
    project. Taking MIN would flag every project whose optical audit finished months
    ago; MAX only stays behind when NOTHING is advancing.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT qf_project_id::text AS qf_uuid, MAX(last_synced_at) AS last_synced
            FROM qfield_gpkg_sync_state
            GROUP BY qf_project_id
        """)
        return {r["qf_uuid"]: r["last_synced"] for r in cur.fetchall()}


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
                    help="Flag a project whose GPKG ingest is this many days behind its "
                         "newest upstream photo (default 3). The ingest cron runs 4x/day, so "
                         "anything past ~1 day is already abnormal; 3 absorbs a long weekend "
                         "of crew inactivity without alerting.")
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

    newest_upstream = qfc_latest_dcim_upload()

    conn = psycopg2.connect(db_url)
    try:
        rows = linked_active_qfield_projects(conn)
        stuck = stuck_sync_projects(conn, args.threshold)
        synced_at = last_gpkg_sync(conn)
    finally:
        conn.close()

    # Extract gap: upstream photos in QFieldCloud but nothing in qfield_photo_validations.
    extract_gap = []
    for r in rows:
        src = dcim.get(r["qf_uuid"], 0)
        if src >= args.threshold and int(r["ingested"]) == 0:
            extract_gap.append((r["ff_name"], r["qf_name"], src))
    extract_gap.sort(key=lambda x: x[2], reverse=True)

    # Stale gap: extraction worked once but stopped advancing while photos kept arriving.
    # Only projects with a sync-state row qualify — a project with none is either
    # unregistered (already an EXTRACT-GAP) or has never run, and double-reporting it
    # here would just be noise.
    stale_gap = []
    for r in rows:
        qf_uuid = r["qf_uuid"]
        if int(r["ingested"]) == 0 or qf_uuid not in synced_at:
            continue
        lag = gpkg_sync_lag_days(synced_at[qf_uuid], newest_upstream.get(qf_uuid))
        if lag is not None and lag > args.stale_days:
            stale_gap.append((r["ff_name"], r["qf_name"], lag, int(r["ingested"])))
    stale_gap.sort(key=lambda x: x[2], reverse=True)

    print(f"Coverage check: {len(rows)} linked/active QField project(s) examined, "
          f"threshold={args.threshold}, stale-days={args.stale_days}. "
          f"extract-gap={len(extract_gap)}, sync-gap={len(stuck)}, stale-gpkg={len(stale_gap)}.")
    for ff_name, qf_name, src in extract_gap:
        print(f"  EXTRACT-GAP: {ff_name} ← {qf_name}: {src} photos upstream, 0 extracted")
    for ff_name, ingested in stuck:
        print(f"  SYNC-GAP: {ff_name}: {ingested} photos extracted, 0 on the dashboard (pole_qa_photos empty)")
    for ff_name, qf_name, lag, ingested in stale_gap:
        print(f"  STALE-GPKG: {ff_name} ← {qf_name}: last GPKG sync is {lag:.1f}d behind the "
              f"newest field photo ({ingested} extracted so far)")

    if (extract_gap or stuck or stale_gap) and not args.no_wa:
        lines = ["⚠️ Works-QA: QField photos not reaching the dashboard", ""]
        for ff_name, qf_name, src in extract_gap:
            lines.append(f"• {ff_name} ({qf_name}): {src} photos upstream, not extracted — register in extract-gpkg-photos.py")
        for ff_name, ingested in stuck:
            lines.append(f"• {ff_name}: {ingested} photos extracted but sync produced 0 pole rows — check works-qa-sync")
        for ff_name, qf_name, lag, _ingested in stale_gap:
            lines.append(f"• {ff_name} ({qf_name}): GPKG ingest {lag:.1f} days behind the newest "
                         f"field photo — GPKG renamed/deleted? check extract-gpkg-photos.py PROJECTS")
        post_wa("\n".join(lines))

    # Exit 0 always — this is a monitor, not a gate; the cron continues.
    return 0


if __name__ == "__main__":
    sys.exit(main())
