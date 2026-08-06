#!/usr/bin/env python3
"""
Execution test for qfield_hierarchy_sync's BACKFILL-ONLY contract — real Postgres.

The three write sites in that module all read `COALESCE(existing, gpkg)`. That
argument order IS the contract: reversed, the GPKG overwrites values the plan owns.
Asserting it by grepping the SQL text would prove nothing about what Postgres does, so
these run the real statements against real tables.

What must hold, for poles, pole_qa_photos and construction_qa_reviews alike:

  existing NULL, gpkg set    -> filled          (the entire point of a backfill)
  existing set,  gpkg set    -> UNCHANGED       (the regression this guards)
  existing set,  gpkg NULL   -> UNCHANGED
  both NULL                  -> stays NULL, and reports no change

The regression it guards (2026-08-06, Thembisa POP 3): with the arguments the other way
round, one extractor run rewrote 98 poles the replan import had just corrected —
TEM.P.I544 zone 66 -> 62, TEM.P.M040 zone 69 -> 6 — silently, because a stale field
attribute was allowed to win over the plan.

Starts a throwaway postgres:15-alpine unless TEST_DATABASE_URL is set, and works inside
a scratch schema dropped at the end. `public` is never touched.

Run:  python3 scripts/test_qfield_hierarchy_backfill.py
Wired into CI via scripts/ci-local.sh and .github/workflows/ci.yml.
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402
from qfield_hierarchy_sync import plan_owns_hierarchy  # noqa: E402
from qfield_hierarchy_writers import (  # noqa: E402
    _update_planning_poles, _upsert_work_qa, _update_reviews,
)

SCHEMA = "hierarchy_backfill_test"
PROJECT = "33333333-3333-3333-3333-333333333333"
NO_PLAN_PROJECT = "44444444-4444-4444-4444-444444444444"
_FAILURES = []
_container = ""


def check(label, ok):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        _FAILURES.append(label)


def start_pg():
    global _container
    run_id = os.environ.get("GITHUB_RUN_ID", f"local-{os.getpid()}")
    _container = subprocess.check_output([
        "docker", "run", "-d", "--rm", "-P",
        "--label", "ff-replan-test=1", "--label", f"ff-replan-run={run_id}",
        "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=test",
        "postgres:15-alpine"], text=True).strip()
    port = subprocess.check_output(
        ["docker", "port", _container, "5432/tcp"], text=True).strip().rsplit(":", 1)[-1]
    url = f"postgresql://postgres:test@127.0.0.1:{port}/test"
    for _ in range(60):
        try:
            psycopg2.connect(url).close()
            return url
        except psycopg2.OperationalError:
            time.sleep(1)
    raise RuntimeError("throwaway Postgres never became ready")


def fixture(cur):
    cur.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE; CREATE SCHEMA {SCHEMA};")
    cur.execute(f"SET search_path TO {SCHEMA}")
    cur.execute("""CREATE TABLE poles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid,
        pole_number varchar, zone_no integer, pon_no integer,
        updated_at timestamptz, UNIQUE (project_id, pole_number))""")
    cur.execute("""CREATE TABLE pole_qa_photos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid,
        pole_label text, zone_no integer, pon_no integer,
        updated_at timestamptz, UNIQUE (project_id, pole_label))""")
    cur.execute("""CREATE TABLE construction_qa_reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid,
        feature_type text, feature_id text, zone_no integer, pon_no integer,
        updated_at timestamptz)""")
    # Stands in for the real view. Production UNIONs sow_poles with poles; only the
    # poles half matters here, and reading it as a view (not a copy) keeps the test
    # honest about reviews being sourced from the PLAN rather than the GPKG.
    cur.execute("""CREATE VIEW v_pole_planning AS
        SELECT project_id, pole_number, zone_no, pon_no FROM poles""")


# (label, existing zone/pon, gpkg zone/pon, expected zone/pon after)
#
# ⚠️ HALFZONE and HALFPON are a MIRRORED PAIR and both are required. Only a row that
# reaches the WHERE clause can expose a wrong SET, so a case whose `pon` is already
# NULL cannot detect a bad `pon` SET — both COALESCE orders agree on NULL. With only
# HALFZONE present, reverting JUST the three `pon_no` SET expressions (leaving zone
# and every WHERE correct) passed 17/17. Proven by execution, not argued.
CASES = [
    ("GAP",       (None, None), (69, 821), (69, 821), "NULL is filled from the GPKG"),
    ("PLANNED",   (66, 781),    (62, 745), (66, 781), "a set value is NOT overwritten"),
    ("HALFZONE",  (66, None),   (62, 745), (66, 745), "zone set / pon NULL decide independently"),
    ("HALFPON",   (None, 781),  (62, 745), (62, 781), "pon set / zone NULL decide independently"),
    ("NOGPKG",    (66, 781),    (None, None), (66, 781), "a NULL GPKG value changes nothing"),
    ("BOTHNULL",  (None, None), (None, None), (None, None), "both NULL stays NULL"),
]

# With NO plan the GPKG is the only authority and MUST win — Mahikeng/Namakgale have
# zero rows in `poles`, so freezing them removes their only correction mechanism.
NO_PLAN_CASES = [
    ("GAP",       (None, None), (69, 821), (69, 821), "NULL is filled"),
    ("PLANNED",   (66, 781),    (62, 745), (62, 745), "the GPKG DOES overwrite when no plan exists"),
    ("HALFZONE",  (66, None),   (62, 745), (62, 745), "both columns take the GPKG"),
    ("NOGPKG",    (66, 781),    (None, None), (66, 781), "a NULL GPKG value still changes nothing"),
]


def main():
    url = os.environ.get("TEST_DATABASE_URL") or start_pg()
    conn = psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
    cur = conn.cursor()
    try:
        fixture(cur)
        conn.commit()
        cur.execute(f"SET search_path TO {SCHEMA}")

        for lab, (ez, ep), _, _, _ in CASES:
            cur.execute("INSERT INTO poles (project_id, pole_number, zone_no, pon_no) "
                        "VALUES (%s,%s,%s,%s)", (PROJECT, lab, ez, ep))
            cur.execute("INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no) "
                        "VALUES (%s,%s,%s,%s)", (PROJECT, lab, ez, ep))
            cur.execute("INSERT INTO construction_qa_reviews "
                        "(project_id, feature_type, feature_id, zone_no, pon_no) "
                        "VALUES (%s,'pole',%s,%s,%s)", (PROJECT, lab, ez, ep))
        conn.commit()

        values = [(PROJECT, lab, gz, gp) for lab, _, (gz, gp), _, _ in CASES]

        print("poles:")
        _update_planning_poles(cur, values)
        conn.commit()
        for lab, _, _, (wz, wp), why in CASES:
            cur.execute("SELECT zone_no, pon_no FROM poles WHERE pole_number=%s", (lab,))
            r = cur.fetchone()
            check(f"{why} ({lab})", (r["zone_no"], r["pon_no"]) == (wz, wp))

        print("\npole_qa_photos:")
        _upsert_work_qa(cur, values, {lab for lab, *_ in CASES}, True)
        conn.commit()
        for lab, _, _, (wz, wp), why in CASES:
            cur.execute("SELECT zone_no, pon_no FROM pole_qa_photos WHERE pole_label=%s", (lab,))
            r = cur.fetchone()
            check(f"{why} ({lab})", (r["zone_no"], r["pon_no"]) == (wz, wp))

        print("\nconstruction_qa_reviews:")
        _update_reviews(cur, values, True)
        conn.commit()
        for lab, _, _, (wz, wp), why in CASES:
            cur.execute("SELECT zone_no, pon_no FROM construction_qa_reviews WHERE feature_id=%s",
                        (lab,))
            r = cur.fetchone()
            check(f"{why} ({lab})", (r["zone_no"], r["pon_no"]) == (wz, wp))

        # The INSERT path — a QA row that does NOT exist yet. Every case above
        # pre-exists and so only exercises ON CONFLICT; without this, seeding a new row
        # straight from the GPKG goes undetected. That is the defect that put 86 rows
        # on Thembisa POP 3 at odds with the plan, two of them (TEM.P.M074/M075) for
        # labels the plan does not contain, inflating PON 818's count.
        # A QA row that has DRIFTED from the plan is now corrected, not frozen — this
        # is what heals the 86 rows on Thembisa POP 3 rather than making them permanent.
        print("\nQA rows are corrected to the plan, not just backfilled:")
        cur.execute("INSERT INTO poles (project_id, pole_number, zone_no, pon_no) "
                    "VALUES (%s,'QADRIFT',66,781)", (PROJECT,))
        cur.execute("INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no) "
                    "VALUES (%s,'QADRIFT',62,745)", (PROJECT,))
        conn.commit()
        _upsert_work_qa(cur, [(PROJECT, "QADRIFT", 62, 745)], {"QADRIFT"}, True)
        conn.commit()
        cur.execute("SELECT zone_no, pon_no FROM pole_qa_photos "
                    "WHERE project_id=%s AND pole_label='QADRIFT'", (PROJECT,))
        r = cur.fetchone()
        check("a QA row disagreeing with the plan is corrected to the plan",
              (r["zone_no"], r["pon_no"]) == (66, 781))

        print("\nnew QA rows are seeded from the plan, not the GPKG:")
        cur.execute("INSERT INTO poles (project_id, pole_number, zone_no, pon_no) "
                    "VALUES (%s,'FRESH',66,781)", (PROJECT,))
        conn.commit()
        _upsert_work_qa(cur, [(PROJECT, "FRESH", 62, 745)], {"FRESH"}, True)
        conn.commit()
        cur.execute("SELECT zone_no, pon_no FROM pole_qa_photos "
                    "WHERE project_id=%s AND pole_label='FRESH'", (PROJECT,))
        r = cur.fetchone()
        check("a brand-new QA row takes the PLAN's zone/PON, not the GPKG's",
              (r["zone_no"], r["pon_no"]) == (66, 781))

        # A pole the plan does not cover still seeds from the GPKG — otherwise a
        # photographed-but-unplanned pole would land with no zone at all.
        _upsert_work_qa(cur, [(PROJECT, "UNPLANNED", 62, 745)], {"UNPLANNED"}, True)
        conn.commit()
        cur.execute("SELECT zone_no, pon_no FROM pole_qa_photos "
                    "WHERE project_id=%s AND pole_label='UNPLANNED'", (PROJECT,))
        r = cur.fetchone()
        check("  ...falling back to the GPKG when the plan has no such pole",
              (r["zone_no"], r["pon_no"]) == (62, 745))

        # The 114-row problem: a review row that CONTRADICTS the plan must be
        # CORRECTED, not merely left alone. construction_qa_reviews has no other
        # plan-driven writer, and zoneDeliveryReadRepository gates handover on these
        # columns — a mis-filed review blocks its own zone's handover forever.
        print("\nreviews are corrected to the plan, not just backfilled:")
        cur.execute("INSERT INTO poles (project_id, pole_number, zone_no, pon_no) "
                    "VALUES (%s,'DRIFTED',66,781)", (PROJECT,))
        cur.execute("INSERT INTO construction_qa_reviews "
                    "(project_id, feature_type, feature_id, zone_no, pon_no) "
                    "VALUES (%s,'pole','DRIFTED',62,745)", (PROJECT,))
        conn.commit()
        _update_reviews(cur, [(PROJECT, "DRIFTED", 62, 745)], True)
        conn.commit()
        cur.execute("SELECT zone_no, pon_no FROM construction_qa_reviews "
                    "WHERE feature_id='DRIFTED'")
        r = cur.fetchone()
        check("a review disagreeing with the plan is corrected to the plan",
              (r["zone_no"], r["pon_no"]) == (66, 781))

        # A project with NO rows in `poles` has no plan to protect — Mahikeng and
        # Namakgale live here. The GPKG must stay authoritative or they can never be
        # corrected again.
        print("\nno-plan project: the GPKG keeps its authority:")
        check("plan_owns_hierarchy() is True for a project with poles",
              plan_owns_hierarchy(cur, PROJECT) is True)
        check("plan_owns_hierarchy() is False for a project with none",
              plan_owns_hierarchy(cur, NO_PLAN_PROJECT) is False)
        for lab, (ez, ep), _, _, _ in NO_PLAN_CASES:
            cur.execute("INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no) "
                        "VALUES (%s,%s,%s,%s)", (NO_PLAN_PROJECT, lab, ez, ep))
        conn.commit()
        np_values = [(NO_PLAN_PROJECT, lab, gz, gp) for lab, _, (gz, gp), _, _ in NO_PLAN_CASES]
        _upsert_work_qa(cur, np_values, {lab for lab, *_ in NO_PLAN_CASES}, False)
        conn.commit()
        for lab, _, _, (wz, wp), why in NO_PLAN_CASES:
            cur.execute("SELECT zone_no, pon_no FROM pole_qa_photos "
                        "WHERE project_id=%s AND pole_label=%s", (NO_PLAN_PROJECT, lab))
            r = cur.fetchone()
            check(f"{why} ({lab})", (r["zone_no"], r["pon_no"]) == (wz, wp))

        print("\nidempotence + change reporting:")
        again = _update_planning_poles(cur, values)
        conn.commit()
        check("a second identical run reports 0 changed rows", again == 0)

        # The real-world regression, end to end: the plan says 66, a stale field
        # attribute says 62. The plan must win.
        cur.execute("UPDATE poles SET zone_no=66, pon_no=781 WHERE pole_number='PLANNED'")
        conn.commit()
        _update_planning_poles(cur, [(PROJECT, "PLANNED", 62, 745)])
        conn.commit()
        cur.execute("SELECT zone_no, pon_no FROM poles WHERE pole_number='PLANNED'")
        r = cur.fetchone()
        check("a stale GPKG attribute cannot revert a replanned pole",
              (r["zone_no"], r["pon_no"]) == (66, 781))
    finally:
        try:
            cur.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
            conn.commit()
        finally:
            conn.close()
            if _container:
                subprocess.run(["docker", "kill", _container],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print()
    if _FAILURES:
        print(f"FAILED ({len(_FAILURES)}): {_FAILURES}")
        sys.exit(1)
    print("All hierarchy backfill checks passed.")


if __name__ == "__main__":
    main()
