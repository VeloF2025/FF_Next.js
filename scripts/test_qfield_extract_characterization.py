#!/usr/bin/env python3
"""
Characterization tests for extract_project() — the safety net for its decomposition.

These assert what the function DOES today, not what it ideally would do. A failure
here after a refactor means observable behaviour changed; that is the signal.

Scope limit is deliberate and stated in qfield_extract_testkit: the DB is a stub, so
SQL validity against the live schema is NOT covered here — qfield_extract_golden.py
covers that by running the real statements against the real database. Read both
before trusting a green run.

Run: python3 scripts/test_qfield_extract_characterization.py
"""
import io
import os
import sys
from contextlib import redirect_stdout
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from qfield_extract_testkit import (  # noqa: E402
    OPTICAL_1, PRIMARY_QF, STEP_1, STEP_2, STEP_7, Harness, config, load_extractor,
)

MOD = load_extractor()
failures = []


def check(cond, label):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        failures.append(label)


def run(**kw):
    """Run one scenario with stdout captured; returns (found, upserted, out, harness)."""
    cfg = kw.pop("config", config())
    dry_run = kw.pop("dry_run", True)
    force = kw.pop("force", False)
    with Harness(MOD, **kw) as h:
        buf = io.StringIO()
        with redirect_stdout(buf):
            found, upserted = h.run(cfg, dry_run=dry_run, force=force)
        return found, upserted, buf.getvalue(), h


def main():
    print("Photo counting")
    found, upserted, _, _ = run(
        columns=["NAME", STEP_1, STEP_2],
        rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg", STEP_2: "DCIM/b.jpg"},
              {"NAME": "P2", STEP_1: "DCIM/c.jpg"}],
        dcim={"a.jpg": "k/a", "b.jpg": "k/b", "c.jpg": "k/c"})
    check((found, upserted) == (3, 3), f"3 resolvable photos across 2 poles -> (3,3), got ({found},{upserted})")

    found, upserted, out, h = run(
        columns=["NAME", STEP_1],
        rows=[{"NAME": "P1", STEP_1: "DCIM/missing.jpg"}],
        dcim={})
    check((found, upserted) == (1, 0), f"photo absent from MinIO -> found but not upserted, got ({found},{upserted})")
    check("SKIP (not in MinIO)" in out, "absent photo is reported, not silently dropped")
    # The other conditional stub. The interception-guard group cannot assert this one
    # (it only fires when the DCIM index is empty), so it is asserted here, in the
    # scenario that triggers it — mirroring what the spatial-PON scenarios do.
    check(h.stub_calls.get("minio_resolve_photo_version", 0) > 0,
          f"the per-photo fallback resolver was intercepted, "
          f"calls={h.stub_calls.get('minio_resolve_photo_version', 0)}")

    # Extra photo columns (EXTRA_PHOTO_PATTERNS — a photo column carrying no step
    # number) go through a SECOND loop with its own dedup and skip logic. Without a
    # scenario here, deleting that whole loop is invisible to this suite.
    found, upserted, _, h = run(
        columns=["NAME", STEP_7, "Pole Photo"],
        rows=[{"NAME": "P1", STEP_7: "DCIM/step.jpg", "Pole Photo": "DCIM/extra.jpg"}],
        dcim={"step.jpg": "k/s", "extra.jpg": "k/e"}, dry_run=False)
    check((found, upserted) == (2, 2), f"step + extra photo column both ingest, got ({found},{upserted})")
    inserts = [p for sql, p in h.cursor.executed if "INSERT INTO qfield_photo_validations" in sql]
    check(any(p[-2] is None and p[-1] is None for p in inserts),
          "the extra-column row is written with NULL checklist_step/step_label")

    # Interception guard. Every check above passes if the stubs ran; none of them
    # NOTICES if patching silently stopped working and the real MinIO/DB functions ran
    # instead — a green suite that tests nothing. The phases split moved these call
    # sites into another module, where the old single-module patch would have missed
    # them, so assert the stubs were genuinely invoked.
    print("\nInterception guard")
    _, _, _, h = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, dry_run=False)
    # Every stub invoked unconditionally on a real run. The two conditional ones
    # (resolve_spatial_pon_map, minio_resolve_photo_version) are asserted in the
    # scenarios that actually trigger them — asserting >0 here would fail spuriously.
    for stub in ("resolve_gpkg_path", "minio_download_latest",
                 "minio_list_dcim_directory", "sync_hierarchy",
                 "fetch_linked_qf_project_ids", "hierarchy_backfill_needed"):
        check(h.stub_calls.get(stub, 0) > 0,
              f"stub {stub} was actually invoked (patching intercepts), "
              f"calls={h.stub_calls.get(stub, 0)}")

    # Optical rows are written as joint/dome_joint instead of pole/pole_installation.
    # 7 registered projects have optical audits, and this mapping had NO coverage —
    # hardcoding it to the civil values passed every suite. Note dry_run cannot reach
    # it (the insert is short-circuited), so the golden --dry-run capture is
    # structurally blind here too; this scenario must run non-dry.
    found, upserted, _, h = run(
        columns=["NAME", OPTICAL_1, STEP_1],
        rows=[{"NAME": "P1", OPTICAL_1: "DCIM/dome.jpg", STEP_1: "DCIM/civil.jpg"}],
        dcim={"dome.jpg": "k/dome", "civil.jpg": "k/civil"}, dry_run=False)
    check((found, upserted) == (2, 2), f"optical + civil both ingest, got ({found},{upserted})")
    by_key = {p[1]: (p[3], p[4]) for sql, p in h.cursor.executed
              if "INSERT INTO qfield_photo_validations" in sql}
    check(by_key.get("k/dome") == ("joint", "dome_joint"),
          f"an optical photo is written as joint/dome_joint, got {by_key.get('k/dome')}")
    check(by_key.get("k/civil") == ("pole", "pole_installation"),
          f"a civil photo stays pole/pole_installation, got {by_key.get('k/civil')}")

    # The extra-column loop is a near-copy of the step-column loop, and coverage had
    # been written against the step copy only — a reviewer found the dedup checks
    # untested, and sweeping every guard in that loop found four more. Each guard below
    # fails independently if the extra-column copy loses it.
    print("\nExtra-column loop guards (the second, near-identical copy)")
    EX = "Pole Photo"
    found, upserted, _, _ = run(
        columns=["NAME", EX], rows=[{"NAME": "P1", EX: "DCIM/e.jpg"}],
        dcim={"e.jpg": "k/e"}, existing_keys=["k/e"])
    check((found, upserted) == (1, 0), f"extra: exact-key dedup, got ({found},{upserted})")

    found, upserted, _, _ = run(
        columns=["NAME", EX], rows=[{"NAME": "P1", EX: "DCIM/e.jpg"}],
        dcim={"e.jpg": "k/e"},
        existing_keys=["projects/x/files/DCIM/e.jpg/v20260101000000-deadbeef"])
    check((found, upserted) == (1, 0), f"extra: versioned-filename dedup, got ({found},{upserted})")

    found, upserted, _, _ = run(
        columns=["NAME", EX], rows=[{"NAME": "P1", EX: "DCIM/e.jpg"}],
        dcim={"e.jpg": "k/e"}, existing_photo_keys=["some/prefix/e.jpg"])
    check((found, upserted) == (1, 0), f"extra: construction_qa_photos dedup, got ({found},{upserted})")

    found, upserted, out, _ = run(
        columns=["NAME", EX], rows=[{"NAME": "P1", EX: "DCIM/gone.jpg"}], dcim={})
    check((found, upserted) == (1, 0), f"extra: absent photo not upserted, got ({found},{upserted})")
    check("SKIP (not in MinIO)" in out, "extra: absent photo is reported")

    _, _, _, h = run(
        columns=["NAME", EX], rows=[{"NAME": "P1", EX: "DCIM/e.jpg"}],
        dcim={"e.jpg": "k/e"}, dry_run=True)
    check(not h.cursor.ran("INSERT INTO qfield_photo_validations"),
          "extra: dry-run inserts nothing")

    print("\nRow-level skips")
    found, _, _, _ = run(
        columns=["NAME", STEP_1],
        rows=[{"NAME": None, STEP_1: "DCIM/a.jpg"},
              {"NAME": "   ", STEP_1: "DCIM/b.jpg"}],
        dcim={"a.jpg": "k/a", "b.jpg": "k/b"})
    check(found == 0, f"null and whitespace-only labels skip the whole row, got found={found}")

    print("\nDedup")
    found, upserted, _, _ = run(
        columns=["NAME", STEP_1],
        rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, existing_keys=["k/a"])
    check((found, upserted) == (1, 0), f"exact storage-key match dedups, got ({found},{upserted})")

    found, upserted, _, _ = run(
        columns=["NAME", STEP_1],
        rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"},
        existing_keys=["projects/x/files/DCIM/a.jpg/v20260101000000-deadbeef"])
    check((found, upserted) == (1, 0), f"versioned-key filename dedup, got ({found},{upserted})")

    found, upserted, _, _ = run(
        columns=["NAME", STEP_1],
        rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, existing_photo_keys=["some/prefix/a.jpg"])
    check((found, upserted) == (1, 0), f"construction_qa_photos substring dedup, got ({found},{upserted})")
    print("\nGuards — each must return (0,0) AND write no sync-state")
    found, upserted, out, h = run(
        config=config(label_col="MISSING_COL"),
        columns=["NAME", STEP_1],
        rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, dry_run=False)
    check((found, upserted) == (0, 0), f"missing label column -> (0,0), got ({found},{upserted})")
    check("no label column" in out, "missing label column is reported loudly")
    check(not h.cursor.ran("INSERT INTO qfield_gpkg_sync_state"),
          "missing label column writes NO sync-state (else the freeze looks freshly synced)")

    found, upserted, out, h = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, download_fails=True, dry_run=False)
    check((found, upserted) == (0, 0), f"download failure -> (0,0), got ({found},{upserted})")
    check("Could not download GPKG" in out, "download failure is reported")
    check(not h.cursor.ran("INSERT INTO qfield_gpkg_sync_state"),
          "download failure writes NO sync-state")

    found, upserted, out, h = run(
        columns=["NAME", "unrelated"],
        rows=[{"NAME": "P1", "unrelated": "x"}], dry_run=False)
    check((found, upserted) == (0, 0), f"no photo columns -> (0,0), got ({found},{upserted})")
    check(not h.cursor.ran("INSERT INTO qfield_gpkg_sync_state"),
          "no photo columns writes NO sync-state")

    found, upserted, out, h = run(
        config=config(table="nope"),
        columns=["NAME", "unrelated"], rows=[{"NAME": "P1", "unrelated": "x"}],
        dry_run=False)
    check((found, upserted) == (0, 0), f"table absent, no fallback -> (0,0), got ({found},{upserted})")
    check(not h.cursor.ran("INSERT INTO qfield_gpkg_sync_state"),
          "unresolvable table writes NO sync-state")
    # Counts alone cannot separate this from the no-photo-columns guard — the fixture
    # trips both. Assert on WHICH guard spoke, or removing the fallback branch passes.
    check("not found and no table has photo columns" in out,
          "the TABLE-not-found guard is what aborted (not the no-photo-columns one)")

    print("\nTable resolution")
    found, upserted, out, _ = run(
        config=config(table="CIVIL_AUDIT"),
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"})
    check((found, upserted) == (1, 1), f"case-insensitive table match resolves, got ({found},{upserted})")
    # Counts alone cannot tell these apart: with case-insensitive matching removed the
    # photo-column fallback still finds the same table and returns the same (1,1). Only
    # the announcement distinguishes which path ran, so assert on that too — otherwise
    # this scenario silently stops testing the thing it names.
    check("TABLE-FALLBACK" not in out,
          "case-insensitive match resolves directly, WITHOUT falling back")

    found, upserted, out, _ = run(
        config=config(table="renamed_away"),
        table="civil_audit_updated_27_07",
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"})
    check((found, upserted) == (1, 1), f"photo-column fallback finds renamed layer, got ({found},{upserted})")
    check("TABLE-FALLBACK" in out, "table fallback announces itself")

    print("\nNon-dry-run writes")
    found, upserted, _, h = run(
        columns=["NAME", STEP_1],
        rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}, {"NAME": "P2", STEP_1: "DCIM/gone.jpg"}],
        dcim={"a.jpg": "k/a"}, dry_run=False)
    check(h.cursor.ran("INSERT INTO qfield_photo_validations"), "a resolvable photo is inserted")
    check(h.cursor.ran("INSERT INTO qfield_gpkg_sync_state"), "sync-state is recorded")
    params = h.cursor.params_for("INSERT INTO qfield_gpkg_sync_state")
    check(params is not None and params[-1] == 1,
          f"pending_count records the 1 unresolved photo, got {params[-1] if params else None}")
    check(h.conn.committed, "the transaction is committed")

    check(len(h.hierarchy_calls) == 1,
          f"sync_hierarchy is invoked on a real run, got {len(h.hierarchy_calls)} call(s)")
    # Count alone lets a refactor reorder the call's positional arguments silently.
    # Pin the positions that carry meaning: (cur, conn, ff_id, rows, label_col,
    # config, spatial_pon_map).
    hargs = h.hierarchy_calls[0][0] if h.hierarchy_calls else ()
    check(len(hargs) == 7, f"sync_hierarchy receives 7 positional args, got {len(hargs)}")
    check(len(hargs) == 7 and hargs[2] == config()["ff_project_id"],
          "sync_hierarchy arg 3 is the FibreFlow project id")
    check(len(hargs) == 7 and isinstance(hargs[3], list),
          "sync_hierarchy arg 4 is the GPKG rows list")
    check(len(hargs) == 7 and hargs[4] == "NAME",
          f"sync_hierarchy arg 5 is the label column, got {hargs[4] if len(hargs) == 7 else None}")
    check(len(hargs) == 7 and isinstance(hargs[5], dict) and "table_name" in hargs[5],
          "sync_hierarchy arg 6 is the project config")

    _, _, _, h = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, dry_run=True)
    check(not h.cursor.ran("INSERT INTO qfield_photo_validations"), "dry-run inserts nothing")
    check(h.hierarchy_calls == [], "dry-run does not invoke sync_hierarchy")
    check(not h.cursor.ran("INSERT INTO qfield_gpkg_sync_state"), "dry-run records no sync-state")
    check(not h.conn.committed, "dry-run does not commit")

    print("\nSuperseded-path retirement")
    _, _, _, h = run(
        config=config(gpkg_path="Civil audit.gpkg"),
        gpkg_path="Civil audit updated_27_07.gpkg",
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, dry_run=False)
    check(h.cursor.ran("DELETE FROM qfield_gpkg_sync_state"),
          "a followed rename retires the superseded sync-state row")

    print()
    if failures:
        print(f"FAILED: {len(failures)} characterization check(s) failed.")
        return 1
    print("All extract_project characterization checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
