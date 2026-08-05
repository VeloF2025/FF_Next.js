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
    _container = subprocess.check_output([
        "docker", "run", "-d", "--rm", "-P",
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


def connect():
    """A connection scoped to the scratch schema. Uses an existing DB when offered."""
    url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL") or start_pg()
    conn = psycopg2.connect(url)
    conn.cursor().execute(f"SET search_path TO {SCHEMA}")
    return conn


def teardown(conn):
    try:
        conn.cursor().execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
        conn.commit()
    finally:
        conn.close()
        if _container:
            subprocess.run(["docker", "kill", _container],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


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
    for mig in ("479_pole_plan_replan_backup.sql", "480_pole_qa_photo_superseded.sql"):
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
