#!/usr/bin/env python3
"""Regression tests for QField audit hierarchy extraction.

Run: python3 scripts/test_qfield_hierarchy.py
Wired into CI via scripts/ci-local.sh.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qfield_hierarchy import resolve_hierarchy  # noqa: E402

_FAILURES = []


def check(label, condition):
    print(("  PASS" if condition else "  FAIL") + f"  {label}")
    if not condition:
        _FAILURES.append(label)


def main():
    print("Existing FibreFlow forms:")
    check(
        "direct zone_no/pon_no stays supported",
        resolve_hierarchy(
            {"zone_no": "7", "pon_no": "30,035"},
            label="LAW.P.A001",
        ) == (30, 7),
    )
    check(
        "Tonga BL fallback stays supported",
        resolve_hierarchy(
            {"BL": "VTN_TOG_Z0A_B048"},
            label="VTN.P.A001",
        ) == (48, 1),
    )

    print("HT Namakgale form:")
    namakgale = {"NAME": "HT_PABA3_0001PL", "PON": "01", "Phase": "Phase 1"}
    check(
        "uppercase PON maps to pon_no and Phase maps to zone_no",
        resolve_hierarchy(
            namakgale,
            label=namakgale["NAME"],
            pon_col="PON",
            zone_col="Phase",
        ) == (1, 1),
    )

    print("HT Mahikeng form:")
    mahikeng = {"Name": "HT_MFKGP4_D0001PL", "Phase": "Phase 3"}
    spatial = {"HT_MFKGP4_D0001PL": {"pon": 24, "zone": None}}
    check(
        "Phase maps to zone and the verified spatial design map supplies PON",
        resolve_hierarchy(
            mahikeng,
            label=mahikeng["Name"],
            zone_col="Phase",
            spatial_pon_map=spatial,
        ) == (24, 3),
    )
    check(
        "Mahikeng still gets a zone when the spatial resolver is unavailable",
        resolve_hierarchy(
            mahikeng,
            label=mahikeng["Name"],
            zone_col="Phase",
        ) == (None, 3),
    )
    check(
        "a direct audit PON wins over a stale spatial fallback",
        resolve_hierarchy(
            {"Name": "HT_X", "PON": "09", "Phase": "Phase 2"},
            label="HT_X",
            pon_col="PON",
            zone_col="Phase",
            spatial_pon_map={"HT_X": {"pon": 99, "zone": "8"}},
        ) == (9, 2),
    )
    check(
        "invalid hierarchy values stay unassigned",
        resolve_hierarchy(
            {"PON": "unknown", "Phase": "Phase X"},
            label="HT_BAD",
            pon_col="PON",
            zone_col="Phase",
        ) == (None, None),
    )

    print()
    if _FAILURES:
        print(f"FAILED ({len(_FAILURES)}): {_FAILURES}")
        sys.exit(1)
    print("All hierarchy checks passed.")


if __name__ == "__main__":
    main()
