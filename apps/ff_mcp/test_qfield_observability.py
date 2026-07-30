"""Safe observability behavior for the curated QField tool."""

from __future__ import annotations

import json

import pytest


@pytest.mark.parametrize(
    ("body", "result_category", "error_category", "correlation_id"),
    [
        (
            {"success": True, "data": {"status": "partial"}, "meta": {}},
            "partial",
            None,
            None,
        ),
        (
            {"success": True, "data": {"status": "unavailable"}},
            "unavailable",
            None,
            None,
        ),
        (
            {
                "success": False,
                "error": {"code": "SERVICE_UNAVAILABLE", "message": "secret body"},
                "meta": {"requestId": "../../unsafe id"},
            },
            "error",
            "upstream_error",
            None,
        ),
        ("not-json-secret-body", "error", "invalid_response", None),
    ],
)
@pytest.mark.asyncio
async def test_qfield_tool_logs_bounded_result_categories(
    svc,
    monkeypatch,
    body,
    result_category,
    error_category,
    correlation_id,
):
    from ff_mcp import qfield_tools

    captured: dict = {}
    encoded = json.dumps(body) if isinstance(body, dict) else body

    monkeypatch.setattr(qfield_tools, "get_access_token", lambda: None)
    monkeypatch.setattr(
        qfield_tools,
        "_qfield_project_stats_sync",
        lambda *_args: encoded,
    )
    monkeypatch.setattr(
        qfield_tools.logger,
        "info",
        lambda _message, *args, **kwargs: captured.update(
            {"args": args, "kwargs": kwargs}
        ),
    )

    assert await qfield_tools.get_qfield_project_stats("secret-project") == encoded

    fields = captured["kwargs"]["extra"]
    assert fields["result_category"] == result_category
    assert fields["error_category"] == error_category
    if correlation_id is None:
        assert fields["correlation_id"].startswith("local-")
    else:
        assert fields["correlation_id"] == correlation_id
    logged = repr(captured)
    assert "secret body" not in logged
    assert "not-json-secret-body" not in logged
    assert "secret-project" not in logged
