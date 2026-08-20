"""
Pure GPKG family/staleness resolution — NO external dependencies (no MinIO, no DB).

Field teams rename an audit GPKG in place rather than overwriting it:

    Civil audit.gpkg              ← what PROJECTS pins, frozen 2026-07-22
    Civil audit updated_22_07.gpkg
    Civil audit updated_27_07.gpkg ← where the crew actually works now

PROJECTS in extract-gpkg-photos.py names ONE exact filename, so after such a rename
the extractor keeps downloading a file nobody writes to any more and logs
"SKIP: Already processed this version" on every run. That froze Mahikeng's ingest
for 5 days and 918 photos (571 ingested vs 1 458 in the field) while every cron run
reported success — and the coverage check stayed quiet because its guarantee only
covers projects with ZERO ingested photos, not stale ones.

Two independent defences live here:
  * follow the rename  — read every member of the configured file's family, newest
    first, then find the photo table inside each (the layer name tracks the filename,
    so it drifts too);
  * notice the freeze  — per file, ask whether a newer file exists that we are not
    reading: a newer version of the tracked path, or a newer same-family sibling
    (which is how a rename presents). See select_stale_gpkgs.

Split out from extract-gpkg-photos.py / works-qa-coverage-check.py so it is
unit-testable without MinIO or psycopg2 — gated in CI by
scripts/test_qfield_gpkg_resolution.py.
"""
import re
from datetime import datetime, timezone

GPKG_SUFFIX = ".gpkg"

# QFieldCloud version ids look like "v20260727145257-6bc52280" — a zero-padded
# UTC timestamp then a hash, so plain string ordering IS upload ordering.
_VERSION_RE = re.compile(r"^v(\d{14})-")


def normalize_stem(name):
    """'Civil audit updated_27_07.gpkg' → 'civil audit updated 27 07'.

    Separator-insensitive and case-insensitive: crews retype these names by hand,
    so '_', '-', '.' and runs of spaces all collapse to a single space. Applied to
    both sides of every comparison, so the exact separators never matter.
    """
    s = (name or "").strip()
    if s.lower().endswith(GPKG_SUFFIX):
        s = s[: -len(GPKG_SUFFIX)]
    s = re.sub(r"[_\-.]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


def is_family_member(configured_name, candidate_name, require_version_marker=True):
    """True when candidate is the configured GPKG, or a renamed successor of it.

    Match is a normalized prefix that must end on a WORD BOUNDARY **and** whose
    remainder must contain a DIGIT:

        Civil audit.gpkg  →  Civil audit updated_27_07.gpkg   ✓  ("updated 27 07")
                             Civil_Audit_V02.gpkg             ✓  ("v02")
                             Poles HLD.gpkg                   ✗  (no digit)
                             Poles drag and drop.gpkg         ✗  (no digit)

    The digit requirement separates a rename from a SIBLING DOCUMENT. Without it,
    Thembisa POP 1 (registered on the generic 'Poles.gpkg') adopts any
    'Poles <word>.gpkg' — and its MinIO folder ALREADY holds 'Poles drag and drop.shp'
    while THM POP 3 carries a real 'Poles HLD.gpkg'. One QGIS "export to GeoPackage"
    would repoint that ingest at a scratch layer with no photo columns. Prefix
    direction matters too: crews only APPEND, so a substring match would let a
    project's optical audit capture its civil audit.

    `require_version_marker=False` drops the digit test — the looser "could be a
    rename" question. Deliberate asymmetry: the RESOLVER must be strict because it
    silently changes which file feeds the database; the MONITOR only prints a line for
    a human, so it asks the broader question. Mahikeng holds `PON Progress.gpkg`,
    `PON Progress V2.gpkg` AND `PON Progress new.gpkg` — the same crew uses both
    conventions, so `Civil audit new.gpkg` is a rename the resolver declines and only
    the loose form can report.
    """
    base = normalize_stem(configured_name)
    cand = normalize_stem(candidate_name)
    if not base or not cand:
        return False
    if cand == base:
        return True
    if not cand.startswith(base + " "):
        return False
    if not require_version_marker:
        return True
    return any(ch.isdigit() for ch in cand[len(base) + 1:])


def family_members(configured_name, candidate_versions):
    """{filename: version} — the candidates belonging to configured_name's family.

    Two kinds of entry are dropped:
      * versionless — QFieldCloud keeps an empty folder behind a file that was created
        and never written (Mahikeng's 'Civil_Audit_V02.gpkg'); a placeholder must never
        win the newest-file contest;
      * unparseable version ids — anything not 'v<14 digits>-…'. Ordering is by parsed
        timestamp (see order_family_gpkgs), so a token that cannot be parsed cannot be
        ranked. Silently sorting it as a plain string is how an unexpected key shape
        would win the contest and get downloaded.
    """
    return {
        name: ver
        for name, ver in (candidate_versions or {}).items()
        if ver and version_timestamp(ver) and is_family_member(configured_name, name)
    }


def order_family_gpkgs(configured_name, candidate_versions):
    """Every member of configured_name's family, newest-uploaded FIRST.

    The extractor reads all of them each run; this decides the order and whether the
    family may be expanded at all. Returns [] to mean "no expansion — read only the
    configured name", which keeps a MinIO hiccup or a misconfigured path from silently
    redirecting a project's ingest somewhere unexpected.

    THE CONFIGURED FILE MUST BE PRESENT UNDER ITS EXACT NAME — it is the anchor of
    trust. The presence test is exact, NOT normalized, even though membership is:
    three ALTERNATE_GPKGS entries (Mamelodi / Thembisa POP 1 / POP 3 →
    'civil_audit_.gpkg') name files absent from MinIO, and 'civil_audit_' normalizes to
    exactly 'civil audit', so a normalized test would treat Thembisa's real
    'Civil Audit.gpkg' as "found" and ingest a never-reviewed audit.

    Ordering is by PARSED version timestamp, not string compare; family_members has
    already dropped anything unparseable. The configured file wins ties.

    Newest-first matters operationally, not cosmetically: the actively-written file is
    the one whose photos are wanted on the dashboard soonest, and it is the one whose
    log lines a human reads first when a run is truncated.

    Why ALL members rather than the single newest this used to pick: a family is not
    always a rename chain. HT Namakgale carries four concurrent civil-audit layers
    ('Civil Audit.gpkg' + 'Civil Audit phase_2_/3_/4_.gpkg'), all published within one
    second on 2026-08-14 and all still written to. Reading only the newest means the
    other three are never read — and each carries the full set of 8 civil photo
    columns, so the day a crew captures into one, those photos are dropped in silence.
    """
    family = family_members(configured_name, candidate_versions)
    if not family or configured_name not in family:
        return []

    def rank(item):
        name, version = item
        return (version_timestamp(version), 1 if name == configured_name else 0)

    return [name for name, _ in sorted(family.items(), key=rank, reverse=True)]


def pick_photo_table(configured_table, photo_column_counts, prefer_stem=None):
    """Choose the photo-bearing layer inside a GPKG.

    photo_column_counts: {table_name: number_of_detected_photo_columns}, in the
    GPKG's own table order.

    An exact (case-insensitive) match on the configured table always wins, so every
    project that works today keeps resolving byte-identically. The count-based
    fallback only runs when the configured table is ABSENT — the rename case, where
    the layer name tracked the filename ('civil_audit' → 'civil_audit_updated_27_07').
    Picking the table with the most photo columns lands on the layer the extractor
    would have used anyway, and skips GPKG relation/attachment side-tables
    ('civil_audit__civil_audit'), which carry none.

    `prefer_stem` breaks ties. Without it, an exact tie fell to whichever table came
    first in sqlite_master order — i.e. CREATION order, the OLDEST layer. A GPKG that
    kept both copies of a form (a QGIS "Save As" leaving 'civil_audit_updated_22_07'
    beside 'civil_audit_updated_27_07', identical column counts) would therefore ingest
    the stale one and reproduce the freeze one level down. Passing the resolved
    filename makes the layer whose name matches the file win instead; failing that,
    the LAST tying table wins, since sqlite_master order puts the newest layer last.

    Returns None when nothing has photo columns — the caller then errors out loudly
    instead of ingesting an arbitrary layer.
    """
    counts = photo_column_counts or {}
    for table in counts:
        if table.lower() == (configured_table or "").lower():
            return table

    best_n = max((n for n in counts.values() if n > 0), default=0)
    if not best_n:
        return None
    tied = [t for t, n in counts.items() if n == best_n]
    if len(tied) == 1:
        return tied[0]

    if prefer_stem:
        stem = normalize_stem(prefer_stem)
        for table in tied:
            if normalize_stem(table) == stem:
                return table
    return tied[-1]


# `mc ls` renders a versioned file's version folder as a directory entry:
#   [2026-07-27 15:06:40 UTC]     0B Civil audit updated_27_07.gpkg/
# Anchor on the bracketed timestamp + size token so names containing spaces survive.
_MC_DIR_RE = re.compile(r"^\[[^\]]*\]\s+\S+\s+(.+/)$")


def parse_mc_gpkg_names(mc_ls_output):
    """Extract the .gpkg directory names from `mc ls <prefix>/` output.

    Lives here rather than beside the subprocess call so the parsing is testable
    without MinIO — fiddly string handling (spaces in names, a size token that is not
    always '0B') is exactly what silently returns [] and freezes an ingest.

    Names containing a path separator are rejected: the name is interpolated straight
    into a MinIO prefix, so a '/' could address a different object. Non-recursive
    `mc ls` should never emit one; this enforces that rather than trusting it.
    """
    names = []
    for line in (mc_ls_output or "").split("\n"):
        m = _MC_DIR_RE.match(line.strip())
        if not m:
            continue
        name = m.group(1).rstrip("/")
        if not name.lower().endswith(GPKG_SUFFIX):
            continue
        if "/" in name or name.startswith("."):
            continue
        names.append(name)
    return names


def version_timestamp(version_id):
    """'v20260727145257-6bc52280' → datetime(2026, 7, 27, 14, 52, 57, tz=UTC), else None."""
    m = _VERSION_RE.match((version_id or "").strip())
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
