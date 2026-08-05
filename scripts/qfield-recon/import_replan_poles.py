#!/usr/bin/env python3
"""Import a replanned pole layer from QFieldCloud into public.poles, carrying
field-collected state and QA photos across the relabel.

A replan re-issues a whole project under NEW pole labels, zones and PONs. Matching the
old plan to the new one by label is meaningless — on Thembisa POP 3 only 138 of 3,594
labels survive. Matching by GEOMETRY is what works: 1,287 poles are the same physical
pole <=5 m away under a different label (TEM.P.G141 -> TEM.P.J950, 0.0 m, zone 44 ->
69, PON 535 -> 821).

This module is the I/O half — MinIO, Postgres, CLI. Every decision it executes comes
from replan_match.decide(), which is pure and separately testable.

  * writes the new plan into public.poles,
  * carries field state from each old pole to the new pole on its spot,
  * KEEPS any pole the replan is silent about (out of area, or unmatched with field
    evidence) rather than deleting surveyed work,
  * relabels pole_qa_photos so existing QA follows its pole, and re-derives zone/PON.

Dry-run by default; --apply writes. Every run is recorded in pole_plan_import_runs with
a full pre-image in pole_plan_backup / pole_qa_photo_plan_backup, so --rollback
<run_id> restores the previous state exactly. See migration 479.

⚠️ Poles are replaced, so `poles.id` changes for every pole the replan describes.
Nothing has an FK to it, but two tables hold unconstrained references (SOFT_REF_TABLES)
and the run aborts if any point at this project.

DATABASE_URL must come from the environment. Never hard-code it.

  python3 scripts/qfield-recon/import_replan_poles.py \
      --project-id 1de088dd-fe24-43fb-b8d3-94fca61ef91d \
      --qfield-project-id 5f3b962a-7901-43f7-a284-1c1a9ed7f3d1 \
      --gpkg 'Thembisa 3 Replan.gpkg' --layer 'Poles HLD'
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import psycopg2
from psycopg2.extras import execute_values, Json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "qfield-sync"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from replan_match import CARRY_COLUMNS, PLAN_COLUMNS, decide, load_plan  # noqa: E402

DB_URL = os.environ.get("DATABASE_URL", "")
BUCKET = os.environ.get("MINIO_BUCKET", "qfieldcloud-prod")
CONTAINER = os.environ.get("MINIO_CONTAINER", "qfieldcloud-minio-1")

# Tables holding an unconstrained uuid pointing at poles.id. No FK enforces them, so a
# delete leaves a dangling reference that no error will announce.
SOFT_REF_TABLES = (("maintenance_tickets", "pole_id"), ("pole_checklist", "pole_id"))


def mc(*args, binary=False):
    r = subprocess.run(["docker", "exec", CONTAINER, "mc", *args],
                       capture_output=True, text=not binary)
    if r.returncode != 0:
        raise RuntimeError(f"mc {' '.join(args)} failed: {r.stderr!r}")
    return r.stdout


def newest_version(qfield_project_id, gpkg):
    """Newest upload of `gpkg`. Versions are timestamp-prefixed, so lexical max is newest."""
    prefix = f"local/{BUCKET}/projects/{qfield_project_id}/files/{gpkg}/"
    versions = [ln.split()[-1] for ln in mc("ls", prefix).splitlines() if ln.strip()]
    if not versions:
        raise RuntimeError(f"no versions found under {prefix}")
    return max(versions)


def fetch_gpkg(qfield_project_id, gpkg, version, dest):
    obj = f"local/{BUCKET}/projects/{qfield_project_id}/files/{gpkg}/{version}"
    with open(dest, "wb") as fh:
        fh.write(mc("cat", obj, binary=True))
    return obj


def read_current(conn, project_id):
    """The two row sets decide() needs, as plain dicts."""
    cur = conn.cursor()
    cur.execute(f"SELECT id, pole_number, latitude, longitude, {', '.join(CARRY_COLUMNS)} "
                "FROM poles WHERE project_id = %s", (project_id,))
    cols = [d[0] for d in cur.description]
    old = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.execute("SELECT id, pole_label, zone_no, pon_no FROM pole_qa_photos WHERE project_id = %s",
                (project_id,))
    photos = [{"id": r[0], "label": r[1], "zone": r[2], "pon": r[3]} for r in cur.fetchall()]
    return old, photos


def dangling(conn, project_id):
    """Rows that would be orphaned by the delete. Returns (found, absent).

    A table missing from the search_path is reported as absent rather than raised on:
    this check is advisory, and SOFT_REF_TABLES is a hand-maintained list that will
    outlive some of the tables in it. Absent is surfaced, never silently swallowed —
    a check that quietly stops running is worse than no check.
    """
    found, absent = [], []
    cur = conn.cursor()
    for table, col in SOFT_REF_TABLES:
        cur.execute("SELECT to_regclass(%s)", (table,))
        if cur.fetchone()[0] is None:
            absent.append(table)
            continue
        cur.execute(f"SELECT count(*) FROM {table} WHERE {col} IN "
                    "(SELECT id FROM poles WHERE project_id = %s)", (project_id,))
        n = cur.fetchone()[0]
        if n:
            found.append((table, col, n))
    return found, absent


def _adapt(v):
    return Json(v) if isinstance(v, (dict, list)) else v


def do_import(conn, args, plan, obj, version, s):
    cur = conn.cursor()
    cur.execute("INSERT INTO pole_plan_import_runs "
                "(project_id, gpkg_object, gpkg_version, layer, poles_before, note) "
                "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                (args.project_id, obj, version, args.layer, len(s["old"]), args.note))
    run_id = cur.fetchone()[0]

    cur.execute("INSERT INTO pole_plan_backup (run_id, pole_id, row_data) "
                "SELECT %s, id, to_jsonb(poles) FROM poles WHERE project_id = %s",
                (run_id, args.project_id))
    execute_values(cur,
                   "INSERT INTO pole_qa_photo_plan_backup "
                   "(run_id, photo_id, pole_label, zone_no, pon_no) VALUES %s",
                   [(run_id, p["id"], p["label"], p["zone"], p["pon"]) for p in s["photos"]])

    # Retained poles keep their existing row untouched — id, field state and all. Their
    # labels are absent from the replan (retain_reason returns None when the label is
    # reissued), so they cannot collide with the rows inserted below.
    # ::uuid[] is required — psycopg2 adapts an empty or uuid-object list to text[],
    # and `uuid = text` has no operator.
    keep_ids = [str(o["id"]) for o in s["retain"]]
    cur.execute("DELETE FROM poles WHERE project_id = %s AND NOT (id = ANY(%s::uuid[]))",
                (args.project_id, keep_ids))
    rows = []
    for label, p in plan.items():
        o = s["carry"].get(label)
        rows.append(tuple([label, args.project_id, p["lat"], p["lon"], p["zone"], p["pon"], "qfield"]
                          + [_adapt(o[c]) if o else None for c in CARRY_COLUMNS]))
    execute_values(cur, f"INSERT INTO poles ({', '.join(PLAN_COLUMNS + CARRY_COLUMNS)}) VALUES %s",
                   rows)

    for photo_id, label, zone, pon in s["relabel"]:
        cur.execute("UPDATE pole_qa_photos SET pole_label=%s, zone_no=%s, pon_no=%s WHERE id=%s",
                    (label, zone, pon, photo_id))
    for photo_id, zone, pon in s["rezone"]:
        cur.execute("UPDATE pole_qa_photos SET zone_no=%s, pon_no=%s WHERE id=%s",
                    (zone, pon, photo_id))

    cur.execute("UPDATE pole_plan_import_runs SET status='completed', completed_at=now(), "
                "poles_after=%s, photos_relabelled=%s, photos_superseded=%s WHERE id=%s",
                (len(rows) + len(s["retain"]), len(s["relabel"]), len(s["superseded"]), run_id))
    return run_id


def do_rollback(conn, run_id):
    cur = conn.cursor()
    cur.execute("SELECT project_id, status FROM pole_plan_import_runs WHERE id=%s", (run_id,))
    row = cur.fetchone()
    if not row:
        raise SystemExit(f"no such run: {run_id}")
    project_id, status = row
    if status != "completed":
        raise SystemExit(f"run {run_id} is '{status}', only 'completed' runs can be rolled back")
    cur.execute("DELETE FROM poles WHERE project_id = %s", (project_id,))
    cur.execute("INSERT INTO poles SELECT (jsonb_populate_record(NULL::poles, row_data)).* "
                "FROM pole_plan_backup WHERE run_id = %s", (run_id,))
    restored = cur.rowcount
    cur.execute("UPDATE pole_qa_photos p SET pole_label=b.pole_label, zone_no=b.zone_no, "
                "pon_no=b.pon_no FROM pole_qa_photo_plan_backup b "
                "WHERE b.run_id=%s AND b.photo_id=p.id", (run_id,))
    photos = cur.rowcount
    cur.execute("UPDATE pole_plan_import_runs SET status='rolled_back', completed_at=now() "
                "WHERE id=%s", (run_id,))
    print(f"rolled back run {run_id}: {restored} poles, {photos} photos restored")


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project-id", help="FibreFlow projects.id (uuid)")
    ap.add_argument("--qfield-project-id", help="QFieldCloud project id (uuid)")
    ap.add_argument("--gpkg", help="GeoPackage filename in the QField project")
    ap.add_argument("--layer", help="pole layer inside the GeoPackage")
    ap.add_argument("--match-radius", type=float, default=5.0,
                    help="metres within which an old pole is the same physical pole (default 5)")
    ap.add_argument("--coverage-radius", type=float, default=50.0,
                    help="an old pole further than this from every replan pole is treated as "
                         "outside the replan's area and RETAINED, not deleted (default 50)")
    ap.add_argument("--apply", action="store_true", help="write (default is dry-run)")
    ap.add_argument("--allow-dangling", action="store_true",
                    help="proceed even though other tables reference poles.id without an FK")
    ap.add_argument("--note", help="free text recorded on the run")
    ap.add_argument("--rollback", metavar="RUN_ID", help="restore the pre-image of a completed run")
    return ap.parse_args()


def run(conn, args):
    for req in ("project_id", "qfield_project_id", "gpkg", "layer"):
        if not getattr(args, req):
            raise SystemExit(f"ERROR: --{req.replace('_', '-')} is required")

    version = newest_version(args.qfield_project_id, args.gpkg)
    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as tmp:
        path = tmp.name
    try:
        obj = fetch_gpkg(args.qfield_project_id, args.gpkg, version, path)
        plan, skipped = load_plan(path, args.layer)
    finally:
        os.unlink(path)

    old, photos = read_current(conn, args.project_id)
    s = decide(old, photos, plan, args.match_radius, args.coverage_radius)
    refs, absent_refs = dangling(conn, args.project_id)
    print(json.dumps({
        "gpkg": args.gpkg, "version": version, "layer": args.layer,
        "plan_poles": len(plan), "plan_rows_skipped": skipped,
        "current_poles": len(s["old"]), "field_state_carried": len(s["carry"]),
        "poles_retained": len(s["retain"]),
        "poles_retained_why": s["retain_breakdown"],
        "poles_after": len(plan) + len(s["retain"]),
        "photos": len(s["photos"]), "photos_relabelled": len(s["relabel"]),
        "photos_rezoned_in_place": len(s["rezone"]),
        "photos_on_retained_poles": len(s["kept"]),
        "photos_superseded": len(s["superseded"]),
        "relabel_collisions": s["collisions"],
        "dangling_soft_refs": refs,
        "soft_ref_tables_absent": absent_refs,
        "mode": "apply" if args.apply else "dry-run",
    }, indent=2, default=str))

    if s["collisions"]:
        raise SystemExit("ABORT: relabel would collide on (project_id, pole_label). "
                         "Resolve the listed pairs first.")
    if refs and not args.allow_dangling:
        raise SystemExit("ABORT: rows reference poles.id without an FK and would dangle. "
                         "Re-run with --allow-dangling to accept that.")
    if not args.apply:
        print("\ndry-run — nothing written. Re-run with --apply.")
        return
    run_id = do_import(conn, args, plan, obj, version, s)
    conn.commit()
    print(f"\napplied. run_id = {run_id}\nrollback with: --rollback {run_id}")


def main():
    args = parse_args()
    if not DB_URL:
        raise SystemExit("ERROR: DATABASE_URL not set.")
    conn = psycopg2.connect(DB_URL)
    try:
        if args.rollback:
            do_rollback(conn, args.rollback)
            conn.commit()
            return
        run(conn, args)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
