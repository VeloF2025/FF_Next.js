#!/usr/bin/env python3
"""
Regression test for QField GPKG family resolution + staleness (qfield_gpkg_resolution.py).

Guards the fix for the 2026-07-27 Mahikeng freeze: the crew renamed the audit GPKG
("Civil audit.gpkg" → "Civil audit updated_27_07.gpkg"), PROJECTS still pinned the dead
file, and the extractor logged "SKIP: Already processed this version" for 5 days while
918 photos piled up unseen.

The load-bearing assertion is NO-OP FOR EVERY REGISTERED PROJECT: family resolution must
not move any project except Mahikeng off the file it reads today. GPKG_LISTINGS below is
the real `mc ls .../files/` output for all 9 registered QField projects (captured
2026-07-27), so a pattern that over-matches — pulling a project's optical audit into its
civil family, or a dated OES export into a poles family — fails here rather than in prod.

Run:  python3 scripts/test_qfield_gpkg_resolution.py   (no DB / MinIO / deps required)
Wired into CI via scripts/ci-local.sh.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qfield_gpkg_resolution import (  # noqa: E402
    gpkg_sync_lag_days,
    is_family_member,
    normalize_stem,
    pick_latest_gpkg,
    pick_photo_table,
    version_timestamp,
)

_FAILURES = []


def check(label, condition):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}")
        _FAILURES.append(label)


# ── Real MinIO listings (docker exec … mc ls …/files/, 2026-07-27) ────────────
# Trimmed to the GPKGs that could plausibly collide with a registered gpkg_path:
# the registered file itself, its same-prefix neighbours, and the other audit forms
# in the same project. The ~90 dated "OES FF DDMMYYYY.gpkg" exports every FT project
# carries are represented by a few samples — they are the biggest over-match hazard
# for any project registered on a short name.
GPKG_LISTINGS = {
    "Themb'elihle": [
        "Civil Audit.gpkg", "Optical Audit.gpkg", "Optical access.gpkg", "QA audit.gpkg",
        "Cables.gpkg", "Cables Original.gpkg", "Enclosures.gpkg", "Enclosures Original.gpkg",
        "PolesCreosote.gpkg", "poles_creosote Original.gpkg", "PON Progress.gpkg", "PONs.gpkg",
    ],
    "Lawley": [
        "LAWPoles.gpkg", "LAWJoints.gpkg", "LAWPONS.gpkg", "LAWPOP.gpkg", "LAWZones.gpkg",
        "LAWCableSpan.gpkg", "LAWDropCable.gpkg", "HLD Lawley.gpkg", "QA Audit.gpkg",
        "OES FF.gpkg", "OES FF 31012026.gpkg", "OES FF 25052026.gpkg", "PON Progress.gpkg",
    ],
    "Mohadin": [
        "MOAPoles.gpkg", "MOAJoints.gpkg", "MOAPons.gpkg", "MOAPOP.gpkg", "MOAZones.gpkg",
        "MOACableSpan.gpkg", "Optical Audit.gpkg", "QA Audit.gpkg", "Mohadin HLD.gpkg",
        "Mohadin WE 2026.04.12 notes.gpkg", "OES FF.gpkg", "OES FF 31012026.gpkg",
    ],
    "Mamelodi": [
        "MAMPoles.gpkg", "MAMJoints.gpkg", "MAMPons.gpkg", "MAMPOP.gpkg", "MAMZones.gpkg",
        "MAMDrops.gpkg", "MAMCableSpan.gpkg", "Civil Audit Audit.gpkg", "Optical Audit 2.0.gpkg",
        "OES FF.gpkg", "OES FF 31012026.gpkg", "PON Progress.gpkg",
    ],
    "Etwatwa": [
        "PolesAudit.gpkg", "PolesHLD.gpkg", "PolesPlanted2025.gpkg", "Joints.gpkg",
        "Optical Audit.gpkg", "QA audit.gpkg", "CableSpan.gpkg", "CablesHLD.gpkg",
        "OES FF.gpkg", "OES FF 25052026.gpkg", "PON Progress.gpkg", "PONS.gpkg",
    ],
    "Thembisa POP 1": [
        "Poles.gpkg", "New poles drag and drop.gpkg", "Civil Audit.gpkg", "Optical Audit.gpkg",
        "THM_1_Joints.gpkg", "THM_1_joints.gpkg", "PONs.gpkg", "POP.gpkg", "PON Progress.gpkg",
        "OES FF.gpkg", "OES FF 30042026.gpkg", "Enclosures HLD.gpkg", "EnclosuresSplice.gpkg",
    ],
    "Thembisa POP 3": [
        "THM_3_Poles.gpkg", "THM_3_Joints.gpkg", "Poles HLD.gpkg", "Civil Audit.gpkg",
        "Optical Audit.gpkg", "PON Progress.gpkg", "PON Progress new.gpkg", "PONs.gpkg",
        "OES FF.gpkg", "OES FF 30042026.gpkg", "Splitters HLD.gpkg", "Splitters As-Built.gpkg",
    ],
    "Tonga": [
        "Civil Audit.gpkg", "Optical Audit.gpkg", "Optical audit.gpkg", "Optical OLD audit.gpkg",
        "PoleAudit.gpkg", "PolesAGBlock.gpkg", "PolesAGBLFeedDist.gpkg", "CableSpan.gpkg",
        "Distribution.gpkg", "DistributionJoints.gpkg", "DistributionSpurs.gpkg",
        "DistributionSpurJoints.gpkg", "PON Progress.gpkg",
    ],
    "Mahikeng": [
        "Civil audit.gpkg", "Civil audit updated_22_07.gpkg", "Civil audit updated_27_07.gpkg",
        "Civil_Audit_V02.gpkg", "MahikengPoles.gpkg", "MahikengPH4AOI.gpkg", "QA Audit.gpkg",
        "PON Progress.gpkg", "PON Progress V2.gpkg", "PON Progress new.gpkg",
        "cable_span_V4.gpkg", "DemandPoints.gpkg",
    ],
}

# Every registered gpkg_path, exactly as PROJECTS / ALTERNATE_GPKGS / OPTICAL_GPKGS
# spell it in extract-gpkg-photos.py, mapped to the project whose files it is read from.
REGISTERED = [
    ("Themb'elihle", "Civil Audit.gpkg"),
    ("Themb'elihle", "Optical Audit.gpkg"),
    ("Lawley", "LAWPoles.gpkg"),
    ("Lawley", "LAWJoints.gpkg"),
    ("Mohadin", "MOAPoles.gpkg"),
    ("Mohadin", "Optical Audit.gpkg"),
    ("Mamelodi", "MAMPoles.gpkg"),
    ("Mamelodi", "Optical Audit 2.0.gpkg"),
    ("Etwatwa", "PolesAudit.gpkg"),
    ("Etwatwa", "Optical Audit.gpkg"),
    ("Thembisa POP 1", "Poles.gpkg"),
    ("Thembisa POP 1", "Optical Audit.gpkg"),
    ("Thembisa POP 3", "THM_3_Poles.gpkg"),
    ("Thembisa POP 3", "Optical Audit.gpkg"),
    ("Tonga", "Civil Audit.gpkg"),
    ("Mahikeng", "Civil audit.gpkg"),
]

# ALTERNATE_GPKGS entries naming a file that is NOT in MinIO. They must stay unresolved:
# adopting the real civil audit sitting next to them is a data change nobody reviewed.
REGISTERED_MISSING = [
    ("Mamelodi", "civil_audit_.gpkg"),
    ("Thembisa POP 1", "civil_audit_.gpkg"),
    ("Thembisa POP 3", "civil_audit_.gpkg"),
]

# Version ids sort by upload time; only relative order matters below.
V_OLD = "v20260722042348-1cd13adf"
V_MID = "v20260727134833-517b0eff"
V_NEW = "v20260727160140-7f41aa68"


def versions_for(project, newest=None):
    """{filename: version} for a project, all V_OLD except `newest` which gets V_NEW.

    Mahikeng's 'Civil_Audit_V02.gpkg' is given "" — QFieldCloud really does hold an
    empty version folder there, and a placeholder must never win the contest.
    """
    out = {}
    for name in GPKG_LISTINGS[project]:
        if name == "Civil_Audit_V02.gpkg":
            out[name] = ""
        else:
            out[name] = V_NEW if name == newest else V_OLD
    return out


def main():
    print("normalize_stem:")
    check("strips .gpkg + lowercases",
          normalize_stem("Civil Audit.gpkg") == "civil audit")
    check("collapses _ - . and runs of spaces",
          normalize_stem("Civil_audit  updated-27.07.gpkg") == "civil audit updated 27 07")
    check("trailing separator does not leave a trailing space",
          normalize_stem("civil_audit_.gpkg") == "civil audit")
    check("empty input is empty", normalize_stem("") == "")

    print("\nis_family_member — the Mahikeng rename:")
    check("claims 'Civil audit updated_27_07.gpkg'",
          is_family_member("Civil audit.gpkg", "Civil audit updated_27_07.gpkg"))
    check("claims 'Civil audit updated_22_07.gpkg'",
          is_family_member("Civil audit.gpkg", "Civil audit updated_22_07.gpkg"))
    check("claims 'Civil_Audit_V02.gpkg' (separator + case differ)",
          is_family_member("Civil audit.gpkg", "Civil_Audit_V02.gpkg"))
    check("claims itself", is_family_member("Civil audit.gpkg", "Civil audit.gpkg"))

    print("\nis_family_member — must NOT over-match:")
    check("civil audit does not claim optical audit",
          not is_family_member("Civil audit.gpkg", "Optical Audit.gpkg"))
    check("civil audit does not claim 'QA Audit.gpkg'",
          not is_family_member("Civil audit.gpkg", "QA Audit.gpkg"))
    check("prefix must end on a word boundary ('Civil auditor')",
          not is_family_member("Civil audit.gpkg", "Civil auditor.gpkg"))
    check("match is prefix-only, never suffix ('Extra Civil audit')",
          not is_family_member("Civil audit.gpkg", "Extra Civil audit.gpkg"))
    check("'Poles.gpkg' does not claim 'Poles HLD.gpkg' family-wise? (it does — same form)",
          is_family_member("Poles.gpkg", "Poles HLD.gpkg"))
    check("'Optical Audit.gpkg' does not claim 'Optical access.gpkg'",
          not is_family_member("Optical Audit.gpkg", "Optical access.gpkg"))
    check("'Optical Audit 2.0.gpkg' does not claim plain 'Optical Audit.gpkg' (narrower→wider)",
          not is_family_member("Optical Audit 2.0.gpkg", "Optical Audit.gpkg"))
    check("empty configured name claims nothing",
          not is_family_member("", "Civil audit.gpkg"))

    print("\npick_latest_gpkg — Mahikeng resolves to the newest:")
    mahikeng = versions_for("Mahikeng")
    mahikeng["Civil audit updated_22_07.gpkg"] = V_MID
    mahikeng["Civil audit updated_27_07.gpkg"] = V_NEW
    chosen, version = pick_latest_gpkg("Civil audit.gpkg", mahikeng)
    check("picks 'Civil audit updated_27_07.gpkg'", chosen == "Civil audit updated_27_07.gpkg")
    check("returns its version", version == V_NEW)
    check("versionless 'Civil_Audit_V02.gpkg' never wins", chosen != "Civil_Audit_V02.gpkg")

    print("\npick_latest_gpkg — guards:")
    check("no redirect when the configured file is the newest",
          pick_latest_gpkg("Civil audit.gpkg", {"Civil audit.gpkg": V_NEW,
                                                "Civil audit updated_22_07.gpkg": V_OLD})[0]
          == "Civil audit.gpkg")
    check("configured file wins a version tie",
          pick_latest_gpkg("Civil audit.gpkg", {"Civil audit.gpkg": V_NEW,
                                                "Civil audit updated_27_07.gpkg": V_NEW})[0]
          == "Civil audit.gpkg")
    check("empty candidate set → no redirect", pick_latest_gpkg("Civil audit.gpkg", {}) == (None, None))
    check("None candidate set → no redirect", pick_latest_gpkg("Civil audit.gpkg", None) == (None, None))
    check("no redirect when the configured file is absent, even with a newer sibling",
          pick_latest_gpkg("civil_audit_.gpkg", {"Civil Audit Audit.gpkg": V_NEW}) == (None, None))
    check("presence test is EXACT, not normalized ('civil_audit_' ≠ 'Civil Audit')",
          pick_latest_gpkg("civil_audit_.gpkg", {"Civil Audit.gpkg": V_NEW}) == (None, None))
    check("unrelated newer files are ignored",
          pick_latest_gpkg("Civil audit.gpkg", {"Civil audit.gpkg": V_OLD,
                                                "Optical Audit.gpkg": V_NEW})[0]
          == "Civil audit.gpkg")

    print("\nNO-OP for every registered project (real MinIO listings):")
    for project, configured in REGISTERED:
        listing = versions_for(project)
        chosen, _ = pick_latest_gpkg(configured, listing)
        # Every file carries V_OLD here, so the configured file wins on the tie rule:
        # any other answer means the pattern over-matched a neighbouring GPKG.
        check(f"{project} / {configured} → itself", chosen == configured)

    print("\nNO-OP even when a neighbour is newer (over-match would redirect):")
    for project, configured in REGISTERED:
        if project == "Mahikeng":
            continue  # Mahikeng SHOULD redirect — asserted above
        for neighbour in GPKG_LISTINGS[project]:
            if neighbour == configured:
                continue
            listing = versions_for(project, newest=neighbour)
            chosen, _ = pick_latest_gpkg(configured, listing)
            if chosen != configured:
                check(f"{project} / {configured} wrongly redirected to '{neighbour}'", False)
    check("no registered project redirects onto a newer neighbour",
          not any("wrongly redirected" in f for f in _FAILURES))

    print("\nUnresolvable ALTERNATE_GPKGS stay unresolved (not silently adopted):")
    for project, configured in REGISTERED_MISSING:
        listing = versions_for(project)
        check(f"{project} / {configured} → no redirect",
              pick_latest_gpkg(configured, listing) == (None, None))

    print("\npick_photo_table:")
    check("exact configured table wins even with fewer photo columns",
          pick_photo_table("civil_audit", {"civil_audit": 8, "other_layer": 12}) == "civil_audit")
    check("case-insensitive exact match",
          pick_photo_table("civil_audit", {"Civil_Audit": 8}) == "Civil_Audit")
    check("renamed layer → most photo columns wins",
          pick_photo_table("civil_audit",
                           {"civil_audit_updated_27_07": 8,
                            "civil_audit_updated_27_07__attachments": 0}) == "civil_audit_updated_27_07")
    check("GPKG relation side-table (0 photo cols) never wins",
          pick_photo_table("nope", {"civil_audit__civil_audit": 0, "civil_audit_x": 3}) == "civil_audit_x")
    check("no table has photo columns → None (caller errors loudly)",
          pick_photo_table("nope", {"a": 0, "b": 0}) is None)
    check("empty table set → None", pick_photo_table("civil_audit", {}) is None)

    print("\ngpkg_sync_lag_days — the Mahikeng freeze:")
    # Real values: last successful sync 2026-07-22 05:00Z, newest DCIM 2026-07-27 14:53Z.
    lag = gpkg_sync_lag_days("2026-07-22 05:00:45.188835+00", "2026-07-27 14:53:24.295485+00")
    check("Mahikeng lag is ~5.4 days", lag is not None and 5.3 < lag < 5.5)
    check("lag exceeds the 3-day default threshold", lag > 3.0)
    now = datetime(2026, 7, 27, 14, 0, tzinfo=timezone.utc)
    check("a healthy project (synced after the newest photo) has 0 lag",
          gpkg_sync_lag_days(now, now - timedelta(hours=6)) == 0.0)
    check("negative lag clamps to 0, never negative",
          gpkg_sync_lag_days(now + timedelta(days=2), now) == 0.0)
    check("finished project (both old) has ~0 lag, so no alert",
          gpkg_sync_lag_days(now - timedelta(days=90), now - timedelta(days=90, hours=1)) == 0.0)
    check("unknown last-sync → None, NOT 0 (unknown is not healthy)",
          gpkg_sync_lag_days(None, now) is None)
    check("unknown upstream → None", gpkg_sync_lag_days(now, None) is None)
    check("unparseable timestamp → None", gpkg_sync_lag_days("not a date", now) is None)
    check("naive timestamps are read as UTC, not rejected",
          gpkg_sync_lag_days(datetime(2026, 7, 22, 5, 0), datetime(2026, 7, 24, 5, 0)) == 2.0)
    check("two-digit '+00' offset parses (fromisoformat rejects it before 3.11)",
          gpkg_sync_lag_days("2026-07-22 05:00:00+00", "2026-07-24 05:00:00+00") == 2.0)

    print("\nversion_timestamp:")
    check("parses a QFieldCloud version id",
          version_timestamp("v20260727145257-6bc52280")
          == datetime(2026, 7, 27, 14, 52, 57, tzinfo=timezone.utc))
    check("rejects a non-version string", version_timestamp("not-a-version") is None)
    check("rejects an impossible date", version_timestamp("v20261345995999-abcd1234") is None)
    check("None input → None", version_timestamp(None) is None)

    print()
    if _FAILURES:
        print(f"FAILED ({len(_FAILURES)}): {_FAILURES}")
        sys.exit(1)
    print("All GPKG-resolution checks passed.")


if __name__ == "__main__":
    main()
