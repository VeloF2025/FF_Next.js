"""Offline behavior tests for the curated QField project-statistics tool."""

from __future__ import annotations

import threading
import urllib.parse

import pytest


@pytest.mark.parametrize(
    "section",
    ["summary", "poles", "cables", "drops", "qa", "sync", "anomalies"],
)
def test_qfield_tool_calls_only_the_fixed_stats_endpoint(
    svc, monkeypatch, section
):
    """Changing the fixed path or hand-building the query must fail this test."""
    from ff_mcp import qfield_tools

    seen: dict[str, str] = {}

    def fake_get(path: str, query: str = "") -> str:
        seen["path"] = path
        seen["query"] = query
        return '{"success":true}'

    monkeypatch.setattr(qfield_tools, "_fibreflow_get_sync", fake_get)
    body = qfield_tools._qfield_project_stats_sync(
        "Mahi keng & Phase/2", section, 2, 25
    )

    assert body == '{"success":true}'
    assert seen == {
        "path": "/api/qfield/project-stats",
        "query": (
            "project=Mahi+keng+%26+Phase%2F2"
            f"&section={section}&page=2&limit=25"
        ),
    }
    assert urllib.parse.parse_qs(seen["query"]) == {
        "project": ["Mahi keng & Phase/2"],
        "section": [section],
        "page": ["2"],
        "limit": ["25"],
    }


def test_qfield_tool_defaults_to_summary(svc, monkeypatch):
    """Dropping any public default must change the emitted query and fail."""
    from ff_mcp import qfield_tools

    seen: dict[str, str] = {}

    def fake_get(path: str, query: str = "") -> str:
        seen.update(urllib.parse.parse_qs(query))
        return '{"success":true}'

    monkeypatch.setattr(qfield_tools, "_fibreflow_get_sync", fake_get)
    qfield_tools._qfield_project_stats_sync("Mahikeng")

    assert seen == {
        "project": ["Mahikeng"],
        "section": ["summary"],
        "page": ["1"],
        "limit": ["50"],
    }


@pytest.mark.asyncio
async def test_qfield_tool_runs_the_blocking_adapter_on_a_worker_thread(
    svc, monkeypatch
):
    """Calling the sync adapter on FastMCP's event loop must fail this test."""
    from ff_mcp import qfield_tools

    caller: dict[str, str] = {}

    def fake_sync(project, section, page, limit):
        caller["thread"] = threading.current_thread().name
        return f"{project}:{section}:{page}:{limit}"

    monkeypatch.setattr(qfield_tools, "_qfield_project_stats_sync", fake_sync)
    main_thread = threading.current_thread().name

    body = await qfield_tools.get_qfield_project_stats(
        "Mahikeng", "poles", 3, 10
    )

    assert body == "Mahikeng:poles:3:10"
    assert caller["thread"] != main_thread


@pytest.mark.asyncio
async def test_qfield_tool_is_registered_once_with_its_selection_contract(svc):
    """Losing the schema or load-bearing selection guidance must fail."""
    server, _ = svc
    registered = await server.mcp.list_tools()
    names = [tool.name for tool in registered]

    assert names.count("get_qfield_project_stats") == 1
    tool = next(tool for tool in registered if tool.name == "get_qfield_project_stats")
    description = tool.description.lower()
    assert "use this tool" in description
    assert "qfield" in description
    assert "planted pole" in description
    assert "physically in the ground" in description
    assert "missing photos" in description
    assert "pending" in description
    assert "failed" in description
    assert "qa" in description

    schema = tool.inputSchema
    assert schema["required"] == ["project"]
    assert schema["properties"]["section"]["enum"] == [
        "summary",
        "poles",
        "cables",
        "drops",
        "qa",
        "sync",
        "anomalies",
    ]
    assert schema["properties"]["section"]["default"] == "summary"
    assert schema["properties"]["page"]["default"] == 1
    assert schema["properties"]["limit"]["default"] == 50
