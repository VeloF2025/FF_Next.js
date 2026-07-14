#!/usr/bin/env python3
"""
Regression test for QField GPKG step-column detection (qfield_step_detection.py).

Guards:
  * the number-agnostic leading-word civil detection that maps the standard FT form
    (steps 1-8) and the HT_ form (which prefixes "1. Permission Slip Photo" and
    shifts steps to 2-9) to the SAME civil steps;
  * synonym leading words the old number-anchored patterns tolerated
    (mark/digging/measuring/plate/backfill/spirit/picture);
  * exclusion of non-step numbered columns (Permission Slip, "9. SJC Label");
  * un-numbered optical "Photo*" columns landing in extra_cols (not as steps);
  * optical step detection incl. the two step-8 wordings ("Pole ID" / "Final SJC").

Run:  python3 scripts/test_extract_gpkg_step_detection.py   (no DB / deps required)
Wired into CI via scripts/ci-local.sh.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qfield_step_detection import detect_step_columns  # noqa: E402

# ── Real column sets (verified against MinIO GPKGs 2026-07-14) ────────────────

# FT civil form (Tonga / Lawley / Etwatwa / Thembisa POP1): numbered 1-8.
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
    "1.Before Photo - Mark out the ground with a circle/Square or X",  # Etwatwa: no space after dot
    "8. Clear Foto of Pole Label",  # Mohadin: Afrikaans "Foto"
    "9. SJC Label",                 # Mohadin: numbered NON-step column — must be excluded
    "PhotoJoint", "PhotoLabel", "PhotoSlack", "Label Installed Date",  # un-numbered — not civil steps
]

# HT civil form (Mahikeng): "1. Permission Slip Photo" shifts real steps to 2-9.
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

# Hypothetical form leading each step with the SYNONYM the old patterns tolerated —
# guards the forward-robustness of the synonym alternates.
SYNONYM_COLUMNS = [
    "1. Mark out the ground with an X",
    "2. Digging the hole for the pole",
    "3. Measuring tape in the hole showing depth",
    "4. Plates must be visible and clear",
    "5. Backfill compacted in progress",
    "6. Spirit level against the pole",
    "7. Picture of the pole from standing back",
    "8. Clear Photo of Pole Label",
]

# Optical dome-audit form. Step-8 wording differs across projects.
OPTICAL_COLUMNS = [
    "label",
    "1. Splice dome installed on pole (wide shot)",
    "2. Dome label clearly visible (Pole ID / Fibre ID)",
    "3. Open dome- Fibre routing and tray layout",
    "4. Splice Protectors fit correctly",
    "5. Slack management inside dome",
    "6. Strength members secured",
    "7. Seals tightened and dust caps inplace",
    "8. Pole ID attatched to pole",
]
# Themb'elihle optical GPKG uses a different step-8 wording.
OPTICAL_FINAL_SJC = "8. Final SJC photo with slack management and home drop"

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
    check("FT detects exactly civil steps 1-8", sorted(ft_by_num) == [1, 2, 3, 4, 5, 6, 7, 8])
    check("FT all civil discipline", all(d == "civil" for d in ft_by_num.values()))
    check("FT 'Pole Label' label-col not a step", "Pole Label" not in ft_steps)
    check("FT '1.Before' (no space) -> step 1",
          any(c.startswith("1.Before") and m[0] == 1 for c, m in ft_steps.items()))
    check("FT 'Clear Foto' (Afrikaans) -> step 8", ft_steps.get("8. Clear Foto of Pole Label", (0,))[0] == 8)
    check("FT '9. SJC Label' NOT a step", "9. SJC Label" not in ft_steps)
    check("FT 'PhotoJoint' in extra_cols", "PhotoJoint" in ft_extra and "PhotoJoint" not in ft_steps)
    check("FT 'PhotoLabel' in extra_cols", "PhotoLabel" in ft_extra and "PhotoLabel" not in ft_steps)
    check("FT 'PhotoSlack' in extra_cols", "PhotoSlack" in ft_extra and "PhotoSlack" not in ft_steps)

    print("HT form (shifted 2-9, permission-slip prefix):")
    ht_steps, _ = detect_step_columns(HT_COLUMNS)
    ht_by_num = _steps_by_number(ht_steps)
    check("HT detects exactly civil steps 1-8", sorted(ht_by_num) == [1, 2, 3, 4, 5, 6, 7, 8])
    check("HT all civil discipline", all(d == "civil" for d in ht_by_num.values()))
    check("HT 'Permission Slip Photo' NOT a step", "1. Permission Slip Photo" not in ht_steps)
    check("HT 'Before Photo' -> step 1",
          ht_steps.get("2. Before Photo - Mark out the ground with a circle/Square or X", (0,))[0] == 1)
    check("HT 'After photo' -> step 7 (not 8/label)",
          ht_steps.get("8. After photo – Ensure you take a picture of the pole close to the ground and a photo standing back.", (0,))[0] == 7)
    check("HT 'Clear Photo of Pole Label' -> step 8",
          ht_steps.get("9. Clear Photo of Pole Label", (0,))[0] == 8)
    check("HT 'Name' label-col not a step", "Name" not in ht_steps)

    print("Synonym-leading form (mark/digging/measuring/…):")
    syn_steps, _ = detect_step_columns(SYNONYM_COLUMNS)
    syn_by_num = _steps_by_number(syn_steps)
    check("Synonyms detect exactly civil steps 1-8", sorted(syn_by_num) == [1, 2, 3, 4, 5, 6, 7, 8])
    check("'Mark out' -> step 1", syn_steps.get("1. Mark out the ground with an X", (0,))[0] == 1)
    check("'Measuring tape' -> step 3", syn_steps.get("3. Measuring tape in the hole showing depth", (0,))[0] == 3)
    check("'Backfill' -> step 5", syn_steps.get("5. Backfill compacted in progress", (0,))[0] == 5)

    print("Optical dome form:")
    opt_steps, _ = detect_step_columns(OPTICAL_COLUMNS)
    opt_by_num = _steps_by_number(opt_steps)
    check("Optical detects exactly steps 1-8", sorted(opt_by_num) == [1, 2, 3, 4, 5, 6, 7, 8])
    check("Optical all optical discipline", all(d == "optical" for d in opt_by_num.values()))
    check("Optical 'Pole ID' -> step 8", opt_steps.get("8. Pole ID attatched to pole", (0,))[0] == 8)
    sjc_steps, _ = detect_step_columns([OPTICAL_FINAL_SJC])
    check("Optical 'Final SJC photo' -> optical step 8",
          sjc_steps.get(OPTICAL_FINAL_SJC, (0, "", "")) [0] == 8 and sjc_steps.get(OPTICAL_FINAL_SJC, (0, "", ""))[2] == "optical")

    print()
    if _FAILURES:
        print(f"FAILED ({len(_FAILURES)}): {_FAILURES}")
        sys.exit(1)
    print("All step-detection checks passed.")


if __name__ == "__main__":
    main()
