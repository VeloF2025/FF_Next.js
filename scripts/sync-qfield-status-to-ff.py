#!/usr/bin/env python3
"""
Inbound mirror of sync-qa-to-qfield.py: read the QField civil-audit pole "Status"
from each project's GPKG and upsert it onto poles.field_status, so the Works QA
PON overview can show the field-planted stage between "planned" (sow_poles) and
"QA'd" (pole_qa_photos).

Read-only against QFieldCloud — it only downloads the GPKG via `mc` (no upload,
no SDK login). Idempotent: only rows whose field_status actually changes are
written (field_status_synced_at is bumped only on a real change).

Usage:
  python3 scripts/sync-qfield-status-to-ff.py [--project Mohadin] [--dry-run]

DATABASE_URL must come from the environment (Supabase). Never hard-code it.
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from collections import Counter

import psycopg2
from psycopg2.extras import execute_values

DB_URL = os.environ.get("DATABASE_URL", "")
MINIO_BUCKET = "qfieldcloud-prod"

# Civil-audit pole GPKG coordinates per project. `qf` = QFieldCloud project id
# (the live FT_<site> project the field crews edit, NOT the older *_Pole_Audit
# copies, which are stale); `ff` = FibreFlow projects.id; `gpkg`/`table`/`label`/
# `status` = the poles layer's file, table, pole-label column, and civil-audit
# Status column. These differ per project (e.g. Thembisa's label column is
# `label_1`, its table is lower-case), so each was confirmed against the live GPKG
# + a join cross-check vs poles.pole_number before being added — do NOT assume a
# new project follows Mohadin's shape.
#
# NOTE on Status vocab: removal is spelled "Pole Removed/Canceled" in some GPKGs
# and "Pole Canceled / Removed" in others, and Thembisa POP1 carries a pre-plant
# "To be Planted". field_status mirrors the raw GPKG string; the planted/removed
# classification (the deny-list) lives in pages/api/works-qa/poles.ts.
PROJECTS = {
    "Mohadin": {"qf": "bec5f353-2e83-4f6b-989a-fca83ad94e16",
                "ff": "bf9a90db-e758-4c05-b999-694cd63c451f",
                "gpkg": "MOAPoles.gpkg", "table": "MOAPoles", "label": "label", "status": "Status"},
    "Etwatwa": {"qf": "47585401-1b25-4d3b-8d18-4337ea26df88",
                "ff": "c7255076-1d2f-41ce-97bb-858b8c87ee27",
                "gpkg": "PolesAudit.gpkg", "table": "PolesAudit", "label": "label", "status": "Status"},
    "Lawley": {"qf": "2e988631-462b-448f-ae15-bb693a68cd55",
               "ff": "4eb13426-b2a1-472d-9b3c-277082ae9b55",
               "gpkg": "LAWPoles.gpkg", "table": "LAWPoles", "label": "label", "status": "Status"},
    "Mamelodi": {"qf": "2ce80264-170c-4f05-ada1-68220d7e5885",
                 "ff": "7003dc06-9af7-4a7c-bc6c-a177d77784f2",
                 "gpkg": "MAMPoles.gpkg", "table": "MAMPoles", "label": "label", "status": "Status"},
    "Thembisa POP1": {"qf": "63341eb4-bc81-4607-a3d6-580ea2a7457c",
                      "ff": "7d8b94d6-8e5a-4dbb-9ede-69ce3884e004",
                      "gpkg": "Poles.gpkg", "table": "Poles", "label": "label_1", "status": "Status"},
    "Thembisa POP3": {"qf": "5f3b962a-7901-43f7-a284-1c1a9ed7f3d1",
                      "ff": "1de088dd-fe24-43fb-b8d3-94fca61ef91d",
                      "gpkg": "THM_3_Poles.gpkg", "table": "thm_3_poles", "label": "label_1", "status": "Status"},
}


def minio_download(qf_project_id: str, gpkg_path: str, dest: str) -> bool:
    """Download the latest GPKG version from MinIO (shell=False; latest chosen by
    lastModified from `mc ls --json`)."""
    base = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{gpkg_path}/"
    ls = subprocess.run(
        ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", "--json", base],
        capture_output=True, text=True,
    )
    if ls.returncode != 0:
        print(f"  ERROR listing GPKG versions: {ls.stderr.strip()}")
        return False
    versions = []
    for line in ls.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("key") and obj.get("lastModified"):
            versions.append(obj)
    if not versions:
        print(f"  ERROR: No versions found for {gpkg_path}")
        return False
    latest = max(versions, key=lambda o: o["lastModified"])["key"]
    # Sanity-guard the version key (QFieldCloud versions look like v<ts>-<hash>).
    # Not a security control (shell=False, trusted MinIO), just fail loud on a
    # malformed key rather than feed garbage to `mc cat`.
    if not latest.startswith("v") or any(c.isspace() for c in latest):
        print(f"  ERROR: unexpected version key {latest!r}")
        return False
    print(f"  Latest version: {latest}")
    with open(dest, "wb") as f:
        cat = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "cat", base + latest],
            stdout=f, stderr=subprocess.PIPE,
        )
    if cat.returncode != 0:
        print(f"  ERROR downloading: {cat.stderr.decode().strip()}")
        return False
    return os.path.getsize(dest) > 1000


def sync_project(name: str, cfg: dict, dry_run: bool = False) -> bool:
    """Pull civil-audit Status from one project's GPKG into poles.field_status.
    Returns True on success, False on a download failure."""
    print(f"\n{'='*60}\nField-status sync: {name}\n{'='*60}")

    fd, tmp = tempfile.mkstemp(suffix=".gpkg")
    os.close(fd)
    if not minio_download(cfg["qf"], cfg["gpkg"], tmp):
        print("  FAILED to download GPKG, skipping")
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return False

    try:
        gpkg = sqlite3.connect(tmp)
        rows = gpkg.execute(
            f'SELECT "{cfg["label"]}" AS label, "{cfg["status"]}" AS status '
            f'FROM "{cfg["table"]}" WHERE "{cfg["label"]}" IS NOT NULL'
        ).fetchall()
        gpkg.close()
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass

    # One Status per pole label (GPKG carries one row per pole).
    field = {label: status for label, status in rows}
    if len(field) != len(rows):
        print(f"  WARN: {len(rows) - len(field)} duplicate pole label(s) in GPKG — kept last")
    print(f"  GPKG poles: {len(field)}")
    dist = Counter((s or "<NULL>") for s in field.values())
    for s, c in dist.most_common():
        print(f"    {s:35s} {c}")

    if dry_run:
        print("  [DRY] no DB writes")
        return True

    # Bulk upsert onto EXISTING poles rows only (poles is the import target — we never
    # insert here). IS DISTINCT FROM keeps it idempotent and bumps synced_at only on
    # a real change. project_id is carried per-row so the join is project-scoped.
    # RETURNING + fetch=True gives an accurate count across execute_values batches
    # (cur.rowcount would only report the final batch).
    data = [(cfg["ff"], label, status) for label, status in field.items()]
    conn = psycopg2.connect(DB_URL)
    try:
        cur = conn.cursor()
        returned = execute_values(
            cur,
            """
            UPDATE poles p
               SET field_status = v.status,
                   field_status_synced_at = NOW()
              FROM (VALUES %s) AS v(ff, label, status)
             WHERE p.project_id = v.ff::uuid
               AND p.pole_number = v.label
               AND p.field_status IS DISTINCT FROM v.status
            RETURNING p.pole_number
            """,
            data,
            template="(%s, %s, %s)",
            fetch=True,
        )
        conn.commit()
        updated = len(returned)
    finally:
        conn.close()
    print(f"  poles rows updated: {updated}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Sync QField civil-audit Status into poles.field_status")
    parser.add_argument("--project", type=str, default=None, help="Single project name")
    parser.add_argument("--dry-run", action="store_true", help="Read + report only; no DB writes")
    args = parser.parse_args()

    if not DB_URL:
        print("ERROR: DATABASE_URL not set. Export it (Supabase) before running.")
        sys.exit(1)

    projects = PROJECTS
    if args.project:
        if args.project not in projects:
            print(f"Unknown project: {args.project}. Available: {', '.join(projects)}")
            sys.exit(1)
        projects = {args.project: projects[args.project]}

    print(f"QField Status → FF | {len(projects)} project(s) | dry_run={args.dry_run}")
    failures = []
    for name, cfg in projects.items():
        try:
            if not sync_project(name, cfg, dry_run=args.dry_run):
                failures.append(name)
        except Exception as e:
            print(f"\n  ERROR syncing {name}: {type(e).__name__}: {e}")
            failures.append(name)

    print(f"\n{'='*60}")
    if failures:
        print(f"Done with FAILURES ({len(failures)}): {', '.join(failures)}")
        sys.exit(1)
    print("Done.")


if __name__ == "__main__":
    main()
