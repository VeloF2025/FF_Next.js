"""
Pure QField GPKG photo-column detection — NO external dependencies.

Split out of extract-gpkg-photos.py so it can be unit-tested (and gated in CI)
without importing psycopg2 / a DB. extract-gpkg-photos.py imports everything here.

Detection maps a GPKG column name to a checklist step + discipline:
  * civil steps 1-8   — STEP_PATTERNS
  * optical steps 1-8 — OPTICAL_STEP_PATTERNS
  * extra photo cols  — EXTRA_PHOTO_PATTERNS (no step; scanned into the unassigned bucket)
"""
import re

# ── Civil step columns ────────────────────────────────────────────────────────
#
# Match by the LEADING WORD after the column number, e.g. "1. Before Photo…",
# "3. Depth Photo…", "8. Clear Photo of Pole Label". Each step's first word is
# distinct, so we key on that (number-agnostic).
#
# Why leading-word and NOT `^<n>[.\s].*<keyword>` (the old form):
#   1. Number-agnostic. The HT_ civil-audit form prefixes a "1. Permission Slip
#      Photo" column, shifting every real step +1 ("2. Before…" = step 1 …
#      "9. Clear…" = step 8). The step *text* is identical to FT, so anchoring the
#      word (not the number) maps FT (1-8) and HT (2-9) identically.
#   2. Avoids deep-keyword contamination. The verbose descriptions repeat other
#      steps' words — "3. Depth Photo … mark our poles … before planting" contains
#      "mark"/"before". A `.*(before|mark)` pattern would mis-file it as step 1.
#      Anchoring the keyword right after the number (`^\d+[.\s]*before`) means only
#      the column that actually STARTS with the keyword is that step.
#   3. Excludes non-step numbered columns. Mohadin's "9. SJC Label" and HT's
#      "1. Permission Slip Photo" have no step leading-word → correctly unmatched.
#
# Each step lists the primary leading word AND the known synonym leading words the
# older number-anchored patterns tolerated (mark/digging/measuring/plate/backfill/
# spirit/picture), so a form that leads a column with a synonym (e.g. "1. Mark out
# the ground…") still maps correctly. Verified against all 8 registered projects'
# live GPKGs (extract-gpkg-photos.py --all --dry-run) — detection is byte-identical
# to the old patterns for every photo-bearing column. The un-numbered optical
# columns ("PhotoJoint"/"PhotoLabel"/"PhotoSlack") lack a leading digit, so they
# never match here — they fall through to EXTRA_PHOTO_PATTERNS.
STEP_PATTERNS = [
    (re.compile(r"^\d+[\.\s]*(?:before|mark)", re.IGNORECASE), 1, "Before Photo"),
    (re.compile(r"^\d+[\.\s]*(?:during|digging)", re.IGNORECASE), 2, "During Photo"),
    (re.compile(r"^\d+[\.\s]*(?:depth|measuring)", re.IGNORECASE), 3, "Depth Photo"),
    (re.compile(r"^\d+[\.\s]*(?:end|plate)", re.IGNORECASE), 4, "End Plates"),
    (re.compile(r"^\d+[\.\s]*(?:compact|backfill)", re.IGNORECASE), 5, "Compaction"),
    (re.compile(r"^\d+[\.\s]*(?:level|spirit)", re.IGNORECASE), 6, "Level Check"),
    (re.compile(r"^\d+[\.\s]*(?:after|picture)", re.IGNORECASE), 7, "After Photo"),
    (re.compile(r"^\d+[\.\s]*clear", re.IGNORECASE), 8, "Pole Label"),
]

# Extra photo columns (optical / misc) — no step assignment.
EXTRA_PHOTO_PATTERNS = [
    re.compile(r"^Photo.*Joint", re.IGNORECASE),
    re.compile(r"^Photo.*Label", re.IGNORECASE),
    re.compile(r"^Photo.*Slack", re.IGNORECASE),
    re.compile(r"^Photo.*Pole", re.IGNORECASE),
    re.compile(r"^Photo.*Sla", re.IGNORECASE),
    re.compile(r"^Pole.*Photo$", re.IGNORECASE),
    re.compile(r"^Joint.*Photo$", re.IGNORECASE),
    re.compile(r"^Lable.*Photo$", re.IGNORECASE),
    re.compile(r"^Slack.*Photo$", re.IGNORECASE),
]

# Optical dome step columns. Still number-anchored (`^<n>`): optical forms don't
# have the +1-shift problem the civil forms do, and the anchor keeps step 8 from
# swallowing an un-numbered column. Step 8's last-step wording varies across
# projects — "8. Pole ID attached to pole" (most) vs "8. Final SJC photo with slack
# management…" (Themb'elihle) — so it matches pole-id OR final/SJC. The `^8` anchor
# means Mohadin's civil "9. SJC Label" is NOT caught here.
OPTICAL_STEP_PATTERNS = [
    (re.compile(r"^1[\.\s].*dome.*pole", re.IGNORECASE), 1, "Dome on Pole"),
    (re.compile(r"^2[\.\s].*dome.*label", re.IGNORECASE), 2, "Dome Label"),
    (re.compile(r"^3[\.\s].*open.*dome", re.IGNORECASE), 3, "Open Dome"),
    (re.compile(r"^4[\.\s].*splice.*protect", re.IGNORECASE), 4, "Splice Protectors"),
    (re.compile(r"^5[\.\s].*slack.*manage", re.IGNORECASE), 5, "Slack Management"),
    (re.compile(r"^6[\.\s].*strength.*member", re.IGNORECASE), 6, "Strength Members"),
    (re.compile(r"^7[\.\s].*seal.*dust", re.IGNORECASE), 7, "Seals & Dust Caps"),
    (re.compile(r"^8[\.\s].*(?:pole.*id|final|sjc)", re.IGNORECASE), 8, "Pole ID"),
]


def detect_step_columns(columns):
    """Detect which columns contain photo references and their step numbers.

    Returns (step_cols, extra_cols):
      step_cols: {col_name: (step:int, label:str, discipline:'civil'|'optical')}
      extra_cols: [col_name]  (photo columns with no step assignment)
    """
    step_cols = {}
    extra_cols = []

    for col in columns:
        col_clean = col.strip()
        # Civil step patterns (leading-word, number-agnostic) first…
        for pattern, step, label in STEP_PATTERNS:
            if pattern.match(col_clean):
                step_cols[col] = (step, label, "civil")
                break
        else:
            # …then optical step patterns…
            for pattern, step, label in OPTICAL_STEP_PATTERNS:
                if pattern.match(col_clean):
                    step_cols[col] = (step, label, "optical")
                    break
            else:
                # …then un-stepped extra photo columns.
                for pattern in EXTRA_PHOTO_PATTERNS:
                    if pattern.match(col_clean):
                        extra_cols.append(col)
                        break

    return step_cols, extra_cols


def is_photo_value(val):
    """Check if a column value looks like a photo reference (has an image ext)."""
    if not val or not str(val).strip():
        return False
    s = str(val).strip()
    return any(ext in s.lower() for ext in [".jpg", ".jpeg", ".png", ".heic"])
