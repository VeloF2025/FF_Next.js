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
import ast
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import qfield_project_registry
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


def duplicate_key_literals(path, dict_names):
    """{dict_name: [keys written more than once]} by reading the SOURCE, not the object.

    A duplicate key in a dict literal collapses to last-wins at PARSE time, before the
    module is importable — so `len(set(d)) == len(d)` on the loaded dict is a tautology
    that can never fail, and the second entry silently overwrites the first one's config.
    That is the most likely real mistake in this file: entries are built by copying a
    neighbouring block and editing it, and the comments here even warn against copying a
    neighbour's values. The AST keeps both keys, so scan that instead.
    """
    tree = ast.parse(open(path, encoding="utf-8").read())
    dupes = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Dict):
            continue
        for target in node.targets:
            if not (isinstance(target, ast.Name) and target.id in dict_names):
                continue
            seen, repeated = set(), []
            for k in node.value.keys:
                if not isinstance(k, ast.Constant):
                    continue  # **spread or computed key — not a literal we can compare
                if k.value in seen and k.value not in repeated:
                    repeated.append(k.value)
                seen.add(k.value)
            if repeated:
                dupes[target.id] = sorted(repeated)
    return dupes


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

    # NOT `len(set(PROJECTS)) == len(PROJECTS)` — that is a tautology. Python has already
    # collapsed any duplicate key by the time this module is imported, so the loaded dict
    # can never show one, while the duplicate has silently replaced the original entry's
    # ids/gpkg/table. Read the source instead, where both keys are still present.
    registry_src = qfield_project_registry.__file__
    dupes = duplicate_key_literals(
        registry_src, {"PROJECTS", "ALTERNATE_GPKGS", "OPTICAL_GPKGS"})
    check(not dupes,
          f"no duplicate key literals in the registry source (found: {dupes})")

    # An alias keyed on a name absent from PROJECTS is dead config — it never runs,
    # and reads as though that GPKG is covered when it is not.
    for label, alias_map in (("ALTERNATE_GPKGS", ALTERNATE_GPKGS),
                             ("OPTICAL_GPKGS", OPTICAL_GPKGS)):
        for name, cfg in alias_map.items():
            check(name in PROJECTS, f"{label}[{name!r}] refers to a registered project")
            for key in ("gpkg_path", "table_name", "label_col"):
                check(key in cfg and str(cfg[key]).strip() != "",
                      f"{label}[{name!r}]: has non-empty '{key}'")

    print()
    if failures:
        print(f"FAILED: {len(failures)} registry check(s) failed.")
        return 1
    print("All QField project-registry checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
