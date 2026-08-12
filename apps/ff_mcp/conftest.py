"""Shared fixtures for the ff_mcp tests."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("FF_MCP_CALLBACK_SECRET", "test-secret")


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    """Import the service against a scratch store, isolated per test.

    config is evicted along with the rest: it reads the environment at import time, so
    leaving it cached would silently ignore the env this fixture just set.
    """
    monkeypatch.setenv("FF_MCP_CALLBACK_SECRET", "test-secret")
    monkeypatch.setenv("FF_REMOTE_MCP_STORE", str(tmp_path / "oauth.json"))
    monkeypatch.setenv("FF_APP_BASE", "https://dev.fibreflow.app")
    import importlib
    import sys

    package = sys.modules.get("ff_mcp")
    for name in (
        "ff_mcp.server",
        "ff_mcp.catalogue",
        "ff_mcp.tools",
        "ff_mcp.qfield_tools",
        "ff_mcp.photo_tools",
        "ff_mcp.photo_search_tools",
        "ff_mcp.oauth",
        "ff_mcp.config",
    ):
        sys.modules.pop(name, None)
        if package is not None:
            package.__dict__.pop(name.rsplit(".", 1)[-1], None)

    server = importlib.import_module("ff_mcp.server")
    tools = importlib.import_module("ff_mcp.tools")
    return server, tools
