#!/usr/bin/env python3
"""
Integration tests for the replan import against a REAL Postgres.

scripts/test_replan_match.py covers the pure matching decisions. This covers the code
that touches the database, which was previously untested end to end:

  * do_import()   — DELETE + re-INSERT of a project's poles, the pre-image write, and
                    the QA-photo relabel/rezone.
  * do_rollback() — the restore the whole migration-479 backup spine exists for, plus
                    the two things it must REFUSE: out-of-order runs, and schema drift.
  * the pre-write guards, and run()'s abort gate — that those guards actually STOP the
    write. Computing a guard value is not the same as acting on it; an inverted
    condition would ship corruption with every guard still "passing".

Hand-writing the same SQL against a synthetic table would prove only that Postgres
works. These call the real functions and assert on the real tables.

Fixtures come from replan_test_harness. Uses TEST_DATABASE_URL / DATABASE_URL when set,
otherwise starts a throwaway postgres:15-alpine and removes it afterwards. Everything
happens inside a scratch schema dropped at the end — `public` is never touched.

Run:  python3 scripts/test_replan_import_db.py
Wired into CI via scripts/ci-local.sh.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qfield-recon"))

import replan_db  # noqa: E402
from replan_write import do_import, do_rollback  # noqa: E402
from replan_test_harness import (  # noqa: E402
    OTHER_PROJECT, PROJECT, analyse, args_for, check, connect, finish, fixture,
    seed_poles, teardown,
)


def main():
    conn = connect()
    try:
        fixture(conn)
        # ── do_import ────────────────────────────────────────────────────────────
        print("do_import:")
        seed_poles(conn, [
            ("OLD-A", -25.98, 28.23, {"status": "installed", "pole_planted": "yes"}),
            ("OLD-FAR", -25.99, 28.23, {"audit_complete": "2026-02-11"}),
        ])
        cur = conn.cursor()
        cur.execute("INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no) "
                    "VALUES (%s,'OLD-A',1,1)", (PROJECT,))
        conn.commit()
        plan = {"NEW-A": {"pon": 821, "zone": 69, "lon": 28.23, "lat": -25.98}}
        old, photos, s = analyse(conn, plan)
        run_id, deleted = do_import(conn, args_for(), plan, "obj", "v1", s)
        conn.commit()

        cur.execute("SELECT pole_number, zone_no, pon_no, status, pole_planted "
                    "FROM poles WHERE project_id=%s ORDER BY pole_number", (PROJECT,))
        after = cur.fetchall()
        check("the new plan label is written with its zone/PON",
              ("NEW-A", 69, 821) == after[0][:3])
        check("field state moved to the successor pole",
              after[0][3] == "installed" and after[0][4] == "yes")
        check("the out-of-area pole survives untouched",
              any(r[0] == "OLD-FAR" for r in after))
        check("the superseded pole is gone", not any(r[0] == "OLD-A" for r in after))
        check("deleted count is reported", deleted == 1)
        cur.execute("SELECT pole_label, zone_no, pon_no FROM pole_qa_photos "
                    "WHERE project_id=%s", (PROJECT,))
        check("the QA photo followed its pole", cur.fetchone() == ("NEW-A", 69, 821))
        cur.execute("SELECT count(*) FROM pole_plan_backup WHERE run_id=%s", (run_id,))
        check("a pre-image was written for every pole", cur.fetchone()[0] == 2)
        cur.execute("SELECT status, poles_before, poles_after FROM pole_plan_import_runs "
                    "WHERE id=%s", (run_id,))
        check("the run is recorded completed", cur.fetchone() == ("completed", 2, 2))

        # ── do_rollback ──────────────────────────────────────────────────────────
        print("\ndo_rollback:")
        do_rollback(conn, run_id)
        conn.commit()
        cur.execute("SELECT pole_number, status, pole_planted, audit_complete FROM poles "
                    "WHERE project_id=%s ORDER BY pole_number", (PROJECT,))
        restored = cur.fetchall()
        check("both original labels are back",
              [r[0] for r in restored] == ["OLD-A", "OLD-FAR"])
        check("field state is restored exactly",
              restored[0][1] == "installed" and restored[0][2] == "yes")
        check("the retained pole's audit date is intact", str(restored[1][3]) == "2026-02-11")
        cur.execute("SELECT pole_label, zone_no FROM pole_qa_photos WHERE project_id=%s",
                    (PROJECT,))
        check("the QA photo label/zone is restored", cur.fetchone() == ("OLD-A", 1))
        cur.execute("SELECT status FROM pole_plan_import_runs WHERE id=%s", (run_id,))
        check("the run is marked rolled_back", cur.fetchone()[0] == "rolled_back")

        # ── superseded photos: marked, never lost ────────────────────────────────
        # A photo the replan cannot place is the only QA that does not follow a pole.
        # On Thembisa POP 3 that is 34 photos, 5 of them carrying a real photo key —
        # all field typos (TEM.J.960, TEM.P.MO84). They must survive with their label
        # untouched and be findable afterwards.
        print("\nsuperseded photos are marked, not deleted or moved:")
        seed_poles(conn, [("KEEP", -25.98, 28.23, {})])
        cur.execute("INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no) "
                    "VALUES (%s,'TEM.J.960',7,7)", (PROJECT,))
        conn.commit()
        pl = {"KEEP": {"pon": 5, "zone": 5, "lon": 28.23, "lat": -25.98}}
        _, _, sm = analyse(conn, pl)
        check("the unplaceable photo is classified superseded",
              [p["label"] for p in sm["superseded"]] == ["TEM.J.960"])
        run_m, _ = do_import(conn, args_for(), pl, "obj", "v1", sm)
        conn.commit()
        cur.execute("SELECT pole_label, zone_no, superseded_at IS NOT NULL, superseded_run_id, "
                    "superseded_reason FROM pole_qa_photos WHERE pole_label='TEM.J.960'")
        row = cur.fetchone()
        check("the row still exists", row is not None)
        check("its label is left exactly as the crew entered it", row[0] == "TEM.J.960")
        check("its zone is not blanked", row[1] == 7)
        check("it is marked superseded", row[2] is True)
        check("the mark names the run that made it", row[3] == run_m)
        check("the mark carries a reason", bool(row[4]))

        do_rollback(conn, run_m)
        conn.commit()
        cur.execute("SELECT superseded_at, superseded_run_id FROM pole_qa_photos "
                    "WHERE pole_label='TEM.J.960'")
        check("rollback clears the mark it set", cur.fetchone() == (None, None))

        # A later replan that DOES contain the label must clear a stale mark.
        _, _, sm2 = analyse(conn, pl)
        run_m2, _ = do_import(conn, args_for(), pl, "obj", "v1", sm2)
        conn.commit()
        cur.execute("UPDATE pole_qa_photos SET pole_label='KEEP2' WHERE pole_label='TEM.J.960'")
        conn.commit()
        pl2 = {"KEEP2": {"pon": 9, "zone": 9, "lon": 28.23, "lat": -25.98}}
        _, _, sm3 = analyse(conn, pl2)
        run_m3, _ = do_import(conn, args_for(), pl2, "obj", "v2", sm3)
        conn.commit()
        cur.execute("SELECT superseded_at, zone_no FROM pole_qa_photos WHERE pole_label='KEEP2'")
        row = cur.fetchone()
        check("a later plan that can place the photo clears the stale mark", row[0] is None)
        check("  ...and rezones it", row[1] == 9)

        # Unwind newest-first so the ordering guard does not fire on the next section.
        do_rollback(conn, run_m3)
        do_rollback(conn, run_m2)
        conn.commit()


        print("\nrollback refuses what it cannot honour:")
        try:
            do_rollback(conn, run_id)
            check("a run already rolled back is refused", False)
        except SystemExit:
            conn.rollback()
            check("a run already rolled back is refused", True)

        # Two completed runs, rolled back out of order.
        seed_poles(conn, [("P1", -25.98, 28.23, {})])
        p1 = {"N1": {"pon": 1, "zone": 1, "lon": 28.23, "lat": -25.98}}
        _, _, s1 = analyse(conn, p1)
        run_a, _ = do_import(conn, args_for(), p1, "obj", "v1", s1)
        conn.commit()
        p2 = {"N2": {"pon": 2, "zone": 2, "lon": 28.23, "lat": -25.98}}
        _, _, s2 = analyse(conn, p2)
        run_b, _ = do_import(conn, args_for(), p2, "obj", "v2", s2)
        conn.commit()
        check("a later completed run is detected",
              [r["run_id"] for r in replan_db.later_completed_runs(conn, run_a, PROJECT)]
              == [str(run_b)])
        try:
            do_rollback(conn, run_a)
            check("rolling back out of order is refused", False)
        except SystemExit:
            conn.rollback()
            check("rolling back out of order is refused", True)
        do_rollback(conn, run_b)
        conn.commit()
        check("newest-first rollback is allowed", True)

        print("\nschema drift:")
        seed_poles(conn, [("S1", -25.98, 28.23, {})])
        _, _, s3 = analyse(conn, p1)
        run_c, _ = do_import(conn, args_for(), p1, "obj", "v1", s3)
        conn.commit()
        cur.execute("ALTER TABLE poles ADD COLUMN new_col text NOT NULL DEFAULT 'x'")
        conn.commit()
        check("a column added after the pre-image is detected",
              replan_db.restore_schema_drift(conn, run_c) == ["new_col"])
        try:
            do_rollback(conn, run_c)
            check("restoring across schema drift is refused by default", False)
        except SystemExit:
            conn.rollback()
            check("restoring across schema drift is refused by default", True)
        cur.execute("ALTER TABLE poles DROP COLUMN new_col")
        conn.commit()
        # ── guards ───────────────────────────────────────────────────────────────
        print("\nsoft-reference guard:")
        seed_poles(conn, [("G1", -25.98, 28.23, {})])
        cur.execute("SELECT id FROM poles WHERE pole_number='G1'")
        pid = cur.fetchone()[0]
        check("clean when nothing references the poles",
              replan_db.dangling(conn, PROJECT)[0] == [])
        cur.execute("INSERT INTO snags (pole_ids) VALUES (ARRAY[%s]::uuid[])", (pid,))
        conn.commit()
        found, _ = replan_db.dangling(conn, PROJECT)
        check("a snag referencing a pole by uuid[] is caught",
              any(f["table"] == "snags" and f["column"] == "pole_ids" for f in found))
        cur.execute("DELETE FROM snags")
        cur.execute("INSERT INTO snags (pole_references) VALUES (ARRAY['G1'])")
        conn.commit()
        found, _ = replan_db.dangling(conn, PROJECT)
        check("a snag referencing a pole by LABEL is caught",
              any(f["column"] == "pole_references" for f in found))
        cur.execute("DELETE FROM snags")
        conn.commit()
        absent = replan_db.dangling(conn, PROJECT)[1]
        check("tables absent from this schema are reported, not silently skipped",
              "maintenance_tickets.pole_id" in absent)

        print("\ncross-project label collision:")
        cur.execute("INSERT INTO poles (pole_number, project_id) VALUES ('SHARED', %s)",
                    (OTHER_PROJECT,))
        conn.commit()
        hits = replan_db.cross_project_label_collisions(conn, PROJECT, ["SHARED", "MINE"])
        check("a label owned by another project is reported before the write",
              [h["label"] for h in hits] == ["SHARED"])
        check("labels owned by nobody are not reported",
              replan_db.cross_project_label_collisions(conn, PROJECT, ["MINE"]) == [])

        print("\nproject identity:")
        check("a real project resolves to its name",
              replan_db.project_name(conn, PROJECT) == "Test Project")
        check("an unknown project id resolves to None",
              replan_db.project_name(conn, str(uuid.uuid4())) is None)

        # ── run()'s abort gate ───────────────────────────────────────────────────
        # The guards above are only useful if run() actually stops on them. Testing
        # that the values are computed is NOT testing that they block the write — an
        # inverted condition here would ship data corruption with every guard "passing".
        # Only the MinIO calls are stubbed; the gate itself is the real code.
        print("\nrun() abort gate (the wiring, not the inputs):")
        import import_replan_poles as imp
        cur.execute("DELETE FROM poles WHERE project_id=%s",
                    (OTHER_PROJECT,))
        conn.commit()
        real = (imp.newest_version, imp.fetch_gpkg, imp.load_plan)
        imp.newest_version = lambda *a, **k: "v-stub"
        imp.fetch_gpkg = lambda *a, **k: "obj-stub"

        def gate(plan, dups=None, apply_=False, expect=None):
            imp.load_plan = lambda *a, **k: (plan, 0, dups or {})
            a = args_for(qfield_project_id="q", gpkg="g", apply=apply_, expect_version=expect,
                         allow_dangling=False, allow_duplicate_labels=False)
            try:
                imp.run(conn, a)
                return None
            except SystemExit as e:
                conn.rollback()
                return str(e)

        try:
            seed_poles(conn, [("G1", -25.98, 28.23, {})])
            good = {"N1": {"pon": 1, "zone": 1, "lon": 28.23, "lat": -25.98}}
            check("a clean dry-run does not abort", gate(good) is None)

            cur.execute("INSERT INTO snags (pole_references) VALUES (ARRAY['G1'])")
            conn.commit()
            check("dangling soft-refs abort the run",
                  "dangling" in (gate(good) or "").lower())
            cur.execute("DELETE FROM snags")
            conn.commit()

            check("duplicate GeoPackage labels abort the run",
                  "duplicate" in (gate(good, dups={"N1": [1, 2]}) or "").lower())

            cur.execute("INSERT INTO poles (pole_number, project_id) VALUES ('SHARED2', %s)",
                        (OTHER_PROJECT,))
            conn.commit()
            shared = dict(good, **{"SHARED2": {"pon": 1, "zone": 1, "lon": 28.23, "lat": -25.98}})
            check("a cross-project label collision aborts the run",
                  "globally unique" in (gate(shared) or ""))

            msg = gate(good, apply_=True, expect="v-WRONG")
            check("--apply with a stale --expect-version aborts",
                  "expect-version" in (msg or ""))
            check("  ...and names the version actually resolved", "v-stub" in (msg or ""))
        finally:
            imp.newest_version, imp.fetch_gpkg, imp.load_plan = real
    finally:
        teardown(conn)
    finish("replan-import DB")


if __name__ == "__main__":
    main()
