"""
Fixtures and stubs for characterizing extract-gpkg-photos.py's extract_project().

extract_project is ~390 lines, writes production data 4x/day, and has no test.
Before it is decomposed, its OBSERVABLE behaviour needs pinning down so the
refactor can be proven behaviour-preserving rather than argued to be.

This kit gives a scenario three things:
  * a REAL sqlite GPKG on disk (not a mock) so table/column resolution, the
    case-insensitive match and the photo-column fallback all exercise real code;
  * a recording DB stub, so a scenario can assert which SQL ran — in particular
    that the no-label-column guard writes NO sync-state row;
  * monkeypatched network functions, so nothing touches MinIO or QFieldCloud.

DELIBERATE LIMIT — read before trusting a green run: the DB is a stub, so this
suite cannot catch SQL that is malformed or disagrees with the live schema (a
parse-time error like 42P08 would sail straight through). That is covered by the
golden --dry-run capture in qfield_extract_golden.py, which runs the real
statements against the real database. The two are complements; neither alone is
sufficient.
"""
import importlib.util
import os
import sqlite3
import sys
import tempfile

from qfield_patchkit import Patcher, script_modules

SCRIPTS = os.path.dirname(os.path.abspath(__file__))

# The real FT civil-audit column names — detect_step_columns must actually match
# these, so a scenario exercises real detection rather than a convenient fake.
STEP_1 = "1. Before Photo - Mark out the ground with a circle/Square or X"
STEP_2 = "2. During Photo - Add compaction photo if needed"
STEP_7 = "7. After photo - Ensure you take a picture of the pole"
# A real OPTICAL step column (OPTICAL_STEP_PATTERNS). Optical rows are written with
# feature_type='joint' / work_type='dome_joint' instead of pole/pole_installation —
# a mapping that had no coverage at all until a reviewer mutated it and nothing failed.
OPTICAL_1 = "1. Dome on Pole"



def load_phases():
    """Import the modules the extractor's calls resolve in, so they are in sys.modules.

    Patching itself is by object identity across every loaded scripts/ module
    (qfield_patchkit), so this list does not gate correctness — qfield_row_ingest, for
    one, is never named here and is still intercepted, because importing the extractor
    imports it transitively. Importing them explicitly makes that independent of
    import order rather than a happy accident.
    """
    import qfield_extract_phases
    import qfield_gpkg_table
    import qfield_row_ingest
    return [qfield_extract_phases, qfield_gpkg_table, qfield_row_ingest]


def load_extractor():
    """Import extract-gpkg-photos.py despite the hyphen (not a valid module name)."""
    path = os.path.join(SCRIPTS, "extract-gpkg-photos.py")
    spec = importlib.util.spec_from_file_location("extract_gpkg_photos", path)
    mod = importlib.util.module_from_spec(spec)
    # Register before exec, the conventional importlib pattern. Without this the module
    # exists but is invisible to sys.modules — and _script_modules() would silently skip
    # the very module under test, leaving its bindings unpatched. The interception guard
    # catches that (calls=0), which is how this was found.
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


class FakeCursor:
    """Records every statement, and answers the four SELECTs extract_project makes.

    Answers are matched on a distinctive substring of each query rather than call
    order, so the stub keeps working when the refactor reorders or relocates them —
    which is the whole point of a characterization harness.
    """

    def __init__(self, state=None, existing_keys=(), existing_photo_keys=(), linked=()):
        self.executed = []           # [(sql, params)]
        self._state = state          # dict for qfield_gpkg_sync_state, or None
        self._existing_keys = list(existing_keys)
        self._existing_photo_keys = list(existing_photo_keys)
        self._linked = list(linked)
        self._result = []
        self.rowcount = 0

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))
        low = sql.lower()
        if "from qfield_gpkg_sync_state" in low and low.strip().startswith("select"):
            self._result = [self._state] if self._state else []
        elif "select photo_key from qfield_photo_validations" in low:
            self._result = [{"photo_key": k} for k in self._existing_keys]
        elif "from construction_qa_photos" in low:
            self._result = [{"storage_key": k} for k in self._existing_photo_keys]
        else:
            self._result = []

    def fetchone(self):
        return self._result[0] if self._result else None

    def fetchall(self):
        return self._result

    def close(self):
        pass

    # -- assertions used by scenarios -------------------------------------------
    def ran(self, needle):
        """True if any executed statement contains `needle` (case-insensitive)."""
        return any(needle.lower() in sql.lower() for sql, _ in self.executed)

    def params_for(self, needle):
        for sql, params in self.executed:
            if needle.lower() in sql.lower():
                return params
        return None


class FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False

    def cursor(self, *a, **kw):
        return self._cursor

    def commit(self):
        self.committed = True

    def close(self):
        pass


def make_gpkg(path, table, columns, rows):
    """Write a real sqlite GPKG-shaped file: a gpkg_ system table plus one data table."""
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE gpkg_contents (table_name TEXT)")
    cols = ", ".join(f'"{c}" TEXT' for c in columns)
    db.execute(f'CREATE TABLE "{table}" ({cols})')
    if rows:
        ph = ", ".join("?" for _ in columns)
        db.executemany(
            f'INSERT INTO "{table}" VALUES ({ph})',
            [[r.get(c) for c in columns] for r in rows],
        )
    db.commit()
    db.close()


class Harness:
    """One scenario: a real GPKG on disk + stubbed network + a recording DB."""

    def __init__(self, mod, table="civil_audit", columns=None, rows=None,
                 dcim=None, state=None, existing_keys=(), existing_photo_keys=(),
                 linked=(), linked_dcim=None, hierarchy_backfill=False,
                 download_fails=False, spatial_pon_map=None,
                 version="v20260731122829-abc12345", gpkg_path="Civil Audit.gpkg"):
        self.mod = mod
        self.tmpdir = tempfile.mkdtemp(prefix="qfield_char_")
        self.gpkg_file = os.path.join(self.tmpdir, "fixture.gpkg")
        make_gpkg(self.gpkg_file, table, columns or [], rows or [])
        self.cursor = FakeCursor(state, existing_keys, existing_photo_keys, linked)
        self.conn = FakeConn(self.cursor)
        self._dcim = dcim if dcim is not None else {}
        # {linked_qf_id: {filename: key}} — per-project, so a scenario can tell
        # "primary wins on conflict" from "linked wins"; one shared dict cannot.
        self._linked_dcim = linked_dcim or {}
        self._hierarchy_backfill = hierarchy_backfill
        # minio_download_latest returns (None, 0) when MinIO has no such object. Without
        # a way to simulate it, that abort path had no coverage at all.
        self._download_fails = download_fails
        # Distinctive so a scenario can prove the map reaches sync_hierarchy rather than
        # merely that the resolver was called.
        self._spatial_pon_map = spatial_pon_map if spatial_pon_map is not None else {}
        self._version = version
        self._gpkg_path = gpkg_path
        self._linked = list(linked)
        # Interception machinery lives in qfield_patchkit; see its docstring for why
        # patching is by object identity and restore is by scan.
        self._patcher = Patcher(always_scan=[mod])
        self.hierarchy_calls = []    # recorded so a scenario can assert the call happened
        # {stub name: times invoked} — lets a scenario prove interception actually
        # happened rather than assuming a green run means the stubs ran.
        self.stub_calls = self._patcher.calls
        # Import the modules the extractor's calls resolve in, so _script_modules()
        # can see them. Patching itself is by object identity, not by this list.
        load_phases()

    def __enter__(self):
        m = self.mod
        src = self.gpkg_file

        def _download(qf_id, path, dest):
            if self._download_fails:
                return None, 0
            with open(src, "rb") as a, open(dest, "wb") as b:
                b.write(a.read())
            return self._version, os.path.getsize(src)

        def _list_dcim(qf):
            """Primary project gets `dcim`; each linked project gets its own slice."""
            if qf in self._linked_dcim:
                return dict(self._linked_dcim[qf])
            return dict(self._dcim)

        def _sync_hierarchy(*a, **kw):
            self.hierarchy_calls.append((a, kw))
            return {"mapped": 0, "qa_poles": 0, "poles": 0, "reviews": 0}

        self._patcher.patch("resolve_gpkg_path", lambda qf, p: self._gpkg_path)
        self._patcher.patch("minio_download_latest", _download)
        self._patcher.patch("minio_list_dcim_directory", _list_dcim)
        self._patcher.patch("minio_resolve_photo_version", lambda qf, p: None)
        self._patcher.patch("fetch_linked_qf_project_ids", lambda cur, ff, qf: list(self._linked))
        self._patcher.patch("hierarchy_backfill_needed",
                    lambda cur, ff, cfg: self._hierarchy_backfill)
        self._patcher.patch("resolve_spatial_pon_map", lambda qf: dict(self._spatial_pon_map))
        self._patcher.patch("sync_hierarchy", _sync_hierarchy)
        return self

    def __exit__(self, *exc):
        self._patcher.restore()
        try:
            os.unlink(self.gpkg_file)
            os.rmdir(self.tmpdir)
        except OSError:
            pass
        return False

    def run(self, config, dry_run=True, force=False, name="Fixture"):
        return self.mod.extract_project(self.conn, name, config, dry_run, force)


# Exposed so scenarios can assert EXACT project attribution rather than "at least one
# insert mentions the linked project" — an `any(...)` check passes even when every
# photo is misattributed to the same project.
PRIMARY_QF = "aaaaaaaa-1111-2222-3333-444444444444"
PRIMARY_FF = "bbbbbbbb-1111-2222-3333-444444444444"


def config(table="civil_audit", label_col="NAME", gpkg_path="Civil Audit.gpkg", **extra):
    cfg = {
        "qf_project_id": PRIMARY_QF,
        "ff_project_id": PRIMARY_FF,
        "gpkg_path": gpkg_path,
        "table_name": table,
        "label_col": label_col,
    }
    cfg.update(extra)
    return cfg
