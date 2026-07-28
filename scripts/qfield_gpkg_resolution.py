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
  * follow the rename  — pick the newest member of the configured file's family,
    then find the photo table inside it (the layer name tracks the filename, so it
    drifts too);
  * notice the freeze  — compare the version of the GPKG we ingested against the
    newest field photo upstream, per file, so any *other* way of getting stuck still
    gets flagged. Measuring the GPKG rather than the last script run is the whole
    point; see gpkg_version_lag_days for what the obvious signal gets wrong.

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


def is_family_member(configured_name, candidate_name):
    """True when candidate is the configured GPKG, or a renamed successor of it.

    Match is a normalized prefix that must end on a WORD BOUNDARY **and** whose
    remainder must contain a DIGIT:

        Civil audit.gpkg  →  Civil audit updated_27_07.gpkg   ✓  ("updated 27 07")
                             Civil_Audit_V02.gpkg             ✓  ("v02")
                             Poles HLD.gpkg                   ✗  (no digit)
                             Poles drag and drop.gpkg         ✗  (no digit)

    The digit requirement separates a rename from a SIBLING DOCUMENT. Every real
    rename here stamps a version or date; the dangerous look-alikes do not. Without
    it, Thembisa POP 1 (registered on the generic 'Poles.gpkg') adopts any
    'Poles <word>.gpkg' — and its MinIO folder ALREADY holds 'Poles drag and drop.shp'
    while THM POP 3 carries a real 'Poles HLD.gpkg'. One QGIS "export to GeoPackage"
    would repoint that ingest at a scratch layer with no photo columns: a silent
    freeze, the exact failure this module exists to prevent.

    Prefix direction matters too: crews only ever APPEND. A suffix or substring match
    would let a project's optical audit capture its civil audit.
    """
    base = normalize_stem(configured_name)
    cand = normalize_stem(candidate_name)
    if not base or not cand:
        return False
    if cand == base:
        return True
    if not cand.startswith(base + " "):
        return False
    return any(ch.isdigit() for ch in cand[len(base) + 1:])


def family_members(configured_name, candidate_versions):
    """{filename: version} — the candidates belonging to configured_name's family.

    Two kinds of entry are dropped:
      * versionless — QFieldCloud keeps an empty folder behind a file that was created
        and never written (Mahikeng's 'Civil_Audit_V02.gpkg'); a placeholder must never
        win the newest-file contest;
      * unparseable version ids — anything not 'v<14 digits>-…'. Ordering is by parsed
        timestamp (see pick_latest_gpkg), so a token that cannot be parsed cannot be
        ranked. Silently sorting it as a plain string is how an unexpected key shape
        would win the contest and get downloaded.
    """
    return {
        name: ver
        for name, ver in (candidate_versions or {}).items()
        if ver and version_timestamp(ver) and is_family_member(configured_name, name)
    }


def pick_latest_gpkg(configured_name, candidate_versions):
    """Pick the newest GPKG in configured_name's family.

    candidate_versions: {filename: latest_version_id} for the GPKGs in the project.
    Returns (filename, version_id), or (None, None) to mean "no redirect — use the
    configured name". Fails OPEN to today's behaviour rather than skipping a project.

    REQUIRES THE CONFIGURED FILE TO EXIST UNDER ITS EXACT NAME — the configured name
    is the anchor of trust; without it nothing proves the family root ever meant this
    project's form. The presence test is exact, NOT normalized, even though membership
    is. Three ALTERNATE_GPKGS entries (Mamelodi / Thembisa POP 1 / POP 3 →
    'civil_audit_.gpkg') name files absent from MinIO, and 'civil_audit_' normalizes to
    exactly 'civil audit' — so a normalized presence test would treat Thembisa's real
    'Civil Audit.gpkg' as "found" and ingest a never-before-ingested audit through a
    second fallback (pick_photo_table) in the same run. Those need their own
    verification, not silent adoption by a resolver written for a different bug.

    Ordering is by PARSED version timestamp, not raw string compare: string order only
    matches upload order while every id is the same 'v<14 digits>-<hash>' shape, and
    family_members has already discarded anything that is not. The configured file
    wins ties so two files sharing a version can never flip-flop the choice.
    """
    family = family_members(configured_name, candidate_versions)
    if not family or configured_name not in family:
        return None, None

    def rank(item):
        name, version = item
        return (version_timestamp(version), 1 if name == configured_name else 0)

    return max(family.items(), key=rank)


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


def parse_pg_timestamp(value):
    """Parse a Postgres/QFieldCloud timestamp into an aware UTC datetime, or None.

    Handles both the psycopg2 datetime objects the FibreFlow side returns and the
    text psql -A emits for QFieldCloud ('2026-07-27 14:53:24.295485+00' — note the
    two-digit offset, which datetime.fromisoformat rejects before Python 3.11).
    Naive values are read as UTC, matching how both databases store these columns.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip()
        if not s:
            return None
        # '…+00' / '…-05' → '…+00:00' / '…-05:00'
        s = re.sub(r"([+-]\d{2})$", r"\1:00", s)
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def gpkg_behind_days(ingested_version, available_version, now):
    """Days we have been sitting on an older version than MinIO holds; None if not behind.

    Returns None when the two versions match (nothing to ingest — the form is simply
    dormant) or when either id is unparseable. Otherwise the age of the version we
    are NOT reading: how long the newer file has been available and ignored.
    """
    if not available_version or available_version == ingested_version:
        return None
    available_at = version_timestamp(available_version)
    if available_at is None or version_timestamp(ingested_version) is None:
        return None
    return max(0.0, (now - available_at).total_seconds() / 86400.0)


def select_stale_gpkgs(sync_rows, minio_newest, now, stale_days):
    """Pick the GPKGs where a newer file exists that we are not ingesting.

    sync_rows:    [{qf_uuid, gpkg_path, last_version}]      — one row PER FILE
    minio_newest: {(qf_uuid, gpkg_path): newest version id} — one entry PER FILE
    Returns [(qf_uuid, gpkg_path, days_behind, available_version)], worst-first.

    COMPARE LIKE WITH LIKE. Two earlier shapes both failed on production data:

      * MAX(last_synced_at) per project vs the newest photo — per-project against
        per-project — let any active sibling MASK a stuck file (1 of 16 detected).
      * last_version of one file vs the newest DCIM upload anywhere in the project —
        per-file numerator, per-project denominator — CRIED WOLF instead: all 5 rows
        it flagged had already ingested every version MinIO held. DCIM is project-wide
        and cannot be attributed to a form, so any project whose forms are worked at
        different times over-fires, and a finished form's lag grows forever.

    So the question is not "how old is what we read" but "is there something newer we
    are failing to read". A dormant form (no newer version) can never flag no matter
    how long it lies untouched; a genuinely stuck one flags as soon as the newer file
    has been available longer than stale_days. That also makes the alert actionable:
    it names a file that demonstrably exists and is being skipped.

    Skipped, not flagged, when the comparison cannot be computed — a transient MinIO
    listing failure yields no entry, and this monitor must fail quiet on missing data
    rather than page on it.
    """
    out = []
    for row in sync_rows or []:
        key = (row.get("qf_uuid"), row.get("gpkg_path"))
        available = (minio_newest or {}).get(key)
        behind = gpkg_behind_days(row.get("last_version"), available, now)
        if behind is not None and behind > stale_days:
            out.append((key[0], key[1], behind, available))
    out.sort(key=lambda r: r[2], reverse=True)
    return out


# `mc ls` renders a versioned file's version folder as a directory entry:
#   [2026-07-27 15:06:40 UTC]     0B Civil audit updated_27_07.gpkg/
# Anchor on the bracketed timestamp + size token so names containing spaces survive.
_MC_DIR_RE = re.compile(r"^\[[^\]]*\]\s+\S+\s+(.+/)$")


def parse_mc_gpkg_names(mc_ls_output):
    """Extract the .gpkg directory names from `mc ls <prefix>/` output.

    Lives here rather than beside the subprocess call so the parsing is testable
    without MinIO — fiddly string handling (spaces in names, a size token that is not
    always '0B') is exactly what silently returns [] and freezes an ingest.

    Entries whose name contains a path separator are rejected: the name is
    interpolated straight into a MinIO prefix, and a '/' would let a crafted key
    address a different object. Non-recursive `mc ls` should never emit one, but the
    guard means that assumption is enforced here rather than trusted.
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
