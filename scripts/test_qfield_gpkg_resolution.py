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
    family_members,
    is_family_member,
    normalize_stem,
    parse_mc_gpkg_names,
    pick_latest_gpkg,
    pick_photo_table,
    version_timestamp,
)
from qfield_staleness import gpkg_behind_days, select_stale_gpkgs  # noqa: E402

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
    check("'Optical Audit.gpkg' does not claim 'Optical access.gpkg'",
          not is_family_member("Optical Audit.gpkg", "Optical access.gpkg"))

    print("\nis_family_member — a rename is version-stamped; a sibling document is not:")
    # Thembisa POP 1 is registered on the generic 'Poles.gpkg' and its live MinIO folder
    # already holds 'Poles drag and drop.shp/.dbf/.prj/.shx' and 'Cage with Poles.*';
    # sibling THM POP 3 already carries a real 'Poles HLD.gpkg'. Exporting any of those
    # to GPKG must NOT repoint the ingest at a scratch/design layer.
    check("'Poles.gpkg' does NOT claim 'Poles HLD.gpkg' (no digit → not a rename)",
          not is_family_member("Poles.gpkg", "Poles HLD.gpkg"))
    check("'Poles.gpkg' does NOT claim 'Poles drag and drop.gpkg'",
          not is_family_member("Poles.gpkg", "Poles drag and drop.gpkg"))
    check("'Poles.gpkg' does NOT claim 'Poles Audit.gpkg'",
          not is_family_member("Poles.gpkg", "Poles Audit.gpkg"))
    # …while every real rename in this estate carries a date or version number.
    check("still claims 'Civil audit updated_27_07.gpkg' (digits)",
          is_family_member("Civil audit.gpkg", "Civil audit updated_27_07.gpkg"))
    check("still claims 'Civil_Audit_V02.gpkg' (digits)",
          is_family_member("Civil audit.gpkg", "Civil_Audit_V02.gpkg"))
    check("still claims 'Optical Audit 2.0.gpkg' from 'Optical Audit.gpkg' (digits)",
          is_family_member("Optical Audit.gpkg", "Optical Audit 2.0.gpkg"))
    check("'Poles.gpkg' claims a genuinely version-stamped 'Poles v2.gpkg'",
          is_family_member("Poles.gpkg", "Poles v2.gpkg"))
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
    # Assert the FAMILY SET, not just the winner. Checking only the winner proves
    # nothing here: every candidate carries the same version, so pick_latest_gpkg's
    # tie-break returns the configured file whether or not the pattern over-matched.
    # Verified by mutation — replacing the word-boundary prefix with a bare substring
    # match (a severe over-match bug) left all 16 winner-only checks GREEN. Comparing
    # the set is what actually fails, because a wrongly-claimed sibling shows up in it.
    for project, configured in REGISTERED:
        listing = versions_for(project)
        chosen, _ = pick_latest_gpkg(configured, listing)
        check(f"{project} / {configured} → itself", chosen == configured)
        fam = set(family_members(configured, listing))
        expected = {configured} if project != "Mahikeng" else {
            "Civil audit.gpkg",
            "Civil audit updated_22_07.gpkg",
            "Civil audit updated_27_07.gpkg",
        }
        check(f"{project} / {configured} family == {sorted(expected)}", fam == expected)

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

    print("\nThe POP 1 hazard, end-to-end through its REAL listing:")
    # GPKG_LISTINGS stays honest — POP 1 holds 'Poles drag and drop.shp/.dbf/.prj/.shx',
    # not yet a .gpkg. So inject the export that would create the collision rather than
    # pretending the fixture already contains it, and prove the resolver holds.
    pop1 = versions_for("Thembisa POP 1")
    pop1["Poles drag and drop.gpkg"] = V_NEW   # the QGIS "export to GeoPackage"
    pop1["Poles HLD.gpkg"] = V_NEW             # the shape THM POP 3 already carries
    chosen, _ = pick_latest_gpkg("Poles.gpkg", pop1)
    check("a newer 'Poles drag and drop.gpkg' does NOT capture 'Poles.gpkg'",
          chosen == "Poles.gpkg")
    check("neither does a newer 'Poles HLD.gpkg'", chosen != "Poles HLD.gpkg")
    check("and neither joins the family at all",
          set(family_members("Poles.gpkg", pop1)) == {"Poles.gpkg"})
    # The same project must still accept a genuine, version-stamped rename.
    pop1_renamed = dict(pop1)
    pop1_renamed["Poles updated_28_07.gpkg"] = V_NEW
    check("but a version-stamped 'Poles updated_28_07.gpkg' IS followed",
          pick_latest_gpkg("Poles.gpkg", pop1_renamed)[0] == "Poles updated_28_07.gpkg")

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

    print("\npick_photo_table — an exact tie must not silently pick the OLDEST layer:")
    # A QGIS "Save As" can leave both copies of a form in one GPKG with identical photo
    # column counts. sqlite_master lists in creation order, so a plain `>` scan returns
    # the older layer — reproducing the very freeze this module fixes, one level down.
    TIED = {"civil_audit_updated_22_07": 8, "civil_audit_updated_27_07": 8}
    check("the layer matching the resolved filename wins the tie",
          pick_photo_table("civil_audit", TIED,
                           prefer_stem="Civil audit updated_27_07.gpkg") == "civil_audit_updated_27_07")
    check("without a stem hint, the LAST tying table wins (newest created), not the first",
          pick_photo_table("civil_audit", TIED) == "civil_audit_updated_27_07")
    check("a strictly higher count still beats the stem preference",
          pick_photo_table("nope", {"a": 8, "b": 12}, prefer_stem="a.gpkg") == "b")

    print("\ngpkg_behind_days — 'is something newer being ignored', not 'how old is this':")
    NOW = datetime(2026, 7, 28, 12, 0, tzinfo=timezone.utc)
    check("same version → None (dormant, never stale however old)",
          gpkg_behind_days("v20260101000000-a", "v20260101000000-a", NOW) is None)
    check("a form untouched for 200 days is still NOT behind",
          gpkg_behind_days("v20260101000000-a", "v20260101000000-a", NOW) is None)
    check("newer version available → days since it appeared",
          abs(gpkg_behind_days("v20260722042348-a", "v20260724120000-b", NOW) - 4.0) < 0.01)
    check("no available version (listing failed) → None, not a flag",
          gpkg_behind_days("v20260722042348-a", None, NOW) is None)
    check("unparseable available version → None",
          gpkg_behind_days("v20260722042348-a", "garbage", NOW) is None)
    check("unparseable ingested version → None",
          gpkg_behind_days("garbage", "v20260724120000-b", NOW) is None)
    check("future version clamps to 0, never negative",
          gpkg_behind_days("v20260722042348-a", "v20260729120000-b", NOW) == 0.0)

    print("\nselect_stale_gpkgs — dormancy must never flag, a real backlog must:")
    # Live shape on 2026-07-28: EVERY tracked path had already ingested the newest
    # version MinIO held. The previous signal (per-file version vs project-wide newest
    # photo) flagged 5 of them; all 5 were dormant forms with nothing to ingest.
    DORMANT = [
        {"qf_uuid": "p1", "gpkg_path": "Optical Audit.gpkg", "last_version": "v20260717161648-a"},
        {"qf_uuid": "p2", "gpkg_path": "LAWPoles.gpkg", "last_version": "v20260722075537-b"},
    ]
    DORMANT_MINIO = {
        ("p1", "Optical Audit.gpkg"): "v20260717161648-a",   # identical → nothing to do
        ("p2", "LAWPoles.gpkg"): "v20260722075537-b",
    }
    check("a fortnight-old dormant form does NOT flag",
          select_stale_gpkgs(DORMANT, DORMANT_MINIO, {}, NOW, 3.0) == [])

    BEHIND = [{"qf_uuid": "p1", "gpkg_path": "Civil Audit.gpkg", "last_version": "v20260720000000-a"}]
    BEHIND_MINIO = {("p1", "Civil Audit.gpkg"): "v20260722000000-b"}
    got = select_stale_gpkgs(BEHIND, BEHIND_MINIO, {}, NOW, 3.0)
    check("a genuinely unread newer version DOES flag", len(got) == 1)
    check("and names the available version so the alert is actionable",
          got[0][1] == "Civil Audit.gpkg" and got[0][3] == "v20260722000000-b")
    check("a newer version that only just appeared does not flag yet",
          select_stale_gpkgs(BEHIND, {("p1", "Civil Audit.gpkg"): "v20260728100000-c"}, {}, NOW, 3.0) == [])
    check("a path missing from the MinIO listing is skipped, not flagged",
          select_stale_gpkgs(BEHIND, {}, {}, NOW, 3.0) == [])
    check("empty/None input → no flags",
          select_stale_gpkgs([], BEHIND_MINIO, {}, NOW, 3.0) == []
          and select_stale_gpkgs(None, BEHIND_MINIO, {}, NOW, 3.0) == [])
    multi = select_stale_gpkgs(
        BEHIND + [{"qf_uuid": "p2", "gpkg_path": "Old.gpkg", "last_version": "v20260101000000-x"}],
        {**BEHIND_MINIO, ("p2", "Old.gpkg"): "v20260102000000-y"}, {}, NOW, 3.0)
    check("sorted worst-first", multi[0][1] == "Old.gpkg")
    # Pin the comparison as strictly-greater: exactly-at-threshold must not flag.
    edge = {("p1", "Civil Audit.gpkg"): "v20260725120000-z"}   # available exactly 3.0d ago
    check("behind exactly == stale_days does NOT flag (strictly greater)",
          select_stale_gpkgs(BEHIND, edge, {}, NOW, 3.0) == [])
    check("a hair over the threshold DOES flag",
          len(select_stale_gpkgs(BEHIND, edge, {}, NOW + timedelta(hours=1), 3.0)) == 1)

    print("\nselect_stale_gpkgs — the RENAME case, replayed from Mahikeng's real state:")
    # The founding incident, exactly as production looked on 2026-07-27. The tracked
    # path is UNCHANGED in MinIO (it looks perfectly dormant); the real work moved to a
    # different filename. A same-path comparison is structurally blind to this, so
    # without the sibling clause the monitor would miss the very freeze it exists for.
    MHK = [{"qf_uuid": "mhk", "gpkg_path": "Civil audit.gpkg",
            "last_version": "v20260722042348-1cd13adf"}]
    MHK_SAME = {("mhk", "Civil audit.gpkg"): "v20260722042348-1cd13adf"}   # dormant
    check("same-path check alone does NOT see the rename (it is dormant)",
          select_stale_gpkgs(MHK, MHK_SAME, {}, NOW, 3.0) == [])
    # A NON-NUMERIC rename — the kind the resolver deliberately declines to follow, so
    # this alert is the only thing that can report it.
    MHK_SIB = {("mhk", "Civil audit.gpkg"): ("Civil audit new.gpkg", "v20260724000000-x")}
    got_mhk = select_stale_gpkgs(MHK, MHK_SAME, MHK_SIB, NOW, 3.0)
    check("a newer SIBLING flags it", len(got_mhk) == 1)
    check("and names the sibling so the alert is actionable",
          "Civil audit new.gpkg" in got_mhk[0][3])
    check("the resolver still declines that non-numeric rename (strict/loose split)",
          not is_family_member("Civil audit.gpkg", "Civil audit new.gpkg")
          and is_family_member("Civil audit.gpkg", "Civil audit new.gpkg",
                               require_version_marker=False))
    check("a sibling OLDER than what we ingested is not a backlog",
          select_stale_gpkgs(MHK, MHK_SAME,
                             {("mhk", "Civil audit.gpkg"): ("Civil audit old.gpkg", "v20260101000000-x")},
                             NOW, 3.0) == [])
    check("a sibling that only just appeared does not flag yet",
          select_stale_gpkgs(MHK, MHK_SAME,
                             {("mhk", "Civil audit.gpkg"): ("Civil audit new.gpkg", "v20260728110000-x")},
                             NOW, 3.0) == [])
    check("an unrelated form is never treated as a sibling",
          not is_family_member("Civil audit.gpkg", "Optical Audit.gpkg",
                               require_version_marker=False))

    print("\nparse_mc_gpkg_names — `mc ls` output parsing:")
    MC_OUT = (
        "[2026-07-27 15:06:40 UTC]     0B Civil audit updated_27_07.gpkg/\n"
        "[2026-07-27 15:06:40 UTC]     0B Civil audit.gpkg/\n"
        "[2026-07-27 15:06:40 UTC]     0B DCIM/\n"
        "[2026-07-27 15:06:40 UTC] 1.3MiB notes.txt\n"
        "\n"
    )
    names = parse_mc_gpkg_names(MC_OUT)
    check("keeps only .gpkg entries", names == ["Civil audit updated_27_07.gpkg", "Civil audit.gpkg"])
    check("names containing spaces survive intact", "Civil audit updated_27_07.gpkg" in names)
    check("non-gpkg directories excluded", "DCIM" not in names)
    check("empty/garbage input → []", parse_mc_gpkg_names("") == [] and parse_mc_gpkg_names(None) == [])
    check("a size token other than 0B still parses",
          parse_mc_gpkg_names("[2026-07-27 15:06:40 UTC] 2.1MiB Big.gpkg/") == ["Big.gpkg"])
    check("an embedded path separator is rejected (never built into a MinIO prefix)",
          parse_mc_gpkg_names("[2026-07-27 15:06:40 UTC]     0B ../other/evil.gpkg/") == [])

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
