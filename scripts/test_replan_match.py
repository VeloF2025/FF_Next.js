#!/usr/bin/env python3
"""
Regression test for replan matching (scripts/qfield-recon/replan_match.py).

Guards the decisions that make a pole replan non-destructive. Each case below is a
bug that was actually produced while building this, measured against a scratch copy
of Thembisa POP 3:

  * 36 planted statuses lost because a reissued label was matched spatially to a
    NEARER neighbour instead of to itself.
  * 70 completed audits lost because poles north of the replan's coverage were
    treated as deleted rather than as never-exported.
  * 15 more audits lost in the 5..50 m band — too far to match, too near to count as
    out-of-area.

The load-bearing property is: a pole is deleted ONLY when the replan demonstrably
supersedes it. Anything else is retained, even at the cost of a larger table.

Run:  python3 scripts/test_replan_match.py   (no DB / MinIO / deps required)
Wired into CI via scripts/ci-local.sh.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qfield-sync"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qfield-recon"))
from replan_match import (  # noqa: E402
    CARRY_COLUMNS, decide, has_field_evidence, load_plan, metres, nearest,
)

_FAILURES = []


def check(label, ok):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        _FAILURES.append(label)


BASE_LAT, BASE_LON = -25.9800, 28.2300


def north(metres_north):
    """A latitude `metres_north` metres from BASE_LAT. 1 deg latitude ~ 111320 m."""
    return BASE_LAT + metres_north / 111_320.0


def pole(pid, label, lat, lon=BASE_LON, **field):
    row = {c: None for c in CARRY_COLUMNS}
    row.update({"id": pid, "pole_number": label, "latitude": lat, "longitude": lon})
    row["status"] = "planned"
    row.update(field)
    return row


def plan_pole(lat, zone=69, pon=821, lon=BASE_LON):
    return {"pon": pon, "zone": zone, "lon": lon, "lat": lat}


def photo(pid, label, zone=None, pon=None):
    return {"id": pid, "label": label, "zone": zone, "pon": pon}


def main():
    print("has_field_evidence:")
    check("a planned pole with nothing recorded has no evidence",
          not has_field_evidence(pole("p", "A", BASE_LAT)))
    check("a non-planned status counts as evidence",
          has_field_evidence(pole("p", "A", BASE_LAT, status="planted")))
    check("a completed audit counts as evidence",
          has_field_evidence(pole("p", "A", BASE_LAT, audit_complete="2026-02-11")))
    check("an empty list is not evidence",
          not has_field_evidence(pole("p", "A", BASE_LAT, images=[])))

    print("\nstatus is a PLANNING value, not evidence:")
    # poles.status DEFAULT is 'pending', not 'planned'. Treating 'pending' as evidence
    # made every unmatched pole retain, leaving both plans in the table at once.
    # 1,820 live rows sit in 'pending'; Themb'elihle alone is 1,808 of them.
    check("'pending' (the column DEFAULT) is not evidence",
          not has_field_evidence(pole("p", "A", BASE_LAT, status="pending")))
    check("'planned' is not evidence",
          not has_field_evidence(pole("p", "A", BASE_LAT, status="planned")))
    check("'installed' IS evidence",
          has_field_evidence(pole("p", "A", BASE_LAT, status="installed")))
    check("'failed_qa' IS evidence",
          has_field_evidence(pole("p", "A", BASE_LAT, status="failed_qa")))
    check("an explicit QA photo overrides a planning status",
          has_field_evidence(pole("p", "A", BASE_LAT, status="pending"), has_qa_photo=True))

    print("\nimport provenance is carried, but is NOT field evidence:")
    check("raw_data is in CARRY_COLUMNS", "raw_data" in CARRY_COLUMNS)
    check("raw_data alone does not make a pole look surveyed",
          not has_field_evidence(pole("p", "A", BASE_LAT, raw_data={"label (Pole)": "X"})))

    print("\nnearest:")
    items = [("N1", plan_pole(north(0)))]
    check("returns the label when inside the radius", nearest(items, BASE_LON, north(3), 5)[0] == "N1")
    check("returns no label when outside the radius",
          nearest(items, BASE_LON, north(30), 5)[0] is None)
    check("returns the distance even when outside the radius",
          abs(nearest(items, BASE_LON, north(30), 5)[1] - 30) < 1)
    check("no plan poles at all → (None, None)", nearest([], BASE_LON, BASE_LAT, 5) == (None, None))
    check("metres is symmetric",
          abs(metres(BASE_LON, north(0), BASE_LON, north(10))
              - metres(BASE_LON, north(10), BASE_LON, north(0))) < 1e-9)

    print("\nreissued label beats a nearer neighbour:")
    # SAME label 3 m away, and a DIFFERENT old pole 0 m away. The replan reissuing
    # 'KEEP' means 'KEEP' is that pole — its planted status must survive.
    #
    # ⚠️ OTHER is listed FIRST on purpose. The spatial pass takes the first old pole to
    # claim a new label, so with OTHER ahead of KEEP it wins 'KEEP' on distance (0 m vs
    # 3 m) unless the reissued-label rule pre-empts it. Ordered the other way round,
    # KEEP wins by iteration order alone and this case passes even with the rule
    # deleted — verified by mutation: it did.
    old = [pole("id-other", "OTHER", north(0), status="planted"),
           pole("id-keep", "KEEP", north(3), status="planted")]
    s = decide(old, [], {"KEEP": plan_pole(north(0))}, radius=5, coverage=50)
    check("the reissued label carries its OWN field state",
          s["carry"]["KEEP"]["id"] == "id-keep")
    check("the displaced neighbour is retained, not silently dropped",
          [o["id"] for o in s["retain"]] == ["id-other"])
    check("  ...because a crew had been there",
          s["retain_breakdown"] == {"unmatched_with_field_evidence": 1})

    print("\nretention rules:")
    plan = {"N1": plan_pole(north(0))}
    cases = [
        ("carried to a successor → deleted",
         pole("a", "OLD", north(2), status="planted"), []),
        ("outside coverage → retained even with no field work",
         pole("b", "FAR", north(500)), ["outside_replan_area"]),
        ("in the 5..50 m gap WITH field evidence → retained",
         pole("c", "GAP", north(20), audit_complete="2026-02-11"),
         ["unmatched_with_field_evidence"]),
        ("in the 5..50 m gap WITHOUT field evidence → deleted",
         pole("d", "GAP", north(20)), []),
        ("no coordinates and not in the plan → retained",
         pole("e", "NOGEO", None), ["outside_replan_area"]),
    ]
    for label, row, expected in cases:
        got = decide([row], [], plan, radius=5, coverage=50)
        check(label, sorted(got["retain_breakdown"]) == sorted(set(expected))
              and len(got["retain"]) == len(expected))

    print("\nNaN coordinates (present on live data) are treated as missing:")
    got = decide([pole("n", "NAN", float("nan"), float("nan"))], [], plan, 5, 50)
    check("a NaN latitude does not crash and the pole is retained",
          [o["id"] for o in got["retain"]] == ["n"])

    print("\nphoto follows its pole:")
    old = [pole("id-old", "OLD", north(0), status="planted")]
    plan = {"NEW": plan_pole(north(0), zone=69, pon=821)}
    s = decide(old, [photo("ph1", "OLD")], plan, radius=5, coverage=50)
    check("a photo on a relabelled pole is relabelled with the new zone/PON",
          s["relabel"] == [("ph1", "NEW", 69, 821)])

    s = decide(old, [photo("ph1", "NEW", zone=68, pon=820)], plan, radius=5, coverage=50)
    check("a photo already on a plan label is rezoned in place",
          s["rezone"] == [("ph1", 69, 821)])

    s = decide(old, [photo("ph1", "NEW", zone=69, pon=821)], plan, radius=5, coverage=50)
    check("a photo already carrying the right zone/PON is left alone",
          s["rezone"] == [] and s["relabel"] == [])

    print("\nphoto on a retained pole is kept, not superseded:")
    old = [pole("f", "FAR", north(500), status="planted")]
    s = decide(old, [photo("ph1", "FAR", zone=44, pon=531)], {"N1": plan_pole(north(0))}, 5, 50)
    check("counted as kept", [p["id"] for p in s["kept"]] == ["ph1"])
    check("not counted as superseded", s["superseded"] == [])

    print("\na QA photo is itself evidence a crew attended:")
    # Pole in the 5..50 m gap with every evidence COLUMN empty, but a QA photo row.
    # Before this rule it was deleted and its photo left pointing at nothing — which
    # re-creates the orphaned-photo defect this whole module exists to fix.
    old = [pole("g", "GONE", north(20))]
    plan1 = {"N1": plan_pole(north(0))}
    check("without a photo it is deletable",
          decide(old, [], plan1, 5, 50)["retain"] == [])
    s = decide(old, [photo("ph1", "GONE")], plan1, 5, 50)
    check("with a photo it is retained",
          [o["id"] for o in s["retain"]] == ["g"])
    check("  ...and the photo is kept, not superseded",
          [p["id"] for p in s["kept"]] == ["ph1"] and s["superseded"] == [])

    print("\ninvariant: a photo whose label matches a real pole is never superseded:")
    for lat, name in [(north(0), "pole on the plan spot"), (north(20), "pole in the gap"),
                      (north(500), "pole outside coverage"), (None, "pole with no coords")]:
        s = decide([pole("x", "P", lat)], [photo("ph", "P")], plan1, 5, 50)
        check(f"  {name}", s["superseded"] == [])

    print("\nrelabel collision is reported, never applied:")
    # A CARRIED pole is not retained (its state moves to its successor), so its photo
    # takes the relabel path. Here A's state moves to plan label X, so photo-on-A wants
    # to become X — but photo-on-X already occupies that label. UNIQUE
    # (project_id, pole_label) would abort the statement; this must be caught first.
    s = decide([pole("a", "A", north(0))], [photo("px", "X"), photo("pa", "A")],
               {"X": plan_pole(north(0))}, radius=5, coverage=50)
    check("the colliding pair is surfaced", s["collisions"] == [("A", "X")])
    check("and no relabel is emitted for it", all(r[0] != "pa" for r in s["relabel"]))

    print("\nsuperseded:")
    s = decide([], [photo("ph1", "Drop Pole")], plan1, 5, 50)
    check("a photo whose label matches no pole at all is superseded",
          [p["id"] for p in s["superseded"]] == ["ph1"])

    print("\nload_plan — GeoPackage ingestion boundary:")
    import sqlite3, struct, tempfile, os as _os

    def make_gpkg(rows):
        """Minimal GeoPackage: gpkg_contents + one point layer. Rows are (label, pon, zone, lon, lat)."""
        fd, p = tempfile.mkstemp(suffix=".gpkg"); _os.close(fd)
        db = sqlite3.connect(p)
        db.execute("CREATE TABLE gpkg_contents (table_name TEXT, data_type TEXT)")
        db.execute("INSERT INTO gpkg_contents VALUES ('Poles HLD','features')")
        db.execute('CREATE TABLE "Poles HLD" (label TEXT, pon_no, zone_no, geom BLOB)')
        for lab, pon, zone, lon, lat in rows:
            blob = None
            if lon is not None:
                # GP magic, version 0, flags=1 (little-endian, no envelope), srid, then WKB point.
                blob = b"GP" + bytes([0, 1]) + struct.pack("<i", 4326) \
                    + b"\x01" + struct.pack("<I", 1) + struct.pack("<dd", lon, lat)
            db.execute('INSERT INTO "Poles HLD" VALUES (?,?,?,?)', (lab, pon, zone, blob))
        db.commit(); db.close()
        return p

    p = make_gpkg([("A", 821, 69, 28.23, -25.98), ("B", "822", "69", 28.24, -25.99)])
    try:
        plan, skipped, dups = load_plan(p, "Poles HLD")
        check("parses labels and coordinates from geom", sorted(plan) == ["A", "B"])
        check("coerces numeric-looking text to int", plan["B"]["pon"] == 822 and plan["B"]["zone"] == 69)
        check("no false duplicates", dups == {})
        try:
            load_plan(p, 'Poles HLD" UNION SELECT sql,1,1,1 FROM sqlite_master --')
            check("rejects a layer name that escapes the identifier", False)
        except ValueError:
            check("rejects a layer name that escapes the identifier", True)
        try:
            load_plan(p, "No Such Layer")
            check("rejects an unknown layer", False)
        except ValueError:
            check("rejects an unknown layer", True)
    finally:
        _os.unlink(p)

    # The live replan really does this: TEM.P.M102 twice, ~28 m apart.
    p = make_gpkg([("A", 1, 1, 28.23, -25.98), ("A", 1, 1, 28.2303, -25.98),
                   ("C", 1, 1, 28.25, -25.98), (None, 1, 1, 28.26, -25.98),
                   ("D", 1, 1, None, None)])
    try:
        plan, skipped, dups = load_plan(p, "Poles HLD")
        check("a disagreeing duplicate label is REPORTED, not silently dropped", list(dups) == ["A"])
        check("  ...keeping the FIRST occurrence deterministically",
              abs(plan["A"]["lon"] - 28.23) < 1e-9)
        check("rows with no label or no geom are counted as skipped", skipped == 2)
        check("skipped rows do not reach the plan", sorted(plan) == ["A", "C"])
    finally:
        _os.unlink(p)

    p = make_gpkg([("A", 1, 1, 28.23, -25.98), ("A", 1, 1, 28.23, -25.98)])
    try:
        _, _, dups = load_plan(p, "Poles HLD")
        check("an IDENTICAL repeat is not reported as a conflict", dups == {})
    finally:
        _os.unlink(p)

    print()
    if _FAILURES:
        print(f"FAILED ({len(_FAILURES)}): {_FAILURES}")
        sys.exit(1)
    print("All replan-match checks passed.")


if __name__ == "__main__":
    main()
