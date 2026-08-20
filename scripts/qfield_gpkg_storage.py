"""
GPKG file resolution in MinIO — WHICH version of a project's GeoPackage to read.

Lists the versions of a GPKG path, follows a rename to the newest member of the same
family (crews rename rather than overwrite: "Civil audit.gpkg" → "Civil audit
updated_27_07.gpkg", which silently pinned Mahikeng's ingest to a dead file and lost
918 photos over 5 days), and downloads the chosen version.

Split out of extract-gpkg-photos.py. Pairs with qfield_photo_storage, which answers
the different question of where an individual DCIM photo blob lives; the two share no
calls, which is why they are separate modules rather than one 314-line file.

IMPORTANT for tests: the extractor imports these by NAME (`from qfield_gpkg_storage
import minio_download_latest`) so the characterization harness can monkeypatch them
via `setattr(extractor_module, name, stub)`. Calling them module-qualified from the
extractor would silently defeat that patching and blind the suite — don't.
"""
import subprocess

from qfield_gpkg_resolution import (
    is_family_member,
    order_family_gpkgs,
    parse_mc_gpkg_names,
)

# MinIO bucket. Deliberately restated rather than imported from a sibling module: the
# two storage modules have zero call-dependency on each other (verified — no function
# in one calls any function in the other), and inventing an import just to share one
# constant would couple them for nothing. ~8 other scripts in this repo already
# declare it the same way; consolidating all of them is its own piece of work.
MINIO_BUCKET = "qfieldcloud-prod"

# Upper bound on how many same-family GPKGs we version-list in one run. Each costs an
# `mc ls` subprocess, and a collaborator can create arbitrarily many same-prefixed
# copies. Truncation is LOGGED, never silent — a quiet cap would be the same class of
# invisible failure this module exists to remove.
MAX_FAMILY_CANDIDATES = 25

def minio_list_gpkg_versions(qf_project_id, gpkg_path):
    """Sorted version ids for one GPKG in MinIO ([] on any failure)."""
    prefix = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{gpkg_path}/"
    try:
        result = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", prefix],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return []
        # Use STANDARD-marker parsing to handle filenames containing spaces.
        versions = []
        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            std_idx = line.find(" STANDARD ")
            if std_idx == -1:
                continue
            ver = line[std_idx + len(" STANDARD "):].strip().rstrip("/")
            if ver:
                versions.append(ver)
        versions.sort()
        return versions
    except Exception as e:
        print(f"    MinIO error listing versions of {gpkg_path}: {e}")
        return []


def minio_list_gpkg_family(qf_project_id, configured_path):
    """{gpkg_filename: latest_version} for every GPKG in the project's files/ dir.

    One `mc ls` of files/ plus one per GPKG found — a handful of small calls, unlike
    DCIM which holds thousands of objects and is never walked here. Returns {} on any
    failure so the caller falls back to the configured filename (fail OPEN: a MinIO
    hiccup must not skip the project or redirect it somewhere unexpected).
    """
    prefix = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/"
    try:
        result = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", prefix],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"    WARN: mc ls files/ failed for {qf_project_id}: {result.stderr.strip()[:120]}")
            return {}
    except Exception as e:
        print(f"    WARN: mc ls files/ error for {qf_project_id}: {e}")
        return {}

    # Only version-list the family members — the whole point is to avoid touching
    # unrelated GPKGs (a project can carry a dozen: poles, optical, boundaries…, and
    # the FT projects each hold ~90 dated "OES FF DDMMYYYY.gpkg" exports).
    candidates = sorted(n for n in parse_mc_gpkg_names(result.stdout)
                        if is_family_member(configured_path, n))
    if len(candidates) > MAX_FAMILY_CANDIDATES:
        # Keep the configured file whatever else goes: without it order_family_gpkgs
        # refuses to expand at all, so dropping it would turn a cap into a silent
        # loss of the whole feature. Descending order keeps the newest date-stamped
        # names, which are the plausible rename targets.
        keep = [configured_path] if configured_path in candidates else []
        keep += [n for n in sorted(candidates, reverse=True) if n != configured_path]
        dropped = sorted(set(candidates) - set(keep[:MAX_FAMILY_CANDIDATES]))
        print(f"    WARN: {len(candidates)} family candidates for '{configured_path}' exceeds "
              f"cap {MAX_FAMILY_CANDIDATES}; NOT version-listing {len(dropped)}: {dropped}")
        candidates = keep[:MAX_FAMILY_CANDIDATES]

    family = {}
    for name in candidates:
        versions = minio_list_gpkg_versions(qf_project_id, name)
        if versions:
            family[name] = versions[-1]
    return family


def resolve_gpkg_paths(qf_project_id, configured_path):
    """Every GPKG in configured_path's family, newest first — all of them get read.

    Returns a list of filenames to actually read, always non-empty. Falls back to
    [configured_path] whenever the family cannot be listed or the configured file is
    not present under its exact name.

    Replaces the earlier resolve_gpkg_path(), which returned only the single newest
    member. That followed a crew RENAME correctly but mis-handled a crew SPLIT: HT
    Namakgale publishes four concurrent civil-audit layers, and picking the newest
    meant the other three went unread — including, on 2026-08-14, a redirect onto
    'Civil Audit phase_2_.gpkg' that then left it stranded when the base file was next
    written. See order_family_gpkgs for why every member is read instead.
    """
    family = minio_list_gpkg_family(qf_project_id, configured_path)
    ordered = order_family_gpkgs(configured_path, family)

    if not ordered:
        # order_family_gpkgs refuses to expand when the configured file itself is
        # missing. Say so out loud — that is a real misconfiguration (the download
        # below will fail), just not one this function is allowed to guess its way
        # out of. Mahikeng reached exactly this state on 2026-08-04: the crew renamed
        # ACROSS the family prefix ('Civil audit updated_30_07.gpkg' →
        # 'new_civil_audit_04_08_2026.gpkg'), every old version folder was emptied,
        # and ~6 000 photos went unread for 17 days behind a quiet log line.
        if family and configured_path not in family:
            print(f"  WARN: configured '{configured_path}' is not in MinIO. Same-family "
                  f"files exist ({sorted(family)}) but auto-expansion requires the "
                  f"configured file to exist — fix PROJECTS/ALTERNATE_GPKGS instead.")
        return [configured_path]

    if len(ordered) > 1:
        print(f"  FAMILY: reading all {len(ordered)} same-family GPKG(s): {ordered}")
    return ordered


def minio_latest_version(qf_project_id, gpkg_path):
    """The newest version id of one GPKG, or None — WITHOUT downloading it.

    Split out so the delta check can run before the transfer. Every family member is
    read on every run now, and a member nobody has touched since the last run is the
    common case (dead rename history, a phase layer between captures): downloading
    ~1.3MB per member per run only to print "Already processed this version" is pure
    waste that scales with how many times a crew has ever renamed the file.
    """
    versions = minio_list_gpkg_versions(qf_project_id, gpkg_path)
    return versions[-1] if versions else None


def minio_download_latest(qf_project_id, gpkg_path, dest_path, version=None):
    """Download a GPKG from MinIO — `version` if given, else the latest.

    Pass `version` when the caller has already resolved it via minio_latest_version()
    to skip a second `mc ls`.
    """
    try:
        latest = version or minio_latest_version(qf_project_id, gpkg_path)
        if not latest:
            return None, None

        # Download
        src = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{gpkg_path}/{latest}"
        dl = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "cat", src],
            capture_output=True, timeout=30,
        )
        if dl.returncode != 0 or len(dl.stdout) < 1000:
            return None, None

        with open(dest_path, "wb") as f:
            f.write(dl.stdout)
        return latest, len(dl.stdout)

    except Exception as e:
        print(f"    MinIO error: {e}")
        return None, None
