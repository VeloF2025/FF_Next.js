"""Curated QField statistics tool backed by FibreFlow's authenticated GET API."""

from __future__ import annotations

import urllib.parse
from functools import partial
from typing import Literal

import anyio.to_thread

from .server import mcp
from .tools import _fibreflow_get_sync

Section = Literal[
    "summary", "poles", "cables", "drops", "qa", "sync", "anomalies"
]


def _qfield_project_stats_sync(
    project: str,
    section: Section = "summary",
    page: int = 1,
    limit: int = 50,
) -> str:
    query = urllib.parse.urlencode(
        {
            "project": project,
            "section": section,
            "page": page,
            "limit": limit,
        }
    )
    return _fibreflow_get_sync("/api/qfield/project-stats", query)


@mcp.tool()
async def get_qfield_project_stats(
    project: str,
    section: Section = "summary",
    page: int = 1,
    limit: int = 50,
) -> str:
    """Use this tool for QField, planted pole, cable, drop, QField QA, field-build,
    and QField sync-stat questions.

    Give a FibreFlow/QField project name, project code, or UUID. The default summary
    returns trustworthy aggregate counts, freshness, source health, and warnings.
    Use a named section for bounded drill-down. A planted pole is physically in the ground;
    missing photos or pending/failed QA do not make it unplanted.
    """
    return await anyio.to_thread.run_sync(
        partial(_qfield_project_stats_sync, project, section, page, limit)
    )
