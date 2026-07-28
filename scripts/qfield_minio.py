"""
MinIO reads for the Works-QA coverage check — the I/O half of staleness detection.

Answers two questions per tracked GPKG, both by listing object storage:
  * what is the newest version of this exact path?
  * what is the newest same-family SIBLING (i.e. has it been renamed)?

Split out of works-qa-coverage-check.py, which is otherwise DB-and-report, so that
file stays under the 300-line limit and this stays independently readable. The pure
decision logic lives in qfield_staleness.py; nothing here decides anything.
"""
import subprocess
import sys

from qfield_gpkg_resolution import is_family_member, parse_mc_gpkg_names

MINIO_BUCKET = "qfieldcloud-prod"


def _mc_ls(prefix, timeout=30):
    """`mc ls <prefix>` stdout, or None if the listing failed."""
    try:
        res = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", prefix],
            capture_output=True, text=True, timeout=timeout,
        )
        return res.stdout if res.returncode == 0 else None
    except Exception as e:  # noqa: BLE001 — a listing failure must not fail the monitor
        print(f"  WARN: mc ls failed for {prefix}: {e}", file=sys.stderr)
        return None


def _newest_version(prefix):
    """Newest version id under a versioned-file prefix, or None."""
    out = _mc_ls(prefix)
    if out is None:
        return None
    versions = []
    for line in out.strip().split("\n"):
        idx = line.find(" STANDARD ")
        if idx != -1:
            v = line[idx + len(" STANDARD "):].strip().rstrip("/")
            if v:
                versions.append(v)
    return sorted(versions)[-1] if versions else None


def minio_newest_versions(sync_rows):
    """{(qf_uuid, gpkg_path): newest version id} for each tracked GPKG's OWN path.

    The denominator that makes staleness like-for-like: the newest version of the same
    file, not the newest photo somewhere in the project. A path that fails to list is
    absent from the result, which select_stale_gpkgs treats as "cannot compute".
    """
    out = {}
    for row in sync_rows:
        newest = _newest_version(
            f"local/{MINIO_BUCKET}/projects/{row['qf_uuid']}/files/{row['gpkg_path']}/")
        if newest:
            out[(row["qf_uuid"], row["gpkg_path"])] = newest
    return out


def minio_sibling_newest(sync_rows):
    """{(qf_uuid, gpkg_path): (sibling_name, version)} — newest same-family sibling.

    Catches a RENAME, where the new work lives at a different path and the tracked one
    just sits there looking dormant. Uses the LOOSE family rule (no version-marker
    requirement), because the resolver deliberately declines non-numeric renames like
    "Civil audit new.gpkg" — this is the only thing that would ever report one.

    Lists each project's files/ directory once, then version-lists only the siblings.
    """
    out = {}
    dir_cache = {}
    for row in sync_rows:
        qf, path = row["qf_uuid"], row["gpkg_path"]
        if qf not in dir_cache:
            listing = _mc_ls(f"local/{MINIO_BUCKET}/projects/{qf}/files/")
            dir_cache[qf] = parse_mc_gpkg_names(listing) if listing else []
        best = None
        for name in dir_cache[qf]:
            if name == path or not is_family_member(path, name, require_version_marker=False):
                continue
            v = _newest_version(f"local/{MINIO_BUCKET}/projects/{qf}/files/{name}/")
            if v and (best is None or v > best[1]):
                best = (name, v)
        if best:
            out[(qf, path)] = best
    return out
