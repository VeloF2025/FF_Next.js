#!/usr/bin/env python3
"""
Works-QA ⇄ QField coverage check — the "never silently miss" guarantee.

Flags QField projects that have field photos in QFieldCloud but ZERO rows in
FibreFlow's qfield_photo_validations, and are linked to an active (non-archived)
FibreFlow project. These are projects whose photos will never reach the Works-QA
dashboard until they're registered in extract-gpkg-photos.py's PROJECTS dict.

This closes the gap that left Mahikeng's 543 photos invisible for a day: the
ingestion is deliberately a registered-projects allow-list (safe, deterministic
pole labels), and this check makes a missing registration LOUD instead of silent.

Sources of truth:
  * QFieldCloud DB (docker exec qfieldcloud-db-1) — DCIM photo counts per project.
  * FibreFlow DB (DATABASE_URL) — links + qfield_photo_validations counts.

A single WhatsApp summary is posted (Velo Test group) when anything is flagged.
Run on velo (needs docker + DATABASE_URL). Read-only; writes nothing.

Usage:
  DATABASE_URL=… python3 scripts/works-qa-coverage-check.py [--threshold 20] [--no-wa]
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request

import psycopg2
import psycopg2.extras

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


def linked_active_qfield_projects(conn):
    """Rows for QField projects linked to an active (non-archived) FF project,
    with their FF project name and ingested (qfield_photo_validations) count."""
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
            WHERE p.status <> 'archived'
        """)
        return cur.fetchall()


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
    ap.add_argument("--no-wa", action="store_true", help="Log only; do not post to WhatsApp")
    args = ap.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    dcim = qfc_dcim_counts()
    conn = psycopg2.connect(db_url)
    try:
        rows = linked_active_qfield_projects(conn)
    finally:
        conn.close()

    flagged = []
    for r in rows:
        src = dcim.get(r["qf_uuid"], 0)
        if src >= args.threshold and int(r["ingested"]) == 0:
            flagged.append((r["ff_name"], r["qf_name"], r["qf_uuid"], src))

    flagged.sort(key=lambda x: x[3], reverse=True)

    print(f"Coverage check: {len(rows)} linked/active QField project(s) examined, "
          f"threshold={args.threshold}, {len(flagged)} flagged.")
    for ff_name, qf_name, qf_uuid, src in flagged:
        print(f"  FLAG: {ff_name} ← {qf_name} ({qf_uuid}): {src} photos upstream, 0 ingested")

    if flagged and not args.no_wa:
        lines = ["⚠️ Works-QA: QField photos not reaching FibreFlow", ""]
        for ff_name, qf_name, _uuid, src in flagged:
            lines.append(f"• {ff_name} ({qf_name}): {src} photos upstream, 0 ingested")
        lines.append("")
        lines.append("Register in extract-gpkg-photos.py PROJECTS to ingest.")
        post_wa("\n".join(lines))

    # Exit 0 always — this is a monitor, not a gate; the cron continues.
    return 0


if __name__ == "__main__":
    sys.exit(main())
