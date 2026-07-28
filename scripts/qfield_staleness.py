"""
Pure staleness detection for QField GPKG ingestion — no MinIO, no DB.

Answers one question per tracked GPKG: is there a newer file we are failing to read?

Split from qfield_gpkg_resolution.py, which decides WHICH file to read. This module
decides whether we are BEHIND — the monitor half. Both are pure so they stay
unit-testable without MinIO or psycopg2; gated in CI by
scripts/test_qfield_gpkg_resolution.py.
"""
import re
from datetime import datetime, timezone

from qfield_gpkg_resolution import version_timestamp

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


def select_stale_gpkgs(sync_rows, minio_newest, sibling_newest, now, stale_days):
    """Pick the GPKGs where a newer file exists that we are not ingesting.

    sync_rows:      [{qf_uuid, gpkg_path, last_version}]        — one row PER FILE
    minio_newest:   {(qf_uuid, gpkg_path): newest version id}   — the SAME path
    sibling_newest: {(qf_uuid, gpkg_path): (name, version)}     — newest LOOSE sibling
    Returns [(qf_uuid, gpkg_path, days_behind, available_ref)], worst-first.

    TWO conditions, unioned — either alone leaves a hole:

      (a) the SAME path has a newer version we have not read. Catches a failed
          download or a renamed layer.
      (b) a same-family SIBLING is newer than what we ingested. Catches a RENAME —
          where the new work lives at a DIFFERENT path, so (a) is structurally blind
          to it: the tracked file just sits there unchanged, looking dormant.

    (b) is not redundant with the resolver. The resolver follows only version-stamped
    renames, so a non-numeric one ("Civil audit new.gpkg") freezes the ingest with the
    resolver correctly declining to act — and without (b) nothing anywhere would
    report it. It uses the LOOSE family rule for exactly that reason.

    COMPARE LIKE WITH LIKE. Two earlier shapes failed on production data: per-project
    MAX(last_synced_at) vs newest photo let an active sibling MASK a stuck file (1 of
    16 detected); per-file last_version vs project-wide newest DCIM CRIED WOLF (all 5
    flags were dormant forms, since DCIM cannot be attributed to a form). The question
    is not "how old is what we read" but "is there something newer we are failing to
    read" — so a dormant form can never flag, and the alert names the file.

    Skipped, not flagged, when the comparison cannot be computed — a transient MinIO
    listing failure yields no entry, and this monitor must fail quiet on missing data
    rather than page on it.
    """
    out = []
    for row in sync_rows or []:
        key = (row.get("qf_uuid"), row.get("gpkg_path"))
        ingested = row.get("last_version")

        # (a) same path, newer version
        behind = gpkg_behind_days(ingested, (minio_newest or {}).get(key), now)
        ref = (minio_newest or {}).get(key)

        # (b) a newer sibling — only when it is genuinely newer than what we ingested
        sib = (sibling_newest or {}).get(key)
        if sib:
            sib_name, sib_version = sib
            sib_at, ing_at = version_timestamp(sib_version), version_timestamp(ingested)
            if sib_at and ing_at and sib_at > ing_at:
                sib_behind = max(0.0, (now - sib_at).total_seconds() / 86400.0)
                if behind is None or sib_behind > behind:
                    behind, ref = sib_behind, f"{sib_name} {sib_version}"

        if behind is not None and behind > stale_days:
            out.append((key[0], key[1], behind, ref))
    out.sort(key=lambda r: r[2], reverse=True)
    return out
