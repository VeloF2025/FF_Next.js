"""Tests for the OAuth store's load/save behaviour."""

from __future__ import annotations


def test_a_corrupt_store_is_reported_and_preserved_not_silently_wiped(tmp_path, capsys):
    """Cortex swallows this with a bare `except: pass`. Starting empty is unavoidable,
    but doing it silently loses every grant with no trace and no way to diagnose it."""
    from ff_mcp.oauth import FibreFlowOAuthProvider

    store = tmp_path / "oauth.json"
    store.write_text('{"clients": {"c1": ')  # truncated mid-write

    provider = FibreFlowOAuthProvider(store)

    assert provider.data == {"clients": {}, "pending": {}, "codes": {}, "access": {}, "refresh": {}}
    out = capsys.readouterr().out
    assert "OAUTH STORE UNREADABLE" in out
    assert "must reconnect" in out
    # The unreadable file is kept for diagnosis rather than overwritten.
    assert store.with_suffix(".json.corrupt").exists()


def test_a_missing_store_is_normal_and_silent(tmp_path, capsys):
    from ff_mcp.oauth import FibreFlowOAuthProvider

    provider = FibreFlowOAuthProvider(tmp_path / "does-not-exist.json")
    assert provider.data["clients"] == {}
    assert "OAUTH STORE UNREADABLE" not in capsys.readouterr().out


def test_a_valid_store_round_trips(tmp_path):
    from ff_mcp.oauth import FibreFlowOAuthProvider

    store = tmp_path / "oauth.json"
    p1 = FibreFlowOAuthProvider(store)
    p1.data["clients"]["c1"] = {"client_id": "c1"}
    p1._save()

    assert FibreFlowOAuthProvider(store).data["clients"]["c1"]["client_id"] == "c1"


def test_expired_entries_are_purged_on_save(tmp_path, monkeypatch):
    """The store only ever grew: abandoned Connect attempts and rotated tokens were
    dropped lazily on a lookup of that exact key, which never comes."""
    import ff_mcp.oauth as oauth
    from ff_mcp.oauth import FibreFlowOAuthProvider

    store = tmp_path / "oauth.json"
    p = FibreFlowOAuthProvider(store)
    now = oauth._now()
    p.data["pending"]["stale"] = {"expires_at": now - 1}
    p.data["pending"]["live"] = {"expires_at": now + 600}
    p.data["codes"]["stale"] = {"expires_at": now - 1}
    p.data["access"]["stale"] = {"expires_at": now - 1}
    p.data["refresh"]["live"] = {"expires_at": now + 3600}
    p.data["clients"]["c1"] = {"client_id": "c1"}
    p._save()

    assert list(p.data["pending"]) == ["live"]
    assert p.data["codes"] == {}
    assert p.data["access"] == {}
    assert list(p.data["refresh"]) == ["live"]
    # Clients never expire and must survive the sweep.
    assert p.data["clients"]["c1"]["client_id"] == "c1"


def test_the_store_is_never_world_readable_even_momentarily(tmp_path, monkeypatch):
    """chmod-after-write leaves a window where a file holding every connected user's
    FibreFlow token exists at the default umask. Assert the temp file is created 0600."""
    import os as real_os

    import ff_mcp.oauth as oauth
    from ff_mcp.oauth import FibreFlowOAuthProvider

    modes: list[int] = []
    real_open = real_os.open

    def spy_open(path, flags, mode=0o777):
        modes.append(mode)
        return real_open(path, flags, mode)

    monkeypatch.setattr(oauth.os, "open", spy_open)
    p = FibreFlowOAuthProvider(tmp_path / "oauth.json")
    p.data["clients"]["c1"] = {"client_id": "c1"}
    p._save()

    assert modes and all(m == 0o600 for m in modes), modes
    assert oct(real_os.stat(tmp_path / "oauth.json").st_mode)[-3:] == "600"
