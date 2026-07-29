"""Tests for endpoint discovery (list_endpoints, describe_endpoint).

The `svc` fixture lives in conftest.py. Split by area to stay inside the project's
300-line file limit.
"""

from __future__ import annotations

import json
import urllib.error
from pathlib import Path

import pytest

def test_list_endpoints_caps_rows_and_reports_the_true_total(svc):
    _, tools = svc
    from ff_mcp import catalogue
    out = json.loads(catalogue.list_endpoints())
    assert out["shown"] <= catalogue.MAX_ROWS
    assert out["matched"] >= out["shown"]
    if out["matched"] > catalogue.MAX_ROWS:
        assert out["truncated"] is True
        assert str(out["matched"]) in out["note"]


def test_list_endpoints_filters_by_group(svc):
    _, tools = svc
    from ff_mcp import catalogue
    out = json.loads(catalogue.list_endpoints(group="projects"))
    assert out["matched"] > 0
    assert all(r["group"] == "projects" for r in out["routes"])


def test_list_endpoints_says_so_when_nothing_matches(svc):
    _, tools = svc
    from ff_mcp import catalogue
    out = json.loads(catalogue.list_endpoints(filter="zzzz-no-such-endpoint"))
    assert out["matched"] == 0
    assert "note" in out


def test_catalogue_contains_no_denied_group(svc):
    _, tools = svc
    from ff_mcp import catalogue
    for route in catalogue._load_routes():
        assert tools._denied_group(route["group"]) is None, route["path"]


def test_describe_endpoint_extracts_path_params(svc):
    _, tools = svc
    from ff_mcp import catalogue
    target = next(
        r["path"] for r in catalogue._load_routes() if ":" in r["path"]
    )
    out = json.loads(catalogue.describe_endpoint(target))
    assert out["path"] == target
    assert out["pathParams"]


def test_describe_endpoint_reports_an_unknown_path(svc):
    _, tools = svc
    from ff_mcp import catalogue
    out = json.loads(catalogue.describe_endpoint("/api/does-not-exist"))
    assert "error" in out


def test_catalogue_ships_with_the_package(svc):
    _, _tools = svc
    from ff_mcp import catalogue
    assert Path(catalogue.CATALOGUE_PATH).exists()
    assert len(catalogue._load_routes()) > 100
