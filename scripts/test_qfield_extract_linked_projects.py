#!/usr/bin/env python3
"""
Characterization tests for the LINKED-QField-project paths of extract_project().

Split out of test_qfield_extract_characterization.py when that file reached the
300-line limit. This is the natural seam: photos for one FibreFlow project can live
in a second ("audit") QField project's bucket, and the merge/dedup that makes that
work is the code most likely to pile up duplicate rows if a refactor gets it wrong —
its own comment in the extractor says so.

Same harness, same conventions, same DELIBERATE LIMIT (stub DB — see
qfield_extract_testkit). Run: python3 scripts/test_qfield_extract_linked_projects.py
"""
import io
import os
import sys
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from qfield_extract_testkit import (  # noqa: E402
    PRIMARY_QF, STEP_1, STEP_2, Harness, config, load_extractor,
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

    # Linked "audit" QField projects: photos for one FibreFlow project can live in a
    # second QField project's bucket. The merge and its dedup consequences are the
    # code most likely to pile up duplicate rows if a refactor gets it wrong, and its
    # own comment says so — so each behaviour is asserted separately.
    print("\nLinked QField projects")
    LINKED = "cccccccc-1111-2222-3333-444444444444"
    found, upserted, out, h = run(
        columns=["NAME", STEP_1, STEP_2],
        rows=[{"NAME": "P1", STEP_1: "DCIM/only_primary.jpg", STEP_2: "DCIM/only_linked.jpg"}],
        dcim={"only_primary.jpg": "k/primary"},
        linked=[LINKED], linked_dcim={LINKED: {"only_linked.jpg": "k/linked"}},
        dry_run=False)
    check((found, upserted) == (2, 2),
          f"a photo living in a LINKED project still resolves, got ({found},{upserted})")
    inserts = [p for sql, p in h.cursor.executed if "INSERT INTO qfield_photo_validations" in sql]
    # EXACT per-photo attribution, not `any(... == LINKED)`. An "at least one insert
    # mentions LINKED" check passes even when EVERY photo is misattributed to the
    # linked project — the same "reads as testing attribution, only tests presence"
    # shape this scenario was written to prevent. Map storage_key -> project_id and
    # pin both directions.
    by_key = {p[1]: p[5] for p in inserts}
    check(by_key.get("k/primary") == PRIMARY_QF,
          f"the PRIMARY photo stays attributed to the primary project, got {by_key.get('k/primary')}")
    check(by_key.get("k/linked") == LINKED,
          f"the LINKED photo is attributed to the project that holds it, got {by_key.get('k/linked')}")

    found, upserted, _, h = run(
        columns=["NAME", STEP_1],
        rows=[{"NAME": "P1", STEP_1: "DCIM/dupe.jpg"}],
        dcim={"dupe.jpg": "k/PRIMARY"},
        linked=[LINKED], linked_dcim={LINKED: {"dupe.jpg": "k/LINKED"}},
        dry_run=False)
    inserts = [p for sql, p in h.cursor.executed if "INSERT INTO qfield_photo_validations" in sql]
    check(len(inserts) == 1 and inserts[0][1] == "k/PRIMARY",
          "on a filename collision the PRIMARY project wins, keeping re-runs stable")
    check(len(inserts) == 1 and inserts[0][5] == PRIMARY_QF,
          f"...and it is attributed to the primary project, got {inserts[0][5] if inserts else None}")

    _, _, _, h = run(
        columns=["NAME", STEP_1], rows=[{"NAME": "P1", STEP_1: "DCIM/a.jpg"}],
        dcim={"a.jpg": "k/a"}, linked=[LINKED], dry_run=False)
    params = h.cursor.params_for("SELECT photo_key FROM qfield_photo_validations")
    check(params is not None and LINKED in params[0],
          "the dedup query spans linked projects (else re-runs duplicate rows daily)")


    print()
    if failures:
        print(f"FAILED: {len(failures)} linked-project check(s) failed.")
        return 1
    print("All linked-project characterization checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
