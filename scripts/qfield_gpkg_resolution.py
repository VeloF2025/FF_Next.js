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
  * notice the freeze  — compare the last successful GPKG sync against the newest
    field photo upstream, so any *other* way of getting stuck still gets flagged.

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

    Match is a normalized prefix that must end on a WORD BOUNDARY, so
    'Civil audit.gpkg' claims 'Civil audit updated_27_07.gpkg' and
    'Civil_Audit_V02.gpkg' but never 'Civil auditor.gpkg' — and never a different
    form entirely ('Optical Audit.gpkg', 'MAMPoles.gpkg').

    The prefix direction matters: crews only ever APPEND to the name ("updated_27_07",
    "V02"). A suffix or substring match would let a project's optical audit capture
    its civil audit and silently ingest the wrong layer.
    """
    base = normalize_stem(configured_name)
    cand = normalize_stem(candidate_name)
    if not base or not cand:
        return False
    return cand == base or cand.startswith(base + " ")


def family_members(configured_name, candidate_versions):
    """{filename: version} — the candidates belonging to configured_name's family.

    Versionless entries are dropped: QFieldCloud keeps an empty folder behind a file
    that was created and never written (Mahikeng's 'Civil_Audit_V02.gpkg'), and such
    a placeholder must never win the newest-file contest.
    """
    return {
        name: ver
        for name, ver in (candidate_versions or {}).items()
        if ver and is_family_member(configured_name, name)
    }


def pick_latest_gpkg(configured_name, candidate_versions):
    """Pick the newest GPKG in configured_name's family.

    candidate_versions: {filename: latest_version_id} for the GPKGs in the project.
    Returns (filename, version_id), or (None, None) to mean "no redirect — use the
    configured name". Fails OPEN to today's behaviour rather than skipping a project.

    REQUIRES THE CONFIGURED FILE TO EXIST UNDER ITS EXACT NAME. A family whose
    configured member is absent returns (None, None) even when other members are
    present, which deliberately keeps the blast radius at the reported bug — the
    configured name is the anchor of trust, and without it there is nothing to prove
    the family root ever meant this project's form.

    The presence test is exact, NOT normalized, even though family membership is
    normalized. Three ALTERNATE_GPKGS entries (Mamelodi / Thembisa POP 1 / POP 3 →
    'civil_audit_.gpkg') name files that are not in MinIO at all, and 'civil_audit_'
    normalizes to exactly 'civil audit' — so a normalized presence test would treat
    Thembisa's real 'Civil Audit.gpkg' as "the configured file, found" and start
    ingesting a never-before-ingested audit through a second fallback
    (pick_photo_table) in the same run. Those entries need their own verification,
    not silent adoption by a resolver written for a different bug.

    The configured file wins ties so two files sharing a version id can never
    flip-flop the choice between runs.
    """
    family = family_members(configured_name, candidate_versions)
    if not family or configured_name not in family:
        return None, None

    def rank(item):
        name, version = item
        return (version, 1 if name == configured_name else 0)

    return max(family.items(), key=rank)


def pick_photo_table(configured_table, photo_column_counts):
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

    Returns None when nothing has photo columns — the caller then errors out loudly
    instead of ingesting an arbitrary layer.
    """
    counts = photo_column_counts or {}
    for table in counts:
        if table.lower() == (configured_table or "").lower():
            return table

    best = None
    for table, n in counts.items():
        if n > 0 and (best is None or n > counts[best]):
            best = table
    return best


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


def gpkg_sync_lag_days(last_synced_at, latest_upstream_photo_at):
    """How many days the GPKG ingest is behind the newest field photo upstream.

    Returns a float, or None when either side is unknown — an unknown lag is NOT
    a zero lag, and the caller must not treat it as healthy.

    This is the freeze detector: crews upload photos continuously, so a project
    whose newest DCIM upload is days newer than its last successful GPKG scan is
    not reaching the dashboard, whatever the cause (renamed GPKG, deleted GPKG,
    failed download, renamed layer). Negative lags clamp to 0.0 — a sync newer
    than the newest photo just means we are fully caught up.
    """
    synced = parse_pg_timestamp(last_synced_at)
    newest = parse_pg_timestamp(latest_upstream_photo_at)
    if synced is None or newest is None:
        return None
    return max(0.0, (newest - synced).total_seconds() / 86400.0)


def version_timestamp(version_id):
    """'v20260727145257-6bc52280' → datetime(2026, 7, 27, 14, 52, 57, tz=UTC), else None."""
    m = _VERSION_RE.match((version_id or "").strip())
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
