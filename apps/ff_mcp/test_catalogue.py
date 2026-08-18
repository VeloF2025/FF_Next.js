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


def test_catalogue_contains_qfield_project_stats(svc):
    from ff_mcp.catalogue import _load_routes

    routes = _load_routes()
    route = next(
        (item for item in routes if item["path"] == "/api/qfield/project-stats"),
        None,
    )
    assert route is not None
    assert route["methods"] == ["GET"]


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


def test_catalogue_keeps_field_stock_and_the_other_field_routes():
    """The group-vs-path decision, pinned at the CATALOGUE level.

    `field` cannot go in DENIED_GROUPS because the hyphenated-sibling rule would also
    match `field-stock`. That was pinned for the runtime guard but NOT here, so the
    generator kept its own 'field' entry and silently dropped the whole warehouse module
    plus nine unrelated /api/field/* routes while every test still passed. This asserts
    the catalogue itself, which is what tells the model what exists.
    """
    from ff_mcp import catalogue

    routes = catalogue._load_routes()
    paths = {r["path"] for r in routes}
    groups = {r["group"] for r in routes}

    assert "field-stock" in groups, "the warehouse module must stay catalogued"
    assert any(p.startswith("/api/field/") for p in paths), "other /api/field/* routes must stay"


def test_catalogue_excludes_the_path_denied_route():
    """The mirror: the one route that IS denied must not be advertised.

    Cataloguing it would promise an endpoint the runtime guard always refuses, and leave
    the two mechanisms disagreeing about what is reachable.
    """
    from ff_mcp import catalogue
    from ff_mcp import tools

    paths = {r["path"] for r in catalogue._load_routes()}
    assert "/api/field/attendance" not in paths

    # And every catalogued path must survive the runtime guard, so the generator's
    # denylists and tools.py's cannot drift apart in either direction.
    for path in paths:
        concrete = path.replace(":", "").replace("[", "").replace("]", "")
        assert tools._denied_path(concrete) is None, path
