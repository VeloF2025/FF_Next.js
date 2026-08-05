#!/usr/bin/env python3
"""Pure matching logic for a pole replan: which old pole is which new pole.

No database, no network, no I/O beyond reading a GeoPackage file. Everything here is
a function of its arguments, so the decisions a replan import makes can be tested
without a Postgres or a MinIO. import_replan_poles.py supplies the rows and executes
the result.

The problem: a replan re-issues a whole project under new labels, so matching old to
new BY LABEL is meaningless — on Thembisa POP 3 only 138 of 3,594 labels survive.
Matching by POSITION is what works; 1,287 poles are the same physical pole under a
different label. But position alone is not enough either, because "the replan has
nothing near this pole" has two very different causes (retired vs never exported),
and only one of them justifies deleting field work. See retain_reason().
"""
import math
import os
import sqlite3
import sys

# Resolved here rather than left to the caller: this module is imported by the CLI, by
# replan_write and by two test suites, and relying on whichever of them happens to set
# sys.path first makes the import order load-bearing.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "qfield-sync"))
from read_gpkg import decode_gpkg_geometry  # noqa: E402

# Written from the GeoPackage on every run. Everything else on a new row keeps its
# column default.
PLAN_COLUMNS = ("pole_number", "project_id", "latitude", "longitude", "zone_no", "pon_no", "source")

# Field-collected state. Carried from the old pole to the new pole occupying the same
# position. Losing these is the difference between "replanned" and "re-surveyed" —
# on Thembisa POP 3 that is 196 poles with a non-planned status and 70 completed audits.
CARRY_COLUMNS = (
    "status", "installation_date", "notes", "images", "inspection_data", "metadata",
    "dome_joint", "type_of_join", "splitter", "slack_on_pole", "field_agent",
    "pole_planted", "audit_complete", "field_status", "field_status_synced_at",
    "created_by",
    # Import provenance (the original source row: label, pon, zone, planned lat/lon).
    # Empty on Thembisa POP 3, but populated on 11,822 poles across Mohadin (5,393),
    # Lawley (4,471) and Mamelodi (1,958) — the projects this tool is meant to serve
    # next. Carried, but deliberately NOT field evidence below: it proves a row was
    # imported, not that a crew stood at the pole. Treating it as evidence would
    # retain almost every Mohadin pole and defeat the replan entirely.
    "raw_data",
)

# A pole's status alone never proves a crew attended. `poles.status` DEFAULT is
# 'pending' (not 'planned'), so a project seeded straight from an import sits entirely
# in 'pending' — 1,820 rows live, of which Themb'elihle is 1,808. Treating 'pending' as
# evidence made every unmatched pole "retain", which fails safe for deletion but leaves
# both plans in the table at once: duplicate physical poles under two labels, QA split
# across them. That is the exact ambiguity a replan exists to remove.
PLANNING_STATUSES = (None, "planned", "pending")

# Evidence that a crew has physically been to this pole. A pole carrying any of these
# is never deleted unless its state was carried to a successor — see retain_reason().
# `status` is excluded: every row has one, and 'planned' is the plan's own default, so
# it is tested separately.
FIELD_EVIDENCE_COLUMNS = (
    "installation_date", "images", "inspection_data", "dome_joint", "type_of_join",
    "splitter", "slack_on_pole", "field_agent", "pole_planted", "audit_complete",
    "field_status",
)


def has_field_evidence(row, has_qa_photo=False):
    """Did a crew physically attend this pole?

    `has_qa_photo` is passed in rather than derived here: a QA photo row is the most
    direct evidence of attendance there is, and none of the columns on `poles` imply
    it. No live pole is currently deletable-yet-photographed (verified 0 DB-wide), so
    this is defence in depth — that 0 holds by the shape of today's data, not by
    construction, and a pole photographed before any status sync would otherwise be
    eligible for deletion.
    """
    if has_qa_photo:
        return True
    if row.get("status") not in PLANNING_STATUSES:
        return True
    return any(row.get(c) not in (None, "", [], {}) for c in FIELD_EVIDENCE_COLUMNS)


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def layer_names(path):
    """Layers the GeoPackage declares, per the spec's own registry."""
    db = sqlite3.connect(path)
    try:
        return [r[0] for r in db.execute("SELECT table_name FROM gpkg_contents ORDER BY table_name")]
    finally:
        db.close()


def load_plan(path, layer):
    """(plan, skipped, duplicates) where plan is label -> {pon, zone, lat, lon}.

    Coordinates come from geom, never from the latitude/longitude attribute columns —
    those are unreliable in these exports.

    `layer` is validated against gpkg_contents rather than interpolated blind: it lands
    inside a quoted SQL identifier, and a value containing a double-quote escapes the
    identifier. sqlite3 refuses stacked statements, so this was never RCE, but a
    crafted name could still UNION arbitrary rows out of the file — and the layer name
    is exactly the kind of value a future caller derives from an upload rather than
    typing by hand.

    Duplicate labels are RETURNED, not silently collapsed. A plain `plan[label] = ...`
    keeps whichever row SQLite happened to return last and reports a pole count that
    conceals the loss. The current live replan contains one such pair — TEM.P.M102
    twice, ~28 m apart — which is far enough to change which old pole matches it.
    """
    valid = layer_names(path)
    if layer not in valid:
        raise ValueError(f"layer {layer!r} not in this GeoPackage. Available: {', '.join(valid)}")
    db = sqlite3.connect(path)
    try:
        rows = db.execute(f'SELECT label, pon_no, zone_no, geom FROM "{layer}"').fetchall()
    finally:
        db.close()
    plan, skipped, duplicates = {}, 0, {}
    for label, pon, zone, blob in rows:
        geom = decode_gpkg_geometry(blob) if blob else None
        coords = (geom or {}).get("coordinates")
        if not label or not coords:
            skipped += 1
            continue
        key = label.strip()
        entry = {"pon": _int(pon), "zone": _int(zone), "lon": coords[0], "lat": coords[1]}
        if key in plan:
            # Only a real disagreement matters; a byte-identical repeat is harmless.
            if plan[key] != entry:
                duplicates.setdefault(key, [plan[key]]).append(entry)
            continue          # keep the FIRST, deterministically
        plan[key] = entry
    return plan, skipped, duplicates


def metres(lon1, lat1, lon2, lat2):
    """Equirectangular approximation. Exact enough at the <=50 m scale this decides on."""
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * k, lat2 - lat1) * 111_320


def nearest(plan_items, lon, lat, radius):
    """(label within radius or None, distance to the closest plan pole or None).

    The distance is returned even when it exceeds the radius — retain_reason() needs
    to tell "just outside the match radius" from "nowhere near the replan at all".
    """
    best, best_d = None, None
    for label, p in plan_items:
        d = metres(lon, lat, p["lon"], p["lat"])
        if best_d is None or d < best_d:
            best, best_d = label, d
    return (best, best_d) if best_d is not None and best_d <= radius else (None, best_d)


def coords_of(row):
    """(lon, lat) from a poles row, or None. NaN is present in this column on live data."""
    if row["latitude"] is None or row["longitude"] is None:
        return None
    lat, lon = float(row["latitude"]), float(row["longitude"])
    if math.isnan(lat) or math.isnan(lon):
        return None
    return lon, lat


def retain_reason(o, plan, carried_ids, dist_by_id, coverage, photo_labels=frozenset()):
    """Why this old pole must survive the replace, or None if it may be deleted.

    Deleting is only safe when the replan demonstrably supersedes the pole. It does
    that in exactly two ways: it reissues the same label (the row is rewritten in
    place), or it puts a new pole on the same spot and the field state moves there.
    Anything else is the replan being SILENT about the pole, which is not the same as
    the replan retiring it.

    Two ways it can be silent:
      * Out of area. The Thembisa POP 3 replan stops at latitude -25.97572; 74 poles
        sit north of that line. They are not deleted poles, they are unexported ones.
      * In area but unmatched — the 5..50 m band. A pole 12 m from the nearest new
        pole is too far to be called the same pole, too close to be called outside the
        area. Falling through that gap cost 15 completed audits in an early run of
        this script against a scratch copy. If a crew has been there, keep it.
    """
    if o["pole_number"] in plan:
        return None                      # replaced in place, same label
    if o["id"] in carried_ids:
        return None                      # field state moves to its successor
    dist = dist_by_id.get(o["id"])
    if dist is None or dist > coverage:
        return "outside_replan_area"
    if has_field_evidence(o, o["pole_number"] in photo_labels):
        return "unmatched_with_field_evidence"
    return None


def decide(old, photos, plan, radius, coverage):
    """Work out every change the import will make, without making any of them.

    `old`    : poles rows as dicts (id, pole_number, latitude, longitude, *CARRY_COLUMNS)
    `photos` : pole_qa_photos rows as dicts (id, label, zone, pon)
    `plan`   : output of load_plan()
    """
    items = list(plan.items())
    old_by_label = {o["pole_number"]: o for o in old}

    # Pass 1a: a label the replan REISSUES is the same pole by definition. It takes
    # precedence over any spatial candidate — otherwise a survivor whose position
    # drifted a metre loses its field state to whichever neighbour happens to sit
    # closest, and its own row is deleted as "replaced in place". That cost 36 planted
    # statuses in an early run of this script against a scratch copy.
    carry = {label: old_by_label[label] for label in plan if label in old_by_label}

    # Pass 1b: everything else matches on position. First old pole wins a given new
    # label — two old poles within `radius` of one new pole is a merge in the design,
    # and there is no basis here for preferring the second. The loser is not dropped:
    # retain_reason() keeps it if a crew has been there.
    dist_by_id = {}
    for o in old:
        coords = coords_of(o)
        if coords is None:
            continue
        new_label, dist = nearest(items, coords[0], coords[1], radius)
        dist_by_id[o["id"]] = dist
        if new_label and new_label not in carry:
            carry[new_label] = o

    # Pass 2: decide what NOT to delete.
    carried_ids = {o["id"] for o in carry.values()}
    photo_labels = {p["label"] for p in photos if p["label"]}
    reasons = {o["id"]: retain_reason(o, plan, carried_ids, dist_by_id, coverage, photo_labels)
               for o in old}
    retain = [o for o in old if reasons[o["id"]]]
    breakdown = {}
    for r in reasons.values():
        if r:
            breakdown[r] = breakdown.get(r, 0) + 1

    # Pass 3: follow each QA photo to wherever its pole ended up.
    retained_labels = {o["pole_number"] for o in retain}
    taken = {p["label"] for p in photos}
    relabel, rezone, superseded, collisions, kept = [], [], [], [], []
    for ph in photos:
        if ph["label"] in plan:
            p = plan[ph["label"]]
            if (ph["zone"], ph["pon"]) != (p["zone"], p["pon"]):
                rezone.append((ph["id"], p["zone"], p["pon"]))
            continue
        if ph["label"] in retained_labels:
            # Its pole survives untouched, so the photo does too — same label, same
            # zone. Counting this as superseded would understate what still works.
            kept.append(ph)
            continue
        o = old_by_label.get(ph["label"])
        coords = coords_of(o) if o else None
        if coords is None:
            superseded.append(ph)
            continue
        new_label, _ = nearest(items, coords[0], coords[1], radius)
        if not new_label:
            superseded.append(ph)
        elif new_label in taken:
            # (project_id, pole_label) is UNIQUE — relabelling onto an occupied label
            # would abort the statement. Report it instead of guessing which wins.
            collisions.append((ph["label"], new_label))
        else:
            taken.discard(ph["label"])
            taken.add(new_label)
            p = plan[new_label]
            relabel.append((ph["id"], new_label, p["zone"], p["pon"]))

    return {"old": old, "photos": photos, "carry": carry, "relabel": relabel,
            "rezone": rezone, "superseded": superseded, "collisions": collisions,
            "retain": retain, "kept": kept, "retain_breakdown": breakdown}
