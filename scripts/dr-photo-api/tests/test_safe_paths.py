"""Tests for api.safe_paths path-containment helpers.

Run with pytest, or directly:  python3 tests/test_safe_paths.py
(from the scripts/dr-photo-api directory)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import HTTPException  # noqa: E402

from api.safe_paths import is_safe_segment, safe_join, safe_photo_path  # noqa: E402


def _rejects(root, *segments, **kwargs):
    """True when safe_join refuses these segments with a 4xx."""
    try:
        safe_join(root, *segments, **kwargs)
    except HTTPException as exc:
        assert exc.status_code == 400, f"expected 400, got {exc.status_code}"
        return True
    return False


def test_is_safe_segment_accepts_normal_components():
    assert is_safe_segment("DR1733592")
    assert is_safe_segment("lawley")
    assert is_safe_segment("DR1733592_ph_before_12345.jpg")
    assert is_safe_segment("name with spaces.jpg")


def test_is_safe_segment_rejects_traversal_and_separators():
    for bad in ["", ".", "..", "../etc", "a/b", "a\\b", "a\x00b"]:
        assert not is_safe_segment(bad), f"{bad!r} should be rejected"


def test_safe_join_allows_contained_path(tmp_root):
    result = safe_join(tmp_root, "DR123", "photo.jpg")
    assert result == (tmp_root.resolve() / "DR123" / "photo.jpg")


def test_safe_join_blocks_dotdot_segment(tmp_root):
    # The exact reported vector: /photos/../secret -> dr_number == ".."
    assert _rejects(tmp_root, "..", "secret.jpg")
    assert _rejects(tmp_root, "..", "..", "etc", "passwd")


def test_safe_join_blocks_embedded_separators(tmp_root):
    assert _rejects(tmp_root, "../../etc", "passwd")
    assert _rejects(tmp_root, "DR123/../..", "passwd")
    assert _rejects(tmp_root, "..\\..\\windows", "win.ini")


def test_safe_join_blocks_absolute_path_segment(tmp_root):
    # Path.joinpath("/etc/passwd") would otherwise discard the root entirely.
    assert _rejects(tmp_root, "/etc/passwd")
    assert _rejects(tmp_root, "DR123", "/etc/passwd")


def test_safe_join_blocks_nul_byte(tmp_root):
    assert _rejects(tmp_root, "DR123\x00", "photo.jpg")


def test_safe_join_blocks_symlink_escape(tmp_root):
    outside = tmp_root.parent / "outside"
    outside.mkdir(exist_ok=True)
    (outside / "secret.jpg").write_bytes(b"secret")
    link = tmp_root / "escape"
    if not link.exists():
        link.symlink_to(outside, target_is_directory=True)

    # Segments are individually legal, but resolve() lands outside the root.
    assert _rejects(tmp_root, "escape", "secret.jpg")


def test_safe_photo_path_enforces_extension(tmp_root):
    assert safe_photo_path(tmp_root, "DR123", "a.jpg").name == "a.jpg"
    assert safe_photo_path(tmp_root, "DR123", "a.PNG").name == "a.PNG"

    for bad_name in ["a.json", "a.py", "session.txt", "noextension"]:
        try:
            safe_photo_path(tmp_root, "DR123", bad_name)
        except HTTPException as exc:
            assert exc.status_code == 400
        else:
            raise AssertionError(f"{bad_name!r} should have been rejected")


def test_relative_root_is_anchored_to_cwd(tmp_root, monkeypatch=None):
    # PHOTOS_BASE_PATH is Path("data/dr_photos") -- a relative root must still
    # produce an absolute, contained result.
    result = safe_join(Path("data/dr_photos"), "DR123", "a.jpg")
    assert result.is_absolute()
    assert (Path("data/dr_photos").resolve()) in result.parents


# --- test harness -----------------------------------------------------------

def _run_standalone():
    import tempfile
    import inspect

    tests = [
        (name, fn) for name, fn in sorted(globals().items())
        if name.startswith("test_") and callable(fn)
    ]
    failures = []
    for name, fn in tests:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "dr_photos"
            root.mkdir()
            params = inspect.signature(fn).parameters
            try:
                fn(root) if "tmp_root" in params else fn()
                print(f"PASS  {name}")
            except Exception as exc:  # noqa: BLE001 - test harness reporting
                failures.append((name, exc))
                print(f"FAIL  {name}: {exc}")

    print(f"\n{len(tests) - len(failures)}/{len(tests)} passed")
    return 1 if failures else 0


try:
    import pytest

    @pytest.fixture
    def tmp_root(tmp_path):
        root = tmp_path / "dr_photos"
        root.mkdir()
        return root
except ImportError:  # pragma: no cover - standalone mode
    pass


if __name__ == "__main__":
    sys.exit(_run_standalone())
