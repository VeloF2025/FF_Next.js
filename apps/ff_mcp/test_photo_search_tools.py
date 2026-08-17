"""Tests for find_project_photos and get_photo_download_manifest.

These tools do nothing but build a query string, so that is exactly what is asserted.
The failure they exist to prevent is silent: sending `type=None` filters on the literal
string "None", matches nothing, and reads back to the model as "this project has no
depth photos" rather than as an error.
"""

from __future__ import annotations

import urllib.parse

import pytest


@pytest.fixture()
def search(svc):
    import importlib

    _, tools = svc
    return importlib.import_module("ff_mcp.photo_search_tools"), tools


def _capture(mod, monkeypatch):
    seen: dict[str, str] = {}

    def fake_get(path: str, query: str = "") -> str:
        seen["path"] = path
        seen["query"] = query
        return '{"success":true}'

    monkeypatch.setattr(mod, "_fibreflow_get_sync", fake_get)
    return seen


@pytest.mark.asyncio
async def test_search_omits_every_unset_filter(search, monkeypatch):
    mod, _ = search
    seen = _capture(mod, monkeypatch)

    await mod.find_project_photos(project="Etwatwa", type="depth")

    assert seen["path"] == "/api/photos/search"
    parsed = urllib.parse.parse_qs(seen["query"])
    assert parsed == {
        "project": ["Etwatwa"],
        "type": ["depth"],
        "source": ["both"],
        "limit": ["25"],
        "offset": ["0"],
    }
    # The specific regression: an unset filter must not travel as the string "None".
    assert "None" not in seen["query"]


@pytest.mark.asyncio
async def test_search_sends_dates_under_the_names_the_api_expects(search, monkeypatch):
    mod, _ = search
    seen = _capture(mod, monkeypatch)

    await mod.find_project_photos(project="Tonga", from_date="2026-06-01", to_date="2026-07-01")

    parsed = urllib.parse.parse_qs(seen["query"])
    assert parsed["from"] == ["2026-06-01"]
    assert parsed["to"] == ["2026-07-01"]
    assert "from_date" not in parsed


@pytest.mark.asyncio
async def test_search_passes_identity_and_verdict_filters_through(search, monkeypatch):
    mod, _ = search
    seen = _capture(mod, monkeypatch)

    await mod.find_project_photos(
        project="Lawley", vlm="fail", pole="LAW.P.A412", zone=3, pon=5, source="qa"
    )

    parsed = urllib.parse.parse_qs(seen["query"])
    assert parsed["vlm"] == ["fail"]
    assert parsed["pole"] == ["LAW.P.A412"]
    assert parsed["zone"] == ["3"]
    assert parsed["pon"] == ["5"]
    assert parsed["source"] == ["qa"]


@pytest.mark.asyncio
async def test_manifest_hits_the_manifest_route_and_sends_no_paging(search, monkeypatch):
    """A manifest covers every match; a limit would silently truncate the download."""
    mod, _ = search
    seen = _capture(mod, monkeypatch)

    await mod.get_photo_download_manifest(project="Etwatwa", type="depth")

    assert seen["path"] == "/api/photos/manifest"
    parsed = urllib.parse.parse_qs(seen["query"])
    assert "limit" not in parsed
    assert "offset" not in parsed
    assert parsed["project"] == ["Etwatwa"]


@pytest.mark.asyncio
async def test_zero_is_kept_but_empty_string_is_dropped(search, monkeypatch):
    """0 is a real zone. Dropping it as falsy would widen the query to the whole project."""
    mod, _ = search
    seen = _capture(mod, monkeypatch)

    await mod.find_project_photos(project="Lawley", zone=0, pole="")

    parsed = urllib.parse.parse_qs(seen["query"])
    assert parsed["zone"] == ["0"]
    assert "pole" not in parsed


@pytest.mark.asyncio
async def test_search_tools_describe_when_to_use_each_one(svc):
    """The descriptions are the only thing routing the model between three photo tools."""
    server, _ = svc
    tools = {tool.name: tool.description.lower() for tool in await server.mcp.list_tools()}

    assert "call this first" in tools["find_project_photos"]
    assert "view_photo" in tools["find_project_photos"]
    for word in ("download", "save", "export", "folder"):
        assert word in tools["get_photo_download_manifest"]
    assert "do not call this in a loop" in tools["get_photo_download_manifest"]
