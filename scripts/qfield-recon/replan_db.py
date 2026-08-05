#!/usr/bin/env python3
"""Read-only database checks a replan import must pass before it is allowed to write.

Every function here answers one question: "what would this import break that nothing
in the schema would stop?" Kept apart from import_replan_poles.py so the guards can be
read — and tested — without the write path next to them.
"""

# Columns holding a reference to a pole that NO foreign key enforces. A replace-style
# import reassigns every `poles.id` AND changes most `pole_number` values, so both
# kinds of reference dangle silently — no error, no cascade, just rows pointing at
# nothing.
#
# `pole_checklist` is in this list and holds 0 rows database-wide; it is kept because
# it is a live table that could be populated tomorrow. It is NOT evidence the guard
# works — `snags` was the table that mattered and was missing entirely, which made the
# guard report "clean" while 27 unresolved snags on Thembisa POP 3 were about to be
# orphaned.
#
# kind:
#   "uuid"        — scalar column referencing poles.id
#   "uuid_array"  — array of poles.id
#   "label_array" — array of pole_number (breaks on RELABEL, not on id churn)
SOFT_REFS = (
    ("maintenance_tickets", "pole_id", "uuid"),
    ("pole_checklist", "pole_id", "uuid"),
    ("snags", "pole_ids", "uuid_array"),
    ("snags", "pole_references", "label_array"),
    ("snag_reports", "scope_poles", "label_array"),
)

# Scoped to the rows actually about to break, not to the whole project. A pole that is
# RETAINED keeps its id, and a label the replan REISSUES keeps its name — references to
# either survive the import untouched. Checking the whole project flags them anyway,
# which on Thembisa POP 3 makes --allow-dangling mandatory and, since that one flag
# disables all five checks at once, silently gives up the guard for references that
# genuinely would break.
_PREDICATE = {
    "uuid": "{col} = ANY(%s::uuid[])",
    "uuid_array": "{col} && %s::uuid[]",
    "label_array": "{col}::text[] && %s::text[]",
}


def project_name(conn, project_id):
    """The project's human name, or None if the id matches no project."""
    cur = conn.cursor()
    cur.execute("SELECT project_name FROM projects WHERE id = %s", (project_id,))
    row = cur.fetchone()
    return row[0] if row else None


def read_current(conn, project_id, carry_columns):
    """The two row sets the matcher needs, as plain dicts."""
    cur = conn.cursor()
    cur.execute(f"SELECT id, pole_number, latitude, longitude, {', '.join(carry_columns)} "
                "FROM poles WHERE project_id = %s", (project_id,))
    cols = [d[0] for d in cur.description]
    old = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.execute("SELECT id, pole_label, zone_no, pon_no FROM pole_qa_photos WHERE project_id = %s",
                (project_id,))
    photos = [{"id": r[0], "label": r[1], "zone": r[2], "pon": r[3]} for r in cur.fetchall()]
    return old, photos


def breaking_references(old, retain, plan):
    """(ids that disappear, labels that disappear) — what a reference could dangle on.

    An id survives if its pole is retained; a label survives if the replan reissues it
    OR its pole is retained under that label. Everything else stops existing.
    """
    kept_ids = {str(o["id"]) for o in retain}
    kept_labels = {o["pole_number"] for o in retain} | set(plan)
    gone_ids = [str(o["id"]) for o in old if str(o["id"]) not in kept_ids]
    gone_labels = [o["pole_number"] for o in old
                   if o["pole_number"] and o["pole_number"] not in kept_labels]
    return gone_ids, gone_labels


def dangling(conn, gone_ids, gone_labels):
    """Rows that would be orphaned by the replace. Returns (found, absent).

    A table missing from the search_path is reported as absent rather than raised on:
    SOFT_REFS is hand-maintained and will outlive some of the tables in it. Absent is
    surfaced, never silently swallowed — a check that quietly stops running is worse
    than no check, which is precisely how the original two-table version passed clean.
    """
    found, absent = [], []
    cur = conn.cursor()
    for table, col, kind in SOFT_REFS:
        cur.execute("SELECT to_regclass(%s)", (table,))
        if cur.fetchone()[0] is None:
            absent.append(f"{table}.{col}")
            continue
        target = gone_labels if kind == "label_array" else gone_ids
        if not target:
            continue
        cur.execute(f"SELECT count(*) FROM {table} WHERE " + _PREDICATE[kind].format(col=col),
                    (target,))
        n = cur.fetchone()[0]
        if n:
            found.append({"table": table, "column": col, "kind": kind, "rows": n})
    return found, absent


def cross_project_label_collisions(conn, project_id, labels):
    """Plan labels already owned by a DIFFERENT project.

    `poles.pole_number` carries a GLOBAL unique constraint (poles_pole_number_unique),
    not merely a per-project one. Without this check the dry-run reports clean and the
    apply dies on a raw UniqueViolation *after* the DELETE has run. The transaction
    rolls back so no data is lost, but the dry-run's whole contract — "this is what
    will happen" — is false.
    """
    if not labels:
        return []
    cur = conn.cursor()
    cur.execute(
        "SELECT p.pole_number, pr.project_name FROM poles p "
        "JOIN projects pr ON pr.id = p.project_id "
        "WHERE p.project_id <> %s AND p.pole_number = ANY(%s::text[]) ORDER BY 1",
        (project_id, list(labels)))
    rows = cur.fetchall()
    # Capped for readability, but the TOTAL is reported — "listed above" must not imply
    # the list is exhaustive when it is truncated.
    out = [{"label": r[0], "owned_by": r[1]} for r in rows[:25]]
    if len(rows) > 25:
        out.append({"label": f"... and {len(rows) - 25} more", "owned_by": ""})
    return out


def later_completed_runs(conn, run_id, project_id):
    """Completed runs for this project that started AFTER the given run.

    Rolling back out of order does not restore "the previous state" — it restores the
    pre-image of whichever run was named, discarding everything the later runs did and,
    on a subsequent rollback of the later run, moving the project FORWARD again.
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT id, started_at FROM pole_plan_import_runs "
        "WHERE project_id = %s AND status = 'completed' "
        "  AND started_at > (SELECT started_at FROM pole_plan_import_runs WHERE id = %s) "
        "ORDER BY started_at", (project_id, run_id))
    return [{"run_id": str(r[0]), "started_at": str(r[1])} for r in cur.fetchall()]


def restore_schema_drift(conn, run_id):
    """Columns on `poles` today that the stored pre-image does not carry.

    jsonb_populate_record fills an unknown column with NULL — NOT with its default. So
    a column added after the backup restores as NULL, and a later
    `ADD COLUMN ... NOT NULL DEFAULT x` makes every rollback fail outright. Surviving
    that drift is the reason the pre-image is JSONB instead of a LIKE-cloned table, so
    the drift must be reported rather than discovered mid-restore.
    """
    cur = conn.cursor()
    cur.execute("SELECT row_data FROM pole_plan_backup WHERE run_id = %s LIMIT 1", (run_id,))
    row = cur.fetchone()
    if not row:
        return []
    # Resolved through to_regclass rather than a hardcoded 'public', so this reads the
    # same `poles` the restore will write — whatever the session search_path is.
    cur.execute("SELECT attname FROM pg_attribute "
                "WHERE attrelid = to_regclass('poles') AND attnum > 0 AND NOT attisdropped")
    return sorted({r[0] for r in cur.fetchall()} - set(row[0].keys()))
