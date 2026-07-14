#!/usr/bin/env python3
"""
Regression test for extract-gpkg-photos.py step-column detection.

Guards the number-agnostic fallback (STEP_PATTERNS_GENERIC) that lets the HT_
civil-audit form — which prefixes "1. Permission Slip Photo" and shifts every
real step number by +1 — map to the same civil steps as the FT form, without
regressing FT detection or picking up the un-numbered optical "Photo*" columns.

Run:  python3 scripts/test_extract_gpkg_step_detection.py
(No DB required; loads only the pure detection function.)
"""
import importlib.util
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SPEC = importlib.util.spec_from_file_location(
    "extract_gpkg_photos", os.path.join(_HERE, "extract-gpkg-photos.py")
)
_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_mod)
detect_step_columns = _mod.detect_step_columns

# ── Real column sets (verified against MinIO GPKGs 2026-07-14) ────────────────

# FT form (Tonga / Lawley / Etwatwa / Thembisa POP1): numbered 1-8.
FT_COLUMNS = [
    "Pole Label", "label", "label_1",
    "1. Before Photo - Mark out the ground with a circle/Square or X",
    "2. During Photo – Add compaction photo if needed, or a photo of the staff digging the hole for the pole.",
    "3. Depth Photo – Clearly show the measuring tape in the hole with spade/Stick showing the depth mark.",
    "4. End plates to be visible and clear.",
    "5. Compaction and backfill mixed and a clear photo showing compaction in progress.",
    "6. Level against pole - Clearly showing a spirit level against the pole ensuring the pole is level.",
    "7. After photo – Ensure you take a picture of the pole close to the ground and a photo standing back.",
    "8. Clear Photo of Pole Label",
    # Etwatwa variant with no space after the dot:
    "1.Before Photo - Mark out the ground with a circle/Square or X",
    # Mohadin variants: Afrikaans "Foto" at step 8, plus an extra "9. SJC Label"
    # numbered column that is NOT a checklist step and must be excluded.
    "8. Clear Foto of Pole Label",
    "9. SJC Label",
    # Un-numbered optical columns — must NOT be detected as civil steps:
    "PhotoJoint", "PhotoLabel", "PhotoSlack", "Label Installed Date",
]

# HT form (Mahikeng): "1. Permission Slip Photo" shifts real steps to 2-9.
HT_COLUMNS = [
    "Name", "Lable", "Pole_ID", "Status", "QA Civil Comments",
    "1. Permission Slip Photo",
    "2. Before Photo - Mark out the ground with a circle/Square or X",
    "3. During Photo – Add compaction photo if needed, or a photo of the staff digging the hole for the pole.",
    "4. Depth Photo – Clearly show the measuring tape in the hole with spade/Stick showing the depth mark.",
    "5. End plates to be visible and clear.",
    "6. Compaction and backfill mixed and a clear photo showing compaction in progress.",
    "7. Level against pole - Clearly showing a spirit level against the pole ensuring the pole is level.",
    "8. After photo – Ensure you take a picture of the pole close to the ground and a photo standing back.",
    "9. Clear Photo of Pole Label",
]

_FAILURES = []


def _steps_by_number(step_cols):
    """{col -> (step,label,disc)}  ->  {step_number: discipline}."""
    return {meta[0]: meta[2] for meta in step_cols.values()}


def check(name, cond):
    print(("  PASS" if cond else "  FAIL") + f"  {name}")
    if not cond:
        _FAILURES.append(name)


def main():
    print("FT form (numbered 1-8):")
    ft_steps, ft_extra = detect_step_columns(FT_COLUMNS)
    ft_by_num = _steps_by_number(ft_steps)
    check("FT detects exactly 8 civil steps", sorted(ft_by_num) == [1, 2, 3, 4, 5, 6, 7, 8])
    check("FT all civil discipline", all(d == "civil" for d in ft_by_num.values()))
    check("FT 'PhotoLabel' NOT a step", "PhotoLabel" not in ft_steps)
    check("FT 'PhotoJoint' NOT a step", "PhotoJoint" not in ft_steps)
    check("FT 'PhotoSlack' NOT a step", "PhotoSlack" not in ft_steps)
    check("FT 'Pole Label' label-col not a step", "Pole Label" not in ft_steps)
    check("FT '1.Before' (no space) detected as step 1",
          any(c.startswith("1.Before") and m[0] == 1 for c, m in ft_steps.items()))
    check("FT 'Clear Foto' (Afrikaans) -> step 8", ft_steps.get("8. Clear Foto of Pole Label", (0,))[0] == 8)
    check("FT '9. SJC Label' NOT a step", "9. SJC Label" not in ft_steps)

    print("HT form (shifted 2-9, permission-slip prefix):")
    ht_steps, ht_extra = detect_step_columns(HT_COLUMNS)
    ht_by_num = _steps_by_number(ht_steps)
    check("HT detects exactly 8 civil steps", sorted(ht_by_num) == [1, 2, 3, 4, 5, 6, 7, 8])
    check("HT all civil discipline", all(d == "civil" for d in ht_by_num.values()))
    check("HT 'Permission Slip Photo' NOT a step", "1. Permission Slip Photo" not in ht_steps)
    check("HT 'Before Photo' -> step 1",
          ht_steps.get("2. Before Photo - Mark out the ground with a circle/Square or X", (0,))[0] == 1)
    check("HT 'After photo' -> step 7 (not 8/label)",
          ht_steps.get("8. After photo – Ensure you take a picture of the pole close to the ground and a photo standing back.", (0,))[0] == 7)
    check("HT 'Clear Photo of Pole Label' -> step 8",
          ht_steps.get("9. Clear Photo of Pole Label", (0,))[0] == 8)
    check("HT 'Name' label-col not a step", "Name" not in ht_steps)

    print()
    if _FAILURES:
        print(f"FAILED ({len(_FAILURES)}): {_FAILURES}")
        sys.exit(1)
    print("All step-detection checks passed.")


if __name__ == "__main__":
    main()
