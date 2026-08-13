"""Tests for the reporting tools.

These CALL each tool rather than only listing it. The tool-inventory test registers
tools without executing their bodies, so a NameError in a tool body passes the whole
suite and only surfaces when someone asks a real question — which is exactly what
happened to get_action_items before this file existed.
"""

from __future__ import annotations

import urllib.parse

import pytest


@pytest.fixture()
def reporting(svc):
    import importlib

    _, tools = svc
    return importlib.import_module("ff_mcp.reporting_tools"), tools


def _capture(mod, monkeypatch):
    seen: dict[str, str] = {}

    def fake_get(path: str, query: str = "") -> str:
        seen["path"] = path
        seen["query"] = query
        return '{"success":true}'

    monkeypatch.setattr(mod, "_fibreflow_get_sync", fake_get)
    return seen


@pytest.mark.asyncio
async def test_every_reporting_tool_body_actually_runs(reporting, monkeypatch):
    """The regression this file exists for: a tool that registers but cannot execute."""
    mod, _ = reporting
    seen = _capture(mod, monkeypatch)

    for call in (
        mod.get_project_overview("Etwatwa"),
        mod.get_build_progress("Etwatwa"),
        mod.get_qa_status("Etwatwa"),
        mod.get_snags_summary("Etwatwa"),
        mod.get_activation_progress("Etwatwa"),
        mod.get_procurement_summary("Etwatwa"),
        mod.get_action_items(),
    ):
        assert await call == '{"success":true}'
        assert seen["path"].startswith("/api/reporting/")


@pytest.mark.asyncio
async def test_action_items_sends_only_the_filters_given(reporting, monkeypatch):
    mod, _ = reporting
    seen = _capture(mod, monkeypatch)

    await mod.get_action_items(assignee="Lew", older_than_days=90)

    assert seen["path"] == "/api/reporting/action-items"
    parsed = urllib.parse.parse_qs(seen["query"])
    assert parsed == {
        "assignee": ["Lew"],
        "state": ["open"],
        "olderThanDays": ["90"],
        "limit": ["25"],
    }
    # An unset filter must not travel as the literal string "None".
    assert "None" not in seen["query"]


@pytest.mark.asyncio
async def test_action_items_keeps_a_zero_day_window(reporting, monkeypatch):
    """0 is a real value — dropping it as falsy would silently widen the query."""
    mod, _ = reporting
    seen = _capture(mod, monkeypatch)

    await mod.get_action_items(older_than_days=0)

    assert urllib.parse.parse_qs(seen["query"])["olderThanDays"] == ["0"]


@pytest.mark.asyncio
async def test_the_sections_map_to_the_right_route(reporting, monkeypatch):
    mod, _ = reporting
    seen = _capture(mod, monkeypatch)

    await mod.get_build_progress("Etwatwa")
    assert urllib.parse.parse_qs(seen["query"])["section"] == ["build"]

    await mod.get_qa_status("Etwatwa")
    assert urllib.parse.parse_qs(seen["query"])["section"] == ["quality"]

    await mod.get_procurement_summary("Etwatwa")
    assert urllib.parse.parse_qs(seen["query"])["section"] == ["delivery"]


@pytest.mark.asyncio
async def test_action_items_description_warns_against_the_wrong_reading(svc):
    """The description is the only thing stopping a model reporting 5,000 broken promises.

    ~97% of open items are machine-extracted from transcripts, assignee is free text that
    splits one person across spellings, and there is no usable project or due-date
    dimension. A model that repeats the raw count as a delivery failure would be stating
    something false about named people.
    """
    server, _ = svc
    tools = {t.name: t.description.lower() for t in await server.mcp.list_tools()}
    desc = tools["get_action_items"]

    assert "extracted automatically" in desc
    assert "not a commitment" in desc
    assert "floor" in desc
    assert "free text" in desc
    # The warning itself must survive, not merely the words "project" and "due".
    assert "do not offer" in desc
    assert "project_id is populated on a" in desc
