"""Opt-in smoke test for the curated QField tool against the dev API."""

from __future__ import annotations

import json
import os

import pytest


def test_qfield_tool_calls_real_dev_api(svc, monkeypatch):
    token = os.environ.get("FF_DEV_TOKEN")
    if not token:
        pytest.skip("FF_DEV_TOKEN is required for the live dev smoke")

    _, tools = svc
    from ff_mcp import qfield_tools

    monkeypatch.setattr(tools, "_access_token", lambda: token)
    body = json.loads(
        qfield_tools._qfield_project_stats_sync("Mahikeng", "summary", 1, 50)
    )

    assert body["success"] is True
    assert body["data"]["project"]["qfield"]["name"] == "HT_Mahikeng"
    assert isinstance(body["data"]["poles"]["planted"], int)
    assert body["data"]["sync"]["scope"] == "system"
