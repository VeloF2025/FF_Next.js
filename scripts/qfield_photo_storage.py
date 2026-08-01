"""
Photo blob resolution — WHERE an individual DCIM photo lives in MinIO.

Lists a project's DCIM directory (via the QFieldCloud API when credentials are
present, falling back to a direct MinIO listing when they are not), and resolves a
single photo filename to its versioned storage key.

Split out of extract-gpkg-photos.py. Pairs with qfield_gpkg_storage, which answers the
different question of which GPKG version to read; the two share no calls, which is why
they are separate modules rather than one 314-line file.

Missing QFIELD_USERNAME / QFIELD_PASSWORD is NOT an error: the listing degrades to
direct MinIO access, which is the normal path on the cron host.

IMPORTANT for tests: the extractor imports these by NAME (`from qfield_photo_storage
import minio_list_dcim_directory`) so the characterization harness can monkeypatch them
via `setattr(extractor_module, name, stub)`. Calling them module-qualified from the
extractor would silently defeat that patching and blind the suite — don't.
"""
import os
import re
import subprocess

# MinIO bucket. Deliberately restated rather than imported from a sibling module: the
# two storage modules have zero call-dependency on each other (verified — no function
# in one calls any function in the other), and inventing an import just to share one
# constant would couple them for nothing. ~8 other scripts in this repo already
# declare it the same way; consolidating all of them is its own piece of work.
MINIO_BUCKET = "qfieldcloud-prod"

QFIELD_API_URL = os.environ.get('QFIELD_API_URL', 'https://qfield.fibreflow.app/api/v1/')
QFIELD_USERNAME = os.environ.get('QFIELD_USERNAME')
QFIELD_PASSWORD = os.environ.get('QFIELD_PASSWORD')

_qfc_session = None

def _get_qfc_session():
    """Get authenticated QFieldCloud API session (cached)."""
    global _qfc_session
    if _qfc_session is not None:
        return _qfc_session
    if not QFIELD_USERNAME or not QFIELD_PASSWORD:
        print("    WARN: QFIELD_USERNAME / QFIELD_PASSWORD env vars not set, skipping QFC API")
        return None
    import requests as _requests
    _qfc_session = _requests.Session()
    resp = _qfc_session.post(f'{QFIELD_API_URL}auth/login/', json={
        'username': QFIELD_USERNAME,
        'password': QFIELD_PASSWORD,
    })
    if resp.status_code != 200:
        print(f"    WARN: QFieldCloud auth failed: {resp.status_code}")
        _qfc_session = None
        return None
    token = resp.json().get('token')
    _qfc_session.headers['Authorization'] = f'Token {token}'
    return _qfc_session


def qfc_list_dcim_files(qf_project_id):
    """List DCIM photos via QFieldCloud REST API.

    Returns a dict mapping filename → API download path.
    The API sees all files including those stored in deltas/packages
    that are invisible to direct MinIO mc ls.
    """
    session = _get_qfc_session()
    if not session:
        return {}
    try:
        resp = session.get(f'{QFIELD_API_URL}files/{qf_project_id}/')
        if resp.status_code != 200:
            print(f"    WARN: QFieldCloud files list failed: {resp.status_code}")
            return {}
        files = resp.json()
        dcim_files = {}
        for f in files:
            name = f.get('name', '')
            if not name.startswith('DCIM/'):
                continue
            lower = name.lower()
            if not any(lower.endswith(ext) for ext in ('.jpg', '.jpeg', '.png', '.heic')):
                continue
            filename = name[len('DCIM/'):]
            # Build a storage key compatible with existing DB records
            dcim_files[filename] = f"projects/{qf_project_id}/files/{name}"
        return dcim_files
    except Exception as e:
        print(f"    WARN: qfc_list_dcim_files error: {e}")
        return {}


def minio_list_dcim_directory(qf_project_id):
    """Batch-list the entire DCIM directory for a QFieldCloud project.

    First tries the QFieldCloud REST API (sees all files including deltas).
    Falls back to direct MinIO mc ls if the API is unavailable.

    Returns a dict mapping filename → storage key.
    """
    # Try API first — it sees delta-merged files that mc ls misses
    api_files = qfc_list_dcim_files(qf_project_id)
    if api_files:
        return api_files

    # Fallback: direct MinIO listing (only sees flat files/ directory)
    print(f"    Falling back to direct MinIO ls...")
    dcim_prefix = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/DCIM/"
    try:
        result = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", "--recursive", dcim_prefix],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            print(f"    WARN: mc ls DCIM failed for {qf_project_id}: {result.stderr.strip()[:120]}")
            return {}

        dcim_files = {}
        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            std_idx = line.find(" STANDARD ")
            if std_idx == -1:
                continue
            rel_path = line[std_idx + len(" STANDARD "):].rstrip("/")
            if rel_path.startswith("DCIM/"):
                rel_path = rel_path[len("DCIM/"):]
            ver_match = re.search(r'/v(\d{14}-[a-fA-F0-9]+)$', rel_path)
            if not ver_match:
                continue
            version_seg = "v" + ver_match.group(1)
            filename = rel_path[:ver_match.start()]
            existing_ver = dcim_files.get(filename)
            if existing_ver is None or version_seg > existing_ver.rsplit("/", 1)[-1]:
                dcim_files[filename] = (
                    f"projects/{qf_project_id}/files/DCIM/{filename}/{version_seg}"
                )
        return dcim_files
    except Exception as e:
        print(f"    WARN: minio_list_dcim_directory error: {e}")
        return {}

def minio_resolve_photo_version(qf_project_id, dcim_path):
    """Resolve DCIM/filename.jpg to its latest versioned MinIO path."""
    prefix = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{dcim_path}/"
    try:
        result = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", prefix],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None

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
        if not versions:
            return None

        versions.sort()
        return f"projects/{qf_project_id}/files/{dcim_path}/{versions[-1]}"
    except Exception:
        return None
