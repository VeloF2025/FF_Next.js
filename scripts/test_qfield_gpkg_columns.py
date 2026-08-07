#!/usr/bin/env python3
"""require_column: the guard against SQLite's double-quoted-string fallback.

Pure sqlite, no Postgres and no Docker — fast enough to gate every run.

This exists because the guard was previously untested: both `raise` statements could be
deleted and every other Python suite stayed green. That is the worst thing to leave
unprotected here, since the guard IS the alerting mechanism for a failure that produces
no error at all — a stale label column froze Thembisa POP 3's status mirror for three
days while the job kept reporting success.

The first test below is the one that matters: it pins SQLite's actual behaviour, so if a
future SQLite ever starts raising on an unresolvable identifier (the fallback is a
documented misfeature kept for backwards compatibility, and `SQLITE_DQS` can disable it),
this fails and tells us the guard's premise changed rather than silently over-guarding.
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from qfield_gpkg_table import require_column  # noqa: E402
from replan_test_harness import check, finish  # noqa: E402


def build():
    db = sqlite3.connect(":memory:")
    db.execute('CREATE TABLE poles (fid INTEGER, "label" TEXT, "Status" TEXT)')
    db.execute("INSERT INTO poles VALUES (1,'TEM.P.A1','planted')")
    db.execute("INSERT INTO poles VALUES (2,'TEM.P.A2','pending')")
    return db


def main():
    db = build()

    print("the misfeature this guard exists for:")
    rows = db.execute(
        'SELECT "label_1" FROM poles WHERE "label_1" IS NOT NULL').fetchall()
    check("an unresolvable identifier does NOT raise", True)
    check("  ...it degrades to a string literal", [r[0] for r in rows] == ["label_1", "label_1"])
    check("  ...and matches every row", len(rows) == 2)

    print("\nrequire_column rejects what SQLite would swallow:")
    for col in ("label_1", "Label", "", "nonexistent"):
        try:
            require_column(db, "poles", col)
            check(f"rejects {col!r}", False)
        except KeyError:
            check(f"rejects {col!r}", True)

    print("\n...and accepts what genuinely exists:")
    for col in ("label", "Status", "fid"):
        try:
            check(f"accepts {col!r}", require_column(db, "poles", col) == col)
        except KeyError:
            check(f"accepts {col!r}", False)

    print("\na missing table is reported as a missing TABLE, not a missing column:")
    try:
        require_column(db, "no_such_table", "label")
        check("a non-existent table raises", False)
    except KeyError as exc:
        check("a non-existent table raises", True)
        # PRAGMA table_info returns an empty set for a table that does not exist, so
        # without the explicit check this would send the reader hunting for a column.
        check("  ...and says so", "does not exist" in str(exc))

    print("\nthe message names the column and what SQLite would have done:")
    try:
        require_column(db, "poles", "label_1", purpose="label")
    except KeyError as exc:
        msg = str(exc)
        check("names the offending column", "label_1" in msg)
        check("names the purpose", "label" in msg)
        check("lists what IS available", "Status" in msg)

    db.close()
    finish("gpkg column guard")


if __name__ == "__main__":
    main()
