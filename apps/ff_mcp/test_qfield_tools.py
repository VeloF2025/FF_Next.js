"""Offline behavior tests for the curated QField project-statistics tool."""

from __future__ import annotations

import threading
import urllib.parse
from types import SimpleNamespace

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


@pytest.mark.parametrize("_fresh_import", range(2))
@pytest.mark.asyncio
async def test_every_fresh_service_registers_the_complete_tool_set_once(
    svc, _fresh_import
):
    """Leaving any side-effect tool module cached must fail on the next import."""
    server, _ = svc
    names = [tool.name for tool in await server.mcp.list_tools()]
    expected = {
        "fibreflow_get",
        "list_endpoints",
        "describe_endpoint",
        "get_qfield_project_stats",
        "view_photo",
        "find_project_photos",
        "get_photo_download_manifest",
        "get_project_overview",
        "get_build_progress",
        "get_qa_status",
        "get_snags_summary",
        "get_activation_progress",
        "get_procurement_summary",
        "get_action_items",
        "find_meetings",
        "get_report_export",
    }

    assert set(names) == expected
    assert all(names.count(name) == 1 for name in expected)


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


@pytest.mark.asyncio
async def test_qfield_tool_logs_safe_complete_observability(
    svc, monkeypatch
):
    from ff_mcp import qfield_tools

    ff_secret = "ff-business-token-must-not-appear"
    raw_body_secret = "customer-body-must-not-appear"
    captured: dict = {}

    monkeypatch.setattr(
        qfield_tools,
        "get_access_token",
        lambda: SimpleNamespace(
            client_id="oauth-client-1",
            ff_token=ff_secret,
            token="oauth-access-token-must-not-appear",
        ),
    )
    monkeypatch.setattr(
        qfield_tools,
        "_qfield_project_stats_sync",
        lambda *_args: (
            '{"success":true,"data":{"status":"complete",'
            f'"payload":"{raw_body_secret}"}},"meta":{{"requestId":"api-request-1"}}}}'
        ),
    )
    monkeypatch.setattr(
        qfield_tools.logger,
        "info",
        lambda message, *args, **kwargs: captured.update(
            {"message": message, "args": args, "kwargs": kwargs}
        ),
    )

    await qfield_tools.get_qfield_project_stats(
        "secret-project-name", "poles", 1, 50
    )

    fields = captured["kwargs"]["extra"]
    assert captured["message"] == "qfield_project_stats_invocation"
    assert fields == {
        "tool_name": "get_qfield_project_stats",
        "section": "poles",
        "oauth_client_id": "oauth-client-1",
        "duration_ms": pytest.approx(fields["duration_ms"], abs=1000),
        "result_category": "complete",
        "correlation_id": "api-request-1",
        "error_category": None,
    }
    logged = repr(captured)
    assert ff_secret not in logged
    assert raw_body_secret not in logged
    assert "oauth-access-token-must-not-appear" not in logged
    assert "secret-project-name" not in logged


@pytest.mark.asyncio
async def test_qfield_tool_logs_controlled_error_without_exception_text(
    svc, monkeypatch
):
    from ff_mcp import qfield_tools

    captured: dict = {}
    secret_error = "database password and raw response body"

    monkeypatch.setattr(qfield_tools, "get_access_token", lambda: None)
    monkeypatch.setattr(
        qfield_tools,
        "_qfield_project_stats_sync",
        lambda *_args: (_ for _ in ()).throw(RuntimeError(secret_error)),
    )
    monkeypatch.setattr(
        qfield_tools.logger,
        "error",
        lambda message, *args, **kwargs: captured.update(
            {"message": message, "args": args, "kwargs": kwargs}
        ),
    )

    with pytest.raises(RuntimeError, match=secret_error):
        await qfield_tools.get_qfield_project_stats("Mahikeng")

    fields = captured["kwargs"]["extra"]
    assert fields["tool_name"] == "get_qfield_project_stats"
    assert fields["section"] == "summary"
    assert fields["oauth_client_id"] is None
    assert fields["result_category"] == "error"
    assert fields["error_category"] == "adapter_exception"
    assert fields["correlation_id"].startswith("local-")
    assert secret_error not in repr(captured)
