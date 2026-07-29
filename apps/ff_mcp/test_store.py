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
