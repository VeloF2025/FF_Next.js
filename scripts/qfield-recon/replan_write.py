#!/usr/bin/env python3
"""The write path of a replan import: replace the plan, then restore it.

Split from import_replan_poles.py (CLI + MinIO) so the two functions that mutate
production data sit on their own and can be read — and tested — without the argument
parsing around them. Every decision they execute is computed beforehand by
replan_match.decide(); every guard they rely on is checked beforehand by replan_db.

Both run inside the caller's transaction and never commit. The caller commits once,
after the whole operation succeeds.
"""
from psycopg2.extras import execute_values, Json

from replan_match import CARRY_COLUMNS, PLAN_COLUMNS
import replan_db

INSERT_COLUMNS = tuple(PLAN_COLUMNS) + tuple(CARRY_COLUMNS)


def _adapt(v):
    return Json(v) if isinstance(v, (dict, list)) else v


def do_import(conn, args, plan, obj, version, s):
    cur = conn.cursor()
    cur.execute("INSERT INTO pole_plan_import_runs "
                "(project_id, gpkg_object, gpkg_version, layer, poles_before, note) "
                "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                (args.project_id, obj, version, args.layer, len(s["old"]), args.note))
    run_id = cur.fetchone()[0]

    # Both pre-images are taken with a fresh SELECT inside this transaction. Writing
    # the photo rows from the in-memory analysis instead would store a value read
    # before the transaction began, so a concurrent edit would be "restored" to a
    # state that never immediately preceded the import.
    cur.execute("INSERT INTO pole_plan_backup (run_id, pole_id, row_data) "
                "SELECT %s, id, to_jsonb(poles) FROM poles WHERE project_id = %s",
                (run_id, args.project_id))
    cur.execute("INSERT INTO pole_qa_photo_plan_backup "
                "(run_id, photo_id, pole_label, zone_no, pon_no) "
                "SELECT %s, id, pole_label, zone_no, pon_no FROM pole_qa_photos "
                "WHERE project_id = %s", (run_id, args.project_id))

    # Retained poles keep their existing row untouched — id, field state and all. Their
    # labels are absent from the replan (retain_reason returns None when the label is
    # reissued), so they cannot collide with the rows inserted below.
    # ::uuid[] is required — psycopg2 adapts an empty or uuid-object list to text[],
    # and `uuid = text` has no operator. An empty keep-list deletes every row for the
    # project, which is the intended "nothing retained, replace wholesale" semantics.
    keep_ids = [str(o["id"]) for o in s["retain"]]
    cur.execute("DELETE FROM poles WHERE project_id = %s AND NOT (id = ANY(%s::uuid[]))",
                (args.project_id, keep_ids))
    deleted = cur.rowcount

    # Rows are built BY COLUMN NAME against INSERT_COLUMNS. A positional tuple would
    # silently write pon_no into zone_no the day someone reorders PLAN_COLUMNS — in the
    # one script whose purpose is not corrupting pole data.
    rows = []
    for label, p in plan.items():
        o = s["carry"].get(label)
        values = {"pole_number": label, "project_id": args.project_id,
                  "latitude": p["lat"], "longitude": p["lon"],
                  "zone_no": p["zone"], "pon_no": p["pon"], "source": "qfield"}
        if o:
            values.update({c: o[c] for c in CARRY_COLUMNS})
        rows.append(tuple(_adapt(values.get(c)) for c in INSERT_COLUMNS))
    execute_values(cur, f"INSERT INTO poles ({', '.join(INSERT_COLUMNS)}) VALUES %s", rows)

    for photo_id, label, zone, pon in s["relabel"]:
        cur.execute("UPDATE pole_qa_photos SET pole_label=%s, zone_no=%s, pon_no=%s WHERE id=%s",
                    (label, zone, pon, photo_id))
    for photo_id, zone, pon in s["rezone"]:
        cur.execute("UPDATE pole_qa_photos SET zone_no=%s, pon_no=%s WHERE id=%s",
                    (zone, pon, photo_id))

    # A photo the replan cannot place is MARKED, never deleted and never moved. Its
    # label is left exactly as the crew entered it: the unplaceable ones are typos
    # (TEM.J.960 for TEM.P.J960, TEM.P.MO84 with a letter O), and correcting a label by
    # similarity files a crew's photo against a different physical pole. See
    # migration 480.
    if s["superseded"]:
        cur.execute("UPDATE pole_qa_photos SET superseded_at = now(), superseded_run_id = %s, "
                    "superseded_reason = %s WHERE id = ANY(%s::uuid[])",
                    (run_id, "label matches no pole in the replan or the previous plan",
                     [str(p["id"]) for p in s["superseded"]]))

    # Anything a previous run marked that this plan CAN place is unmarked again — a
    # later replan re-introducing a label must clear the old verdict, not leave a live
    # photo flagged as unplaceable.
    placed = [str(pid) for pid, *_ in s["relabel"]] + [str(pid) for pid, *_ in s["rezone"]]
    if placed:
        cur.execute("UPDATE pole_qa_photos SET superseded_at = NULL, superseded_run_id = NULL, "
                    "superseded_reason = NULL "
                    "WHERE id = ANY(%s::uuid[]) AND superseded_at IS NOT NULL", (placed,))

    cur.execute("UPDATE pole_plan_import_runs SET status='completed', completed_at=now(), "
                "poles_after=%s, photos_relabelled=%s, photos_superseded=%s WHERE id=%s",
                (len(rows) + len(s["retain"]), len(s["relabel"]), len(s["superseded"]), run_id))
    return run_id, deleted


def do_rollback(conn, run_id, allow_schema_drift=False):
    cur = conn.cursor()
    cur.execute("SELECT project_id, status FROM pole_plan_import_runs WHERE id=%s", (run_id,))
    row = cur.fetchone()
    if not row:
        raise SystemExit(f"no such run: {run_id}")
    project_id, status = row
    if status != "completed":
        raise SystemExit(f"run {run_id} is '{status}', only 'completed' runs can be rolled back")

    later = replan_db.later_completed_runs(conn, run_id, project_id)
    if later:
        raise SystemExit(
            f"ABORT: {len(later)} later completed run(s) exist for this project: "
            f"{[r['run_id'] for r in later]}.\n"
            "Rolling back out of order restores this run's pre-image and discards "
            "everything the later runs did. Roll the later runs back first, newest first.")

    drift = replan_db.restore_schema_drift(conn, run_id)
    if drift and not allow_schema_drift:
        raise SystemExit(
            f"ABORT: `poles` has gained column(s) since this pre-image was taken: {drift}.\n"
            "jsonb_populate_record restores an unknown column as NULL, not as its "
            "default — a NOT NULL column would fail outright and a defaulted one would "
            "silently lose its default. Re-run with --allow-schema-drift to accept that.")

    cur.execute("DELETE FROM poles WHERE project_id = %s", (project_id,))
    cur.execute("INSERT INTO poles SELECT (jsonb_populate_record(NULL::poles, row_data)).* "
                "FROM pole_plan_backup WHERE run_id = %s", (run_id,))
    restored = cur.rowcount
    cur.execute("UPDATE pole_qa_photos p SET pole_label=b.pole_label, zone_no=b.zone_no, "
                "pon_no=b.pon_no FROM pole_qa_photo_plan_backup b "
                "WHERE b.run_id=%s AND b.photo_id=p.id", (run_id,))
    photos = cur.rowcount
    # Only THIS run's marks. A mark left by an earlier import describes a verdict this
    # rollback is not undoing, and clearing it would quietly lose the record of a photo
    # that is still unplaceable.
    cur.execute("UPDATE pole_qa_photos SET superseded_at=NULL, superseded_run_id=NULL, "
                "superseded_reason=NULL WHERE superseded_run_id=%s", (run_id,))
    unmarked = cur.rowcount
    cur.execute("UPDATE pole_plan_import_runs SET status='rolled_back', completed_at=now() "
                "WHERE id=%s", (run_id,))
    print(f"rolled back run {run_id}: {restored} poles, {photos} photos restored, "
          f"{unmarked} superseded mark(s) cleared")
