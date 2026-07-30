"""Curated QField statistics tool backed by FibreFlow's authenticated GET API."""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.parse
import uuid
from functools import partial
from typing import Literal

import anyio.to_thread
from mcp.server.auth.middleware.auth_context import get_access_token

from .server import mcp
from .tools import _fibreflow_get_sync

logger = logging.getLogger(__name__)

Section = Literal[
    "summary", "poles", "cables", "drops", "qa", "sync", "anomalies"
]
_RESULT_CATEGORIES = {"complete", "partial", "unavailable"}
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _safe_identifier(value: object) -> str | None:
    return value if isinstance(value, str) and _SAFE_ID.fullmatch(value) else None


def _oauth_client_id() -> str | None:
    try:
        access = get_access_token()
    except (LookupError, RuntimeError):
        return None
    return _safe_identifier(getattr(access, "client_id", None)) if access else None


def _response_fields(body: str, local_id: str) -> tuple[str, str, str | None]:
    try:
        response = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return "error", local_id, "invalid_response"
    if not isinstance(response, dict):
        return "error", local_id, "invalid_response"

    metadata = response.get("meta")
    request_id = (
        _safe_identifier(metadata.get("requestId"))
        if isinstance(metadata, dict)
        else None
    )
    data = response.get("data")
    status = data.get("status") if isinstance(data, dict) else None
    if status in _RESULT_CATEGORIES:
        return status, request_id or local_id, None
    error_category = "upstream_error" if "error" in response else "invalid_response"
    return "error", request_id or local_id, error_category


def _log_fields(
    section: Section,
    client_id: str | None,
    started_at: float,
    result: str,
    correlation_id: str,
    error_category: str | None,
) -> dict[str, object]:
    return {
        "tool_name": "get_qfield_project_stats",
        "section": section,
        "oauth_client_id": client_id,
        "duration_ms": round((time.monotonic() - started_at) * 1000, 3),
        "result_category": result,
        "correlation_id": correlation_id,
        "error_category": error_category,
    }


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
    started_at = time.monotonic()
    local_id = "local-" + uuid.uuid4().hex
    client_id = _oauth_client_id()
    try:
        body = await anyio.to_thread.run_sync(
            partial(_qfield_project_stats_sync, project, section, page, limit)
        )
    except Exception:
        logger.error(
            "qfield_project_stats_invocation",
            extra=_log_fields(
                section,
                client_id,
                started_at,
                "error",
                local_id,
                "adapter_exception",
            ),
        )
        raise

    result, correlation_id, error_category = _response_fields(body, local_id)
    logger.info(
        "qfield_project_stats_invocation",
        extra=_log_fields(
            section,
            client_id,
            started_at,
            result,
            correlation_id,
            error_category,
        ),
    )
    return body
