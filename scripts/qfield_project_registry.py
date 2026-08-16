"""
QFieldCloud → FibreFlow project registry — the ingestion allow-list.

Split out of extract-gpkg-photos.py so that BOTH the extractor and
works-qa-coverage-check.py can read the same source of truth. The coverage check
needs it to tell two very different failures apart:

  * a project that was never registered here          → "register it"
  * a registered project that resolves nothing        → "its GPKG params are wrong"

Before this split the check could only report the first, so a registered project
with (say) a mis-cased label_col was told to register itself — advice that would
never fix it. A wrong label_col already fails safe in the extractor (it refuses to
write sync-state, so nothing looks freshly synced), but it fails QUIETLY; making
the registry importable is what lets the alert name the real cause.

Shape of a PROJECTS entry:
    qf_project_id  QFieldCloud project UUID
    ff_project_id  FibreFlow projects.id UUID
    gpkg_path      family ROOT filename; resolve_gpkg_path() follows renames
    table_name     QField relation table holding the photo columns
    label_col      column holding the pole label — CASE-SENSITIVE (see below)
  optional:
    pon_col / zone_col   hierarchy columns, omitted when the data is all NULL
    spatial_pon          run the spatial PON resolver for this project

label_col casing matters: sqlite3.Row indexing is case-insensitive, but the
extractor's guard checks `label_col not in columns` against exact-case keys. A
mis-cased value therefore ingests NOTHING while raising no exception. Adjacent
entries legitimately differ ("NAME" for Cradock, "Name" for Middelburg/Mahikeng)
— always verify against the live GPKG rather than copying a neighbour.

Validated by scripts/test_qfield_project_registry.py (CI-gated via ci-local.sh).
"""

# QFieldCloud project → FibreFlow project mapping
# Each entry defines how to read the GPKG for that project
PROJECTS = {
    "Themb'elihle": {
        "qf_project_id": "9af1fc72-f637-4ecb-b371-f7c08a4d4e68",
        "ff_project_id": "7bb7e022-dd75-4299-8575-cfc08abdfabb",
        "gpkg_path": "Civil Audit.gpkg",
        "table_name": "civil_audit",
        "label_col": "label",
    },
    "Lawley": {
        "qf_project_id": "2e988631-462b-448f-ae15-bb693a68cd55",
        "ff_project_id": "4eb13426-b2a1-472d-9b3c-277082ae9b55",
        "gpkg_path": "LAWPoles.gpkg",
        "table_name": "LAWPoles",
        "label_col": "label",
    },
    "Mohadin": {
        "qf_project_id": "bec5f353-2e83-4f6b-989a-fca83ad94e16",
        "ff_project_id": "bf9a90db-e758-4c05-b999-694cd63c451f",
        "gpkg_path": "MOAPoles.gpkg",
        "table_name": "MOAPoles",
        "label_col": "label",
    },
    "Mamelodi": {
        "qf_project_id": "2ce80264-170c-4f05-ada1-68220d7e5885",
        "ff_project_id": "7003dc06-9af7-4a7c-bc6c-a177d77784f2",
        "gpkg_path": "MAMPoles.gpkg",
        "table_name": "MAMPoles",
        "label_col": "label",
    },
    "Etwatwa": {
        "qf_project_id": "47585401-1b25-4d3b-8d18-4337ea26df88",
        "ff_project_id": "c7255076-1d2f-41ce-97bb-858b8c87ee27",
        "gpkg_path": "PolesAudit.gpkg",
        "table_name": "PolesAudit",
        "label_col": "label",
    },
    "Thembisa POP 1": {
        "qf_project_id": "63341eb4-bc81-4607-a3d6-580ea2a7457c",
        "ff_project_id": "7d8b94d6-8e5a-4dbb-9ede-69ce3884e004",
        "gpkg_path": "Poles.gpkg",
        "table_name": "Poles",
        "label_col": "label_1",
    },
    "Thembisa POP 3": {
        "qf_project_id": "5f3b962a-7901-43f7-a284-1c1a9ed7f3d1",
        "ff_project_id": "1de088dd-fe24-43fb-b8d3-94fca61ef91d",
        "gpkg_path": "THM_3_Poles.gpkg",
        "table_name": "thm_3_poles",
        # 'label', not 'label_1'. QField appends _1 when a layer name collides on
        # publish; THM_3_Poles was republished without the collision, so the suffix
        # disappeared. Confirmed against ALL TEN THM_3_Poles.gpkg versions published
        # on 2026-08-06 (v20260806100317 … v20260806143001): every one has `label`
        # with 4,590 non-null values and none has `label_1`. Checked the whole set
        # rather than one version because QFieldCloud republishes on every push, so
        # pinning a single version dates the evidence within hours.
        #
        # The mismatch froze this project's ingest from 2026-08-04 14:02. It failed
        # LOUDLY and correctly — qfield_gpkg_table bails before writing sync state
        # precisely so a no-op run cannot stamp last_version and look fresh forever —
        # but nothing alerted on it, so 27 poles' QA photos captured on 5–6 Aug sat in
        # QField unseen. Johan Scott reported it as "PON 818 wys net 1 paal".
        "label_col": "label",
    },
    "Tonga": {
        "qf_project_id": "7fe59cdc-b1d5-475d-8448-5cf2e9f7175b",
        "ff_project_id": "ce3bf310-d6ba-4ede-ab36-a8c902a5efc6",
        "gpkg_path": "Civil Audit.gpkg",
        "table_name": "civil_audit",
        "label_col": "Pole Label",
    },
    # HT_ civil-audit projects (VeloPlan/OSP handover). Same civil-audit form as FT
    # but with a "1. Permission Slip Photo" prefix that shifts step numbers by +1 —
    # handled by STEP_PATTERNS (leading-word, number-agnostic). Pole label lives in
    # the "Name" column (e.g. HT_MFKGP4_D2964PL); "Lable"/"Pole_ID" are empty/junk.
    # GPKG file is "Civil audit.gpkg" (lower-case "audit"); table match is case-insensitive.
    # gpkg_path is the FAMILY ROOT, not necessarily the file that gets read: the crew
    # renames rather than overwrites ("Civil audit updated_27_07.gpkg"), and
    # resolve_gpkg_path() follows that to the newest member each run. Leave it at the
    # root — pinning a dated name here would need re-pinning after every rename.
    "Mahikeng": {
        "qf_project_id": "e801cd43-7efe-4f7a-bed5-ee0410f3dfd6",
        "ff_project_id": "7794d0ba-95c9-491b-8cb5-7f300c61aa23",
        "gpkg_path": "Civil audit.gpkg",
        "table_name": "civil_audit",
        "label_col": "Name",
        "zone_col": "Phase",
        "spatial_pon": True,
    },
    # HT Namakgale keeps all Phase 1 poles in one audit layer. Unlike the FT
    # forms its hierarchy columns are capitalized and Phase is the zone.
    "Namakgale": {
        "qf_project_id": "b32184d6-1776-4b89-8afd-2907dfca86d4",
        "ff_project_id": "183fe626-7bf7-4793-bdb9-1a1dc2e21aa6",
        "gpkg_path": "Civil Audit.gpkg",
        "table_name": "poles_phase_1",
        "label_col": "NAME",
        "pon_col": "PON",
        "zone_col": "Phase",
    },
    # HT Cradock uses the standard FT civil-audit form (8 steps, "1. Before Photo" —
    # no Permission Slip prefix, so no step shift). Its QField relation table is
    # "civil_audit__civil_audit" (DOUBLE underscore) — do NOT copy Mahikeng's
    # "civil_audit" here; the single-underscore name matches nothing and would
    # re-open the silent gap this entry closes.
    # No zone/PON: "PON" and "PON No" are 100% NULL (0/1667 rows) and there is no
    # Phase column, so pon_col/zone_col are deliberately omitted. spatial_pon is
    # also omitted — resolve_pon_poles.py reports available=false for this project,
    # so enabling it would cost a subprocess per run and still resolve nothing.
    # Poles therefore ingest unzoned until the design layers land.
    "Cradock": {
        "qf_project_id": "a7464d75-88e7-4e1a-ba3d-7978844b9ab7",
        "ff_project_id": "d14b5632-8803-4be6-b567-fb091e9e8a7e",
        "gpkg_path": "Civil Audit.gpkg",
        "table_name": "civil_audit__civil_audit",
        "label_col": "NAME",
    },
    # HT Middelburg — same double-underscore civil-audit table as Cradock, but note
    # the label column is "Name" (mixed case, like Mahikeng), NOT Cradock's "NAME".
    # 962 designed poles; "PON No" is 0/962 non-null and there is no Phase column, so
    # pon_col/zone_col are omitted and poles ingest unzoned, as for Cradock.
    # Registered AHEAD of the coverage-check threshold: pole planting started, so
    # capture volume is about to ramp. Waiting for the >20-photo alert would mean
    # photos sit unextracted until the first cron after the crew crosses that bar.
    # Known upstream data-quality wart (not something this entry can fix): the QGIS
    # project thumbnail "Middelburg EC Rev1.3_cloud_qfield.qgs.png" has been captured
    # into 7 civil step cells across 2 poles. It is not under DCIM/, so it does not
    # resolve in MinIO and is counted as "Skipped (no MinIO)" rather than ingested.
    "Middelburg": {
        "qf_project_id": "f076fad4-b2a5-40b8-bafe-35c20ce09827",
        "ff_project_id": "de408530-76f0-4d10-bf08-cfcd3202f69e",
        "gpkg_path": "Civil Audit.gpkg",
        "table_name": "civil_audit__civil_audit",
        "label_col": "Name",
    },
    # QF project HT_Phalaborwa_Benfarm_V1 carries THREE Phalaborwa areas, not three
    # crews of one: BF_* (18 design files), MK_* (16) and LK_* (14). An earlier note
    # here called them "team GPKGs" and framed onboarding as a table-name problem;
    # that is wrong and is what this entry replaces. Only BF maps to a FibreFlow
    # project. LK and MK have NO project row at all (the only Phalaborwa projects are
    # Ben Farm and Namakgale, and Namakgale is its own QF project b32184d6), so they
    # cannot be registered here: without an ff_project_id of their own they would file
    # another area's poles against Ben Farm. That is a business decision, not config.
    #
    # Consequence to know before LK/MK crews start shooting: EXTRACT-GAP fires on
    # `upstream >= threshold AND ingested == 0`, and `upstream` is the whole QF
    # project's DCIM count. Registering BF makes ingested non-zero, so LK/MK photos
    # landing in the shared DCIM will NOT raise an alert — they will simply never
    # arrive. Tracked in #2497. A ratio-based partial-ingest check was measured and
    # rejected: live ingested/upstream spans 0.46 (Mahikeng) to 1.88 (Etwatwa), so any
    # threshold catching LK/MK also fires permanently on projects that are fine.
    #
    # SIX civil audits exist, not three: the paren set "Civil Audit (BF|LLK|MT).gpkg"
    # (live — BF last written 2026-08-14) and an unparenthesised "Civil Audit BF|LK|
    # MT.gpkg" set left at 2026-07-02/07-27. The old files are not empty — "Civil Audit
    # BF.gpkg" (table bf_poles__bf_poles) and "Civil Audit MT.gpkg" each still hold one
    # photo reference — so BF holds all but one of the captured Ben Farm photos, not
    # literally all of them. Table naming is chaotic across all six: (BF) contains
    # civil_audit_mt__civil_audit_bf, (LLK) and (MT) both contain civil_audit_bf, and
    # "Civil Audit LK.gpkg" contains civil_audit_mt. Never infer a table from a filename
    # here.
    #
    # That this crew uses BOTH conventions is the risk worth knowing. is_family_member
    # was checked over all 60 GPKG names in the folder and BF's family is the singleton
    # ["Civil Audit (BF).gpkg"], so no sibling can be adopted INTO this entry — but the
    # reverse is unguarded. If the crew renames AWAY from the paren name, pick_latest_gpkg
    # returns (None, None), the extractor keeps reading the still-present dead file and
    # logs "SKIP: Already processed this version" forever; select_stale_gpkgs uses the
    # same prefix rule so it cannot report it, and EXTRACT-GAP is already quiet once the
    # first rows land. That is the Mahikeng freeze shape. Pre-existing for every entry
    # here, not introduced by this one — but this project is the likeliest to hit it.
    #
    # table_name and label_col were read off the live file (v20260814174604), not
    # inferred. label_col is "Label" (capital L); this layer's "Name" column exists but
    # is NULL in all 3248 rows. The two plausible wrong spellings fail DIFFERENTLY, and
    # the difference is the whole point of the module docstring above:
    #   "Name"  → SILENT. 0 photos found, no error, and a non-dry run stamps
    #             last_version as though it had succeeded. This is the dangerous one.
    #   "label" → LOUD. "no label column 'label' — refusing to record a sync."
    # Poles are HT_PABA1_Z1_*; LK is PABA3_Z3 and MK is PABA2_Z2. As for Cradock and
    # Middelburg, pon_col/zone_col are deliberately omitted — the layer carries no
    # PON/zone column, so resolve_hierarchy yields (None, None) for every row and poles
    # ingest unzoned rather than wrong.
    "Phalaborwa - Ben Farm": {
        "qf_project_id": "ef0b7147-e56f-43a1-9074-6807e0bedf50",
        "ff_project_id": "67df5c8d-0b3d-4784-9d63-70e3cdd1e2b8",
        "gpkg_path": "Civil Audit (BF).gpkg",
        "table_name": "civil_audit_mt__civil_audit_bf",
        "label_col": "Label",
    },
}

# Also check these alternate GPKGs per project (civil audit vs poles audit)
ALTERNATE_GPKGS = {
    "Mamelodi": {"gpkg_path": "civil_audit_.gpkg", "table_name": "civil_audit_", "label_col": "label"},
    "Thembisa POP 1": {"gpkg_path": "civil_audit_.gpkg", "table_name": "civil_audit_", "label_col": "label_1"},
    # KEEP `label_1` here even though the primary THM_3 entry above is now `label`.
    # These are DIFFERENT LAYERS and the suffix is per-layer, not per-project: the
    # civil-audit layer still collides on publish, the poles layer no longer does.
    # Verified against the live file — `Civil Audit.gpkg` for POP 3 (latest version
    # v20260310073855) has table `civil_audit_` with `label_1`, 3,597 rows, and no
    # `label`. An earlier revision of this PR "corrected" it to `label` by analogy with
    # the poles layer; that was wrong and is reverted.
    #
    # Note the path is also wrong and has always been: the object is `Civil Audit.gpkg`
    # (space, title case), not `civil_audit_.gpkg` — that is the TABLE name. So this
    # entry does not resolve, which is why no sync-state row has ever been written for
    # a civil_audit_ alternate. Left as-is rather than silently repointing a path at a
    # 3,597-row March layer that nothing currently ingests.
    "Thembisa POP 3": {"gpkg_path": "civil_audit_.gpkg", "table_name": "civil_audit_", "label_col": "label_1"},
}

# Per-pole OPTICAL dome-audit GPKGs (8 dome steps). Detected as discipline='optical'
# by OPTICAL_STEP_PATTERNS and ingested as work_type='dome_joint' / feature_type='joint'.
# label_col = 'label' holds the dome/splitter identifier, which becomes the optical
# 'joint' feature_id (matching the existing optical-joint review convention).
OPTICAL_GPKGS = {
    "Mohadin": {"gpkg_path": "Optical Audit.gpkg", "table_name": "optical_audit", "label_col": "label"},
    "Mamelodi": {"gpkg_path": "Optical Audit 2.0.gpkg", "table_name": "optical_audit_", "label_col": "label"},
    "Etwatwa": {"gpkg_path": "Optical Audit.gpkg", "table_name": "optical_audit", "label_col": "label"},
    "Thembisa POP 1": {"gpkg_path": "Optical Audit.gpkg", "table_name": "optical_audit_", "label_col": "label"},
    "Thembisa POP 3": {"gpkg_path": "Optical Audit.gpkg", "table_name": "optical_audit", "label_col": "label"},
    "Themb'elihle": {"gpkg_path": "Optical Audit.gpkg", "table_name": "optica_audit", "label_col": "label"},
    # Lawley's dome audit is "LAWJoints.gpkg" / table "LAWJoints" (8 dome-step cols),
    # label = dome label e.g. "LAW.STS.8.DIS.DM.P.D832-C#P#.L#". Previously unregistered,
    # so Lawley's dome photos never ingested with steps; only ~25 captured so far but
    # this wires the path so future dome audits auto-slot (like the other projects).
    "Lawley": {"gpkg_path": "LAWJoints.gpkg", "table_name": "LAWJoints", "label_col": "label"},
}
