#!/usr/bin/env python3
"""
Structural validation of the QField ingestion allow-list (qfield_project_registry).

Why this exists: a malformed PROJECTS entry does not raise. The extractor's guard
(`label_col not in columns`) refuses to write sync-state and prints an ERROR, so
nothing is corrupted — but nothing is ingested either, and the only external symptom
is an EXTRACT-GAP alert that appears once upstream photos cross the threshold. A typo
can therefore sit unnoticed for as long as the crew takes to shoot 20 photos.

What this CAN check, offline and deterministically: that every entry is
well-formed and internally consistent — required keys, UUID shape, no duplicate
project ids, no aliases pointing at unknown projects, no blank label columns.

What this CANNOT check: whether label_col/table_name match the live GPKG. That is
inherently empirical (the file lives in MinIO and the crew can rename it), and is
verified by running `extract-gpkg-photos.py --project <name> --dry-run` before
merging a new entry. This test deliberately does not fake that with a stale fixture.

Run: python3 scripts/test_qfield_project_registry.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from qfield_project_registry import ALTERNATE_GPKGS, OPTICAL_GPKGS, PROJECTS

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
REQUIRED = ("qf_project_id", "ff_project_id", "gpkg_path", "table_name", "label_col")
OPTIONAL = ("pon_col", "zone_col", "spatial_pon")

failures = []


def check(condition, label):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}")
        failures.append(label)


def main():
    check(len(PROJECTS) > 0, "registry is non-empty")

    for name, cfg in PROJECTS.items():
        for key in REQUIRED:
            check(key in cfg, f"{name}: has required key '{key}'")
        for key in cfg:
            check(key in REQUIRED + OPTIONAL, f"{name}: key '{key}' is a known key")

        for key in ("qf_project_id", "ff_project_id"):
            val = cfg.get(key, "")
            check(bool(UUID_RE.match(str(val))), f"{name}: {key} is a well-formed UUID")

        # A blank/whitespace label_col silently matches no column and ingests nothing.
        for key in ("gpkg_path", "table_name", "label_col"):
            val = cfg.get(key, "")
            check(isinstance(val, str) and val.strip() == val and val != "",
                  f"{name}: {key} is a non-empty, untrimmed-clean string")

        # gpkg_path is a filename, not a path — resolve_gpkg_path() joins it itself.
        check("/" not in str(cfg.get("gpkg_path", "")),
              f"{name}: gpkg_path is a bare filename, not a path")

        if "spatial_pon" in cfg:
            check(isinstance(cfg["spatial_pon"], bool),
                  f"{name}: spatial_pon is a bool")

    # Duplicate ids would make two entries fight over the same project; last-wins is
    # silent, so assert uniqueness rather than relying on review to spot a paste.
    for key in ("qf_project_id", "ff_project_id"):
        vals = [c[key] for c in PROJECTS.values() if key in c]
        dupes = {v for v in vals if vals.count(v) > 1}
        check(not dupes, f"no duplicate {key} across entries (dupes: {sorted(dupes)})")

    check(len(set(PROJECTS.keys())) == len(PROJECTS), "project names are unique")

    # An alias keyed on a name absent from PROJECTS is dead config — it never runs,
    # and reads as though that GPKG is covered when it is not.
    for label, alias_map in (("ALTERNATE_GPKGS", ALTERNATE_GPKGS),
                             ("OPTICAL_GPKGS", OPTICAL_GPKGS)):
        for name, cfg in alias_map.items():
            check(name in PROJECTS, f"{label}['{name}'] refers to a registered project")
            for key in ("gpkg_path", "table_name", "label_col"):
                check(key in cfg and str(cfg[key]).strip() != "",
                      f"{label}['{name}']: has non-empty '{key}'")

    print()
    if failures:
        print(f"FAILED: {len(failures)} registry check(s) failed.")
        return 1
    print("All QField project-registry checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
