#!/usr/bin/env python3
"""
Integration tests for the replan import's PRE-WRITE GUARDS — against a real Postgres.

scripts/test_replan_import_db.py covers do_import/do_rollback. This covers everything
that decides whether a write is ALLOWED to happen at all:

  * replan_db.dangling() — the unconstrained pole references a replace would orphan.
    This is the check that reported "clean" while 27 unresolved snags on Thembisa
    POP 3 were about to be silently orphaned, because `snags` was not in the list.
  * breaking_references() — that the check is scoped to the ids and labels that
    actually disappear. Flagging a retained pole or a reissued label forces
    --allow-dangling, and that single flag disables ALL five soft-ref checks.
  * cross-project label collisions (poles.pole_number is globally unique).
  * run()'s abort gate — that the guards actually STOP the write. Computing a guard
    value is not the same as acting on it; an inverted condition would ship corruption
    with every guard still "passing".

Fixtures come from replan_test_harness. Requires TEST_DATABASE_URL, otherwise starts a
throwaway postgres:15-alpine and removes it afterwards. Everything happens inside a
scratch schema dropped at the end — `public` is never touched.

Run:  python3 scripts/test_replan_guards.py
Wired into CI via scripts/ci-local.sh and .github/workflows/ci.yml.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qfield-recon"))

import replan_db  # noqa: E402
from replan_write import do_import  # noqa: E402
from replan_test_harness import (  # noqa: E402
    OTHER_PROJECT, PROJECT, analyse, args_for, check, connect, finish, fixture,
    seed_poles, teardown,
)


def main():
    conn = connect()
    try:
        fixture(conn)
        cur = conn.cursor()
        # ── guards ───────────────────────────────────────────────────────────────
        print("\nsoft-reference guard:")
        seed_poles(conn, [("G1", -25.98, 28.23, {})])
        cur.execute("SELECT id FROM poles WHERE pole_number='G1'")
        pid = cur.fetchone()[0]
        check("clean when nothing references the poles",
              replan_db.dangling(conn, [str(pid)], ["G1"])[0] == [])
        cur.execute("INSERT INTO snags (pole_ids) VALUES (ARRAY[%s]::uuid[])", (pid,))
        conn.commit()
        found, _ = replan_db.dangling(conn, [str(pid)], ["G1"])
        check("a snag referencing a pole by uuid[] is caught",
              any(f["table"] == "snags" and f["column"] == "pole_ids" for f in found))
        cur.execute("DELETE FROM snags")
        cur.execute("INSERT INTO snags (pole_references) VALUES (ARRAY['G1'])")
        conn.commit()
        found, _ = replan_db.dangling(conn, [str(pid)], ["G1"])
        check("a snag referencing a pole by LABEL is caught",
              any(f["column"] == "pole_references" for f in found))
        cur.execute("DELETE FROM snags")
        conn.commit()
        absent = replan_db.dangling(conn, [str(pid)], ["G1"])[1]
        check("tables absent from this schema are reported, not silently skipped",
              "maintenance_tickets.pole_id" in absent)

        # Granularity: a reference only dangles if the thing it names disappears.
        # Checking the whole project instead flags retained poles and reissued labels,
        # which makes --allow-dangling mandatory — and that flag disables ALL five
        # soft-ref checks, including the ones that genuinely would break.
        cur.execute("DELETE FROM snags")
        cur.execute("INSERT INTO snags (pole_ids, pole_references) "
                    "VALUES (ARRAY[%s]::uuid[], ARRAY['G1'])", (pid,))
        conn.commit()
        old_rows = [{"id": pid, "pole_number": "G1"}]
        gone_i, gone_l = replan_db.breaking_references(old_rows, old_rows, {})
        check("a RETAINED pole's id and label are not 'disappearing'",
              gone_i == [] and gone_l == [])
        check("  ...so nothing is flagged", replan_db.dangling(conn, gone_i, gone_l)[0] == [])
        gone_i, gone_l = replan_db.breaking_references(old_rows, [], {"G1": {}})
        check("a REISSUED label is not 'disappearing', but its id still is",
              gone_l == [] and gone_i == [str(pid)])
        found, _ = replan_db.dangling(conn, gone_i, gone_l)
        check("  ...so the uuid ref is flagged and the label ref is not",
              [f["column"] for f in found] == ["pole_ids"])
        gone_i, gone_l = replan_db.breaking_references(old_rows, [], {})
        found, _ = replan_db.dangling(conn, gone_i, gone_l)
        check("a pole that truly disappears flags both",
              sorted(f["column"] for f in found) == ["pole_ids", "pole_references"])
        cur.execute("DELETE FROM snags")
        conn.commit()

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
    finish("replan-guard")


if __name__ == "__main__":
    main()
