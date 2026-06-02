#!/usr/bin/env python3
"""
Fix swapped latitude/longitude on pole rows.

Some source imports (Mamelodi SOW file, Etwatwa/Mamelodi GPKG `lat`/`lon`
attribute columns) carried latitude and longitude in the wrong fields, so rows
ended up with latitude ~= +28 (a SA *longitude*) and longitude ~= -25 (a SA
*latitude*). The authoritative GPKG `geom` (WKB x=lon, y=lat) confirms the true
values are lat ~= -25.7, lon ~= +28.4.

This repairs `poles` and `sow_poles` by swapping the two fields ONLY for rows
whose values unambiguously match the swapped signature:
    latitude  BETWEEN 16 AND 33   (looks like a SA longitude)
    longitude BETWEEN -35 AND -22 (looks like a SA latitude)
Rows already correct (e.g. MAM.P.A348) fall outside this signature and are
left untouched.

Dry-run by default. Pass --commit to apply (per-table, single transaction).
"""

import argparse
import os
import sys

import psycopg2
import psycopg2.extras

# Connection string comes from the environment only — never hardcode credentials.
# See .claude/credentials.local.md for the dev/prod DATABASE_URL values.
DB_URL = os.environ.get("DATABASE_URL")
TABLES = ["poles", "sow_poles"]  # allowlist — interpolated into SQL, so it must stay a fixed literal

# Unambiguous "swapped" signature: latitude holds a SA longitude, longitude holds a SA latitude.
def swap_where(prefix=""):
    p = f"{prefix}." if prefix else ""
    return (
        f"{p}latitude IS NOT NULL AND {p}longitude IS NOT NULL "
        f"AND {p}latitude BETWEEN 16 AND 33 AND {p}longitude BETWEEN -35 AND -22"
    )

SWAP_WHERE = swap_where()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="apply (default: dry-run)")
    args = ap.parse_args()

    if not DB_URL:
        sys.exit("DATABASE_URL not set (see .claude/credentials.local.md)")

    con = psycopg2.connect(DB_URL)
    cur = con.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    grand_total = 0
    for table in TABLES:
        # Defense-in-depth: table is interpolated into SQL below, so it must be
        # a member of the fixed allowlist — never derived from external input.
        assert table in ("poles", "sow_poles"), f"refusing to interpolate unknown table {table!r}"
        print(f"\n================ {table} ================")
        cur.execute(
            f"""
            SELECT pr.project_name, COUNT(*) AS swapped
            FROM {table} t JOIN projects pr ON pr.id = t.project_id
            WHERE {swap_where('t')}
            GROUP BY pr.project_name ORDER BY swapped DESC
            """
        )
        rows = cur.fetchall()
        tbl_total = sum(r["swapped"] for r in rows)
        for r in rows:
            print(f"  {r['project_name']:18s} {r['swapped']:>6}")
        print(f"  {'TOTAL':18s} {tbl_total:>6}")
        grand_total += tbl_total

        # Show a couple of before/after examples
        cur.execute(
            f"""
            SELECT pole_number, latitude, longitude FROM {table}
            WHERE {SWAP_WHERE} ORDER BY pole_number LIMIT 3
            """
        )
        for r in cur.fetchall():
            print(
                f"    e.g. {r['pole_number']}: "
                f"({r['latitude']}, {r['longitude']}) -> ({r['longitude']}, {r['latitude']})"
            )

        if args.commit and tbl_total:
            cur.execute(
                f"""
                UPDATE {table}
                SET latitude = longitude, longitude = latitude, updated_at = NOW()
                WHERE {SWAP_WHERE}
                """
            )
            print(f"  APPLIED: swapped {cur.rowcount} rows in {table}")

    print(f"\nGrand total swapped rows: {grand_total}")
    if args.commit:
        con.commit()
        print("COMMITTED.")
    else:
        print("DRY-RUN ONLY. No changes written. Re-run with --commit to apply.")
    con.close()


if __name__ == "__main__":
    main()
