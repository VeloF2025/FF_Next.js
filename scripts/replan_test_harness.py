#!/usr/bin/env python3
"""Shared fixtures for the replan import's database tests.

Kept apart from the test bodies so both suites use the SAME scratch schema shape —
two hand-maintained copies of a 25-column `poles` fixture would drift, and a fixture
that no longer matches the real table silently stops testing what it claims to.

Nothing here asserts anything; it only builds and tears down a throwaway database.
"""
import os
import subprocess
import sys
import time
from argparse import Namespace

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qfield-sync"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qfield-recon"))

import psycopg2  # noqa: E402
from replan_match import CARRY_COLUMNS, decide  # noqa: E402
import replan_db  # noqa: E402

SCHEMA = "replan_import_test"
PROJECT = "11111111-1111-1111-1111-111111111111"
OTHER_PROJECT = "22222222-2222-2222-2222-222222222222"

FAILURES = []
_container = ""


def check(label, ok):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        FAILURES.append(label)


def finish(name):
    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}): {FAILURES}")
        sys.exit(1)
    print(f"All {name} checks passed.")


def start_pg():
    """Throwaway Postgres on an ephemeral port; returns a connection URL."""
    global _container
    # Labelled so a cancelled CI run (concurrency: cancel-in-progress) can be swept by
    # an `if: always()` step — teardown() never runs when the process is killed, and an
    # orphaned Postgres holds a port on a long-lived self-hosted runner. RUN_ID scopes
    # the sweep to this run so it cannot kill a developer's container.
    run_id = os.environ.get("GITHUB_RUN_ID", f"local-{os.getpid()}")
    # Retry the run itself: rootless Docker's port manager can hand out a host port it
    # has not finished releasing from a container that just exited, so `docker run -P`
    # dies with "bind: address already in use" (exit 125). The four Python suites start
    # containers back-to-back, which is exactly the window that race needs — it took the
    # gate down on run 31139831645 after three suites had already passed. Each retry
    # redraws a different ephemeral port, so a plain re-run clears it.
    last_err = ""
    for attempt in range(5):
        proc = subprocess.run([
            "docker", "run", "-d", "--rm", "-P",
            "--label", "ff-replan-test=1", "--label", f"ff-replan-run={run_id}",
            "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=test",
            "postgres:15-alpine"], capture_output=True, text=True)
        if proc.returncode == 0:
            _container = proc.stdout.strip()
            break
        last_err = proc.stderr.strip()
        print(f"  docker run failed (attempt {attempt + 1}/5): {last_err[:160]}")
        time.sleep(2 * (attempt + 1))
    else:
        raise RuntimeError(f"throwaway Postgres would not start: {last_err[:300]}")
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


def connect():
    """A connection scoped to the scratch schema.

    ⚠️ TEST_DATABASE_URL ONLY — deliberately does NOT fall back to DATABASE_URL.
    `fixture()` issues DROP SCHEMA … CASCADE and DDL, and this suite runs inside
    `npm run ci:quick`. DATABASE_URL is the variable import_replan_poles.py tells
    operators to export and it points at the shared dev+prod Postgres, so honouring it
    would run schema DDL against production every time someone ran CI with their
    importer environment loaded — while this file's own docstring promises it never
    touches that database. Two agents running concurrently would also drop each
    other's schema mid-test.
    """
    url = os.environ.get("TEST_DATABASE_URL") or start_pg()
    conn = psycopg2.connect(url)
    conn.cursor().execute(f"SET search_path TO {SCHEMA}")
    return conn


def hierarchy_fixture(cur, schema):
    """Scratch tables for the hierarchy-authority suites, in `schema`.

    Shared by test_qfield_hierarchy_backfill and test_qfield_hierarchy_scoping so the
    two cannot drift into disagreeing pictures of the same three tables — the whole
    reason this module exists. Each suite passes its OWN schema name so they stay
    isolated and can run concurrently.
    """
    cur.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE; CREATE SCHEMA {schema};")
    cur.execute(f"SET search_path TO {schema}")
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
    # Stands in for the real view (production UNIONs sow_poles). A view, not a copy,
    # so the tests stay honest about reading the PLAN rather than the GPKG.
    cur.execute("""CREATE VIEW v_pole_planning AS
        SELECT project_id, pole_number, zone_no, pon_no FROM poles""")


def teardown_container():
    """Kill the throwaway Postgres, if this process started one.

    Separate from teardown() so a suite with its own scratch schema (the hierarchy
    tests) can reuse the container lifecycle without inheriting the replan schema.
    Safe to call when no container was started — TEST_DATABASE_URL was supplied.
    """
    if _container:
        subprocess.run(["docker", "kill", _container],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def teardown(conn):
    try:
        conn.cursor().execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
        conn.commit()
    finally:
        conn.close()
        teardown_container()


def fixture(conn):
    """A scratch schema shaped like the real one, seeded with two known projects."""
    cur = conn.cursor()
    cur.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE; CREATE SCHEMA {SCHEMA};")
    cur.execute(f"SET search_path TO {SCHEMA}")
    cur.execute("CREATE TABLE projects (id uuid PRIMARY KEY, project_name text)")
    cur.execute("""CREATE TABLE poles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pole_number varchar UNIQUE, project_id uuid, latitude numeric, longitude numeric,
        zone_no integer, pon_no integer, source varchar,
        status varchar DEFAULT 'pending', installation_date date, notes text,
        images jsonb, inspection_data jsonb, metadata jsonb, dome_joint varchar,
        type_of_join varchar, splitter varchar, slack_on_pole varchar, field_agent varchar,
        pole_planted varchar, audit_complete date, field_status varchar,
        field_status_synced_at timestamptz, created_by uuid, raw_data jsonb,
        UNIQUE (project_id, pole_number))""")
    cur.execute("""CREATE TABLE pole_qa_photos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid,
        pole_label text, zone_no integer, pon_no integer,
        UNIQUE (project_id, pole_label))""")
    cur.execute("CREATE TABLE snags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "
                "pole_ids uuid[], pole_references text[])")
    # The migrations are APPLIED, not hand-mirrored: a fixture that declares the
    # columns itself would keep passing after the migration stopped creating them.
    sql_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations", "sql")
    for mig in ("480_pole_plan_replan_backup.sql", "481_pole_qa_photo_superseded.sql"):
        with open(os.path.join(sql_dir, mig)) as fh:
            cur.execute(fh.read().replace("public.", f"{SCHEMA}."))
    cur.execute("INSERT INTO projects VALUES (%s,'Test Project'),(%s,'Other Project')",
                (PROJECT, OTHER_PROJECT))
    conn.commit()
    cur.execute(f"SET search_path TO {SCHEMA}")


def seed_poles(conn, rows):
    """Replace this project's poles/photos with `rows` of (label, lat, lon, extra)."""
    cur = conn.cursor()
    cur.execute("DELETE FROM poles WHERE project_id = %s", (PROJECT,))
    cur.execute("DELETE FROM pole_qa_photos WHERE project_id = %s", (PROJECT,))
    for label, lat, lon, extra in rows:
        cols = {"pole_number": label, "project_id": PROJECT, "latitude": lat,
                "longitude": lon, "source": "qfield", "status": "planned"}
        cols.update(extra)
        keys = list(cols)
        cur.execute(f"INSERT INTO poles ({','.join(keys)}) VALUES "
                    f"({','.join(['%s'] * len(keys))})", [cols[k] for k in keys])
    conn.commit()


def args_for(**kw):
    base = dict(project_id=PROJECT, layer="Poles HLD", note="test",
                match_radius=5.0, coverage_radius=50.0)
    base.update(kw)
    return Namespace(**base)


def analyse(conn, plan):
    old, photos = replan_db.read_current(conn, PROJECT, CARRY_COLUMNS)
    return old, photos, decide(old, photos, plan, 5.0, 50.0)
