#!/usr/bin/env python3
"""
Characterization tests for extract_project()'s RUN DECISIONS.

Split out of test_qfield_extract_characterization.py when that file reached the
300-line limit. The seam: everything here answers "should this project be processed
at all, and with what context" — the delta check (migration-423 pending/stale/backfill
logic) and spatial-PON resolution. The parent file covers what actually gets ingested
once that decision is yes.

Same harness and conventions, same DELIBERATE LIMIT (stub DB — see
qfield_extract_testkit). Run: python3 scripts/test_qfield_extract_run_decisions.py
"""
import io
import os
import sys
from contextlib import redirect_stdout
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from qfield_extract_testkit import (  # noqa: E402
    STEP_1, Harness, config, load_extractor,
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
    same = "v20260731122829-abc12345"

    print("\nSpatial PON resolution")
    SPATIAL = {"P1": "PON-7"}
    _, _, _, h = run(
        config=config(spatial_pon=True),
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, spatial_pon_map=SPATIAL, dry_run=False)
    check(h.stub_calls.get("resolve_spatial_pon_map", 0) == 1,
          f"spatial_pon=True resolves the map once, got {h.stub_calls.get('resolve_spatial_pon_map', 0)}")
    check(h.hierarchy_calls and h.hierarchy_calls[0][0][6] == SPATIAL,
          "the resolved map is passed through to sync_hierarchy, not dropped")

    _, _, _, h = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, spatial_pon_map=SPATIAL, dry_run=False)
    check(h.stub_calls.get("resolve_spatial_pon_map", 0) == 0,
          "without spatial_pon the resolver is NOT called (it costs a subprocess)")
    check(h.hierarchy_calls and h.hierarchy_calls[0][0][6] == {},
          "and sync_hierarchy receives an empty map")

    print("\nDelta check")
    same = "v20260731122829-abc12345"
    found, upserted, out, _ = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, version=same,
        state={"last_version": same, "pending_count": 0})
    check((found, upserted) == (0, 0), f"unchanged version, 0 pending -> skip, got ({found},{upserted})")
    check("Already processed this version" in out, "delta skip states its reason")

    found, upserted, out, _ = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, version=same,
        state={"last_version": same, "pending_count": 0}, force=True)
    check((found, upserted) == (1, 1), f"--force overrides the delta skip, got ({found},{upserted})")

    # The pending/stale/backfill variants are migration-423 logic: photo binaries
    # arrive asynchronously after the GPKG, so an unchanged GPKG must be re-scanned
    # while photos are still outstanding — but not forever. Only the pending==0 branch
    # was covered before; each of the three below fails independently.
    recent = f"v{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-recent01"
    found, upserted, out, _ = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, version=recent,
        state={"last_version": recent, "pending_count": 3})
    check((found, upserted) == (1, 1),
          f"same version but photos still pending -> RE-SCAN, got ({found},{upserted})")
    check("RE-SCAN" in out, "the re-scan announces why it is re-reading an unchanged GPKG")

    ancient = "v20200101000000-ancient1"
    found, upserted, out, _ = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, version=ancient,
        state={"last_version": ancient, "pending_count": 3})
    check((found, upserted) == (0, 0),
          f"pending photos on a long-stale GPKG -> give up, got ({found},{upserted})")
    check("giving up" in out, "the give-up path says so rather than skipping silently")

    found, upserted, out, _ = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, version=same,
        state={"last_version": same, "pending_count": 0}, hierarchy_backfill=True)
    check((found, upserted) == (1, 1),
          f"a pending hierarchy backfill forces a re-scan, got ({found},{upserted})")
    check("hierarchy backfill" in out, "the backfill re-scan states its reason")

    print()
    if failures:
        print(f"FAILED: {len(failures)} run-decision check(s) failed.")
        return 1
    print("All run-decision characterization checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
