#!/usr/bin/env python3
"""Import a replanned pole layer from QFieldCloud into public.poles, carrying
field-collected state and QA photos across the relabel.

A replan re-issues a whole project under NEW pole labels, zones and PONs. Matching the
old plan to the new one by label is meaningless — on Thembisa POP 3 only 138 of 3,594
labels survive. Matching by GEOMETRY is what works: 1,287 poles are the same physical
pole <=5 m away under a different label (TEM.P.G141 -> TEM.P.J950, 0.0 m, zone 44 ->
69, PON 535 -> 821).

This module is the I/O half — MinIO, Postgres, CLI. Matching decisions come from
replan_match.decide() (pure); pre-write safety questions from replan_db (read-only).
Both are separately tested. This writes the new plan, carries field state onto the
successor pole, KEEPS any pole the replan is silent about rather than deleting
surveyed work, and relabels pole_qa_photos so existing QA follows its pole.

Dry-run by default. `--apply` also requires `--expect-version`: the newest GeoPackage
is re-resolved every invocation and the replan changes several times a day, so without
the pin the run that writes need not be the run a human approved.

Every run is recorded in pole_plan_import_runs with a full pre-image.
`--rollback <run_id>` restores it, and REFUSES if a later completed run exists.

⚠️ Poles are replaced, so `poles.id` and most `pole_number` values change. Nothing has
a foreign key to either, but several tables hold unconstrained references
(replan_db.SOFT_REFS) and the run aborts if any point at this project.

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

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "qfield-sync"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from replan_match import CARRY_COLUMNS, decide, load_plan  # noqa: E402
from replan_write import do_import, do_rollback  # noqa: E402
import replan_db  # noqa: E402

DB_URL = os.environ.get("DATABASE_URL", "")
BUCKET = os.environ.get("MINIO_BUCKET", "qfieldcloud-prod")
CONTAINER = os.environ.get("MINIO_CONTAINER", "qfieldcloud-minio-1")

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


def parse_args(argv=None):
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
    ap.add_argument("--expect-version", help="GeoPackage version the dry-run reported; "
                                             "required with --apply")
    ap.add_argument("--allow-dangling", action="store_true",
                    help="proceed even though other tables reference these poles without an FK")
    ap.add_argument("--allow-duplicate-labels", action="store_true",
                    help="proceed even though the GeoPackage repeats a label with different data")
    ap.add_argument("--allow-schema-drift", action="store_true",
                    help="--rollback only: restore even though `poles` gained columns")
    ap.add_argument("--note", help="free text recorded on the run")
    ap.add_argument("--rollback", metavar="RUN_ID", help="restore the pre-image of a completed run")
    return ap.parse_args(argv)


def run(conn, args):
    for req in ("project_id", "qfield_project_id", "gpkg", "layer"):
        if not getattr(args, req):
            raise SystemExit(f"ERROR: --{req.replace('_', '-')} is required")

    name = replan_db.project_name(conn, args.project_id)
    if name is None:
        raise SystemExit(f"ERROR: no project with id {args.project_id}. "
                         "Check --project-id has not been swapped with --qfield-project-id.")

    version = newest_version(args.qfield_project_id, args.gpkg)
    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as tmp:
        path = tmp.name
    try:
        obj = fetch_gpkg(args.qfield_project_id, args.gpkg, version, path)
        plan, skipped, duplicates = load_plan(path, args.layer)
    finally:
        os.unlink(path)

    old, photos = replan_db.read_current(conn, args.project_id, CARRY_COLUMNS)
    s = decide(old, photos, plan, args.match_radius, args.coverage_radius)
    gone_ids, gone_labels = replan_db.breaking_references(s["old"], s["retain"], plan)
    refs, absent_refs = replan_db.dangling(conn, gone_ids, gone_labels)
    cross = replan_db.cross_project_label_collisions(conn, args.project_id, plan.keys())
    deleting = len(s["old"]) - len(s["retain"])

    print(json.dumps({
        "project": name, "project_id": args.project_id,
        "gpkg": args.gpkg, "version": version, "layer": args.layer,
        "plan_poles": len(plan), "plan_rows_skipped": skipped,
        "duplicate_labels": {k: len(v) for k, v in duplicates.items()},
        "current_poles": len(s["old"]), "field_state_carried": len(s["carry"]),
        "poles_retained": len(s["retain"]), "poles_retained_why": s["retain_breakdown"],
        "poles_deleted": deleting, "poles_after": len(plan) + len(s["retain"]),
        "photos": len(s["photos"]), "photos_relabelled": len(s["relabel"]),
        "photos_rezoned_in_place": len(s["rezone"]),
        "photos_on_retained_poles": len(s["kept"]),
        "photos_superseded_marked": len(s["superseded"]),
        "relabel_collisions": s["collisions"],
        "cross_project_label_collisions": cross,
        "dangling_soft_refs": refs, "soft_ref_tables_absent": absent_refs,
        "ids_disappearing": len(gone_ids), "labels_disappearing": len(gone_labels),
        "mode": "apply" if args.apply else "dry-run",
    }, indent=2, default=str))

    if s["collisions"]:
        raise SystemExit("ABORT: relabel would collide on (project_id, pole_label). "
                         "Resolve the listed pairs first.")
    if cross:
        raise SystemExit("ABORT: plan labels are already owned by another project and "
                         "poles.pole_number is globally unique. Listed above.")
    if duplicates and not args.allow_duplicate_labels:
        raise SystemExit(f"ABORT: the GeoPackage repeats {len(duplicates)} label(s) with "
                         "different coordinates or zone/PON; the first occurrence would win "
                         "arbitrarily. Fix the export, or re-run with --allow-duplicate-labels.")
    if refs and not args.allow_dangling:
        raise SystemExit("ABORT: rows reference these poles without an FK and would dangle "
                         "(both ids and labels change). Re-run with --allow-dangling to accept.")
    if not args.apply:
        print(f"\ndry-run — nothing written. To apply this exact plan:\n"
              f"  --apply --expect-version {version}")
        return
    if args.expect_version != version:
        raise SystemExit(
            f"ABORT: --expect-version {args.expect_version!r} but MinIO's newest is "
            f"{version!r}.\nThe replan is re-uploaded several times a day; re-run the "
            "dry-run and apply the version it reports.")

    run_id, deleted = do_import(conn, args, plan, obj, version, s)
    conn.commit()
    print(f"\napplied. run_id = {run_id}  (poles deleted: {deleted})\n"
          f"rollback with: --rollback {run_id}")


def main():
    args = parse_args()
    if not DB_URL:
        raise SystemExit("ERROR: DATABASE_URL not set.")
    conn = psycopg2.connect(DB_URL)
    try:
        if args.rollback:
            do_rollback(conn, args.rollback, args.allow_schema_drift)
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
