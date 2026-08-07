"""
Reading the downloaded GeoPackage — which layer holds the photos, and what is in it.

Pure local sqlite work: this module never touches MinIO or Postgres. It takes a file
already on disk and answers "which table, which columns, which rows". That boundary is
why it is separate from qfield_extract_phases, whose stages are all network/DB.

Aborts (returning None) rather than raising, matching the extraction's convention that
a project which cannot be read is skipped WITHOUT recording a sync — so it keeps
looking unsynced instead of looking freshly synced.
"""
import sqlite3
from typing import NamedTuple

from qfield_gpkg_resolution import pick_photo_table
from qfield_step_detection import detect_step_columns


class GpkgTable(NamedTuple):
    """The opened GPKG and everything read off it that later phases need."""
    db: object
    table_name: str
    rows: list
    columns: list
    label_col: str
    step_cols: dict
    extra_cols: list


def sqlite_ident(name):
    """Quote a SQLite identifier that came from an untrusted GPKG.

    Table names now reach SQL from the file itself (pick_photo_table's fallback picks
    any layer in sqlite_master), not just from the hard-coded PROJECTS config — so the
    bracket-quoting these queries used is no longer backed by a trusted value. SQLite
    escapes a double quote inside a quoted identifier by doubling it.
    """
    return '"' + str(name).replace('"', '""') + '"'


def require_column(db, table_name, column, purpose="label"):
    """Raise unless `column` exists on `table_name`. Call BEFORE interpolating it.

    SQLite does not error on a double-quoted identifier it cannot resolve — it falls
    back to treating it as a STRING LITERAL. So when a config names a column the table
    does not have, `SELECT "label_1" FROM t WHERE "label_1" IS NOT NULL` does not raise:
    it returns the constant 'label_1' for every row and matches all of them. The caller
    then reads a full result set in which every pole is named "label_1", matches nothing
    in FibreFlow, writes nothing, and reports success.

    That is exactly how Thembisa POP 3's status mirror died silently. QField dropped the
    `_1` suffix when the layer was republished without a name collision; the config still
    said `label_1`; all 4,590 rows came back as the literal string. Verified against
    every THM_3_Poles.gpkg version published 2026-08-06 — `label` has 4,590 non-null
    values and `label_1` does not exist. Nothing alerted, because nothing failed.

    Callers that must skip rather than crash should catch KeyError — but they have to
    make that choice explicitly, which is the whole point of failing loudly here.
    """
    have = [row[1] for row in db.execute(
        f"PRAGMA table_info({sqlite_ident(table_name)})").fetchall()]
    if column not in have:
        raise KeyError(
            f"{purpose} column {column!r} is not a column of {table_name!r} — "
            f"SQLite would silently read it as the string literal {column!r} for every "
            f"row. Available columns: {have}")
    return column


def open_gpkg(tmp_path, config, gpkg_path):
    """Open the GPKG, resolve its photo table, read rows; None to abort.

    Aborts when no table can be resolved, when the resolved table has no photo
    columns, or when it has photo columns but not the configured label column.
    Every abort path closes the sqlite handle and happens before any sync-state
    write, so a misconfigured project stays visibly unsynced.
    """
    db = sqlite3.connect(tmp_path)
    db.row_factory = sqlite3.Row

    table_name = config["table_name"]
    tables = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'gpkg%'"
    ).fetchall()]

    if table_name not in tables:
        match = [t for t in tables if t.lower() == table_name.lower()]
        if match:
            table_name = match[0]
        else:
            # A renamed GPKG renames its layer too ('civil_audit' →
            # 'civil_audit_updated_27_07'), so fall back to whichever table
            # actually carries photo columns. Counting rather than guessing
            # also skips GPKG relation side-tables ('civil_audit__civil_audit'),
            # which have none.
            photo_col_counts = {}
            for t in tables:
                t_cols = [r[1] for r in db.execute(f"PRAGMA table_info({sqlite_ident(t)})").fetchall()]
                t_steps, t_extra = detect_step_columns(t_cols)
                photo_col_counts[t] = len(t_steps) + len(t_extra)
            fallback = pick_photo_table(config["table_name"], photo_col_counts, prefer_stem=gpkg_path)
            if fallback:
                print(f"  TABLE-FALLBACK: '{config['table_name']}' absent; using "
                      f"'{fallback}' ({photo_col_counts[fallback]} photo columns). "
                      f"Available: {tables}")
                table_name = fallback
            else:
                print(f"  ERROR: Table '{config['table_name']}' not found and no "
                      f"table has photo columns. Available: {tables}")
                db.close()
                return None

    rows = db.execute(f"SELECT * FROM {sqlite_ident(table_name)}").fetchall()
    columns = rows[0].keys() if rows else []
    label_col = config["label_col"]

    step_cols, extra_cols = detect_step_columns(columns)
    print(f"  Rows: {len(rows)}, Step columns: {len(step_cols)}, Extra photo cols: {len(extra_cols)}")
    for col, (step, label, disc) in sorted(step_cols.items(), key=lambda x: x[1][0]):
        print(f"    Step {step} ({label}, {disc}): {col[:55]}...")

    if not step_cols and not extra_cols:
        print(f"  SKIP: No photo columns detected")
        db.close()
        return None

    # A layer can carry photo columns and still be the wrong one — the fallback
    # picks by photo-column count, which a sibling form also satisfies. Without the
    # label column every row is skipped later, yet execution would still reach the
    # sync-state upsert and stamp last_version/last_synced_at for a run that
    # ingested nothing: the project then looks freshly synced forever. Bail BEFORE
    # any state is written so the freeze stays visible.
    if rows and label_col not in columns:
        print(f"  ERROR: table '{table_name}' has {len(step_cols) + len(extra_cols)} photo "
              f"column(s) but no label column '{label_col}' — refusing to record a sync. "
              f"Columns: {list(columns)[:12]}")
        db.close()
        return None

    return GpkgTable(db, table_name, rows, columns, label_col, step_cols, extra_cols)
