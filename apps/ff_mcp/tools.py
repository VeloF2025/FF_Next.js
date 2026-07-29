"""The three MCP tools Claude calls: discover, describe, fetch.

Tool descriptions here are load-bearing, not documentation. They are the only thing
that decides whether Claude calls a tool at all, so they state the trigger condition
("call this FIRST, before …, whenever you are not certain …") rather than merely
describing behaviour.

Nothing in this module is a security control. The read-only restriction and RBAC are
enforced by FibreFlow server-side, on every request, for the user the token belongs to.
The path and group checks below are blast-radius guards: they stop an agent wandering
into payroll while answering a question about drops.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from mcp.server.auth.middleware.auth_context import get_access_token

from .config import FF_APP_BASE
from .server import mcp

CATALOGUE_PATH = Path(__file__).with_name("endpoints.json")

# Mirrors DENIED_GROUPS in scripts/build-mcp-endpoint-catalogue.ts. Omitting a group
# from the catalogue is not enough on its own — Claude can construct a path it never saw
# listed — so fibreflow_get refuses them too.
DENIED_GROUPS = ("accounting", "staff", "my", "cortex-remote-mcp", "ff-remote-mcp")

MAX_ROWS = 200
MAX_RESPONSE_CHARS = 15_000

# Ceiling on upstream calls per token per hour. The guard is against an agent
# enumerating export routes in a loop, not against a human asking questions.
RATE_LIMIT_PER_HOUR = 40
_RATE_WINDOW_SECONDS = 3600
_call_times: dict[str, list[float]] = defaultdict(list)


def _load_routes() -> list[dict]:
    data = json.loads(CATALOGUE_PATH.read_text())
    return data.get("routes", [])


def _group_of(path: str) -> str:
    trimmed = path[len("/api") :] if path.startswith("/api") else path
    return trimmed.strip("/").split("/")[0] or "root"


def _denied_group(group: str) -> str | None:
    """Match a denied group OR any hyphenated sibling: `staff` also covers `staff-documents`.

    Routes in this repo are flattened, so one logical area spreads across sibling group
    names. Exact matching would leave `staff-documents` reachable.
    """
    for denied in DENIED_GROUPS:
        if group == denied or group.startswith(denied + "-"):
            return denied
    return None


def _access_token() -> str:
    access = get_access_token()
    token = getattr(access, "ff_token", "") if access else ""
    if not token:
        raise RuntimeError(
            "No FibreFlow credential on this request. Reconnect the FibreFlow connector "
            "in Claude to authorize again."
        )
    return token


def _rate_limit(token: str) -> None:
    """Fixed-window-free sliding limiter keyed by token. Raises when over budget."""
    now = time.time()
    # Key on a digest-length prefix rather than the token itself so the raw credential is
    # not held as a dict key any longer than the request needs it.
    key = token[-16:]
    recent = [t for t in _call_times[key] if now - t < _RATE_WINDOW_SECONDS]
    if len(recent) >= RATE_LIMIT_PER_HOUR:
        oldest = min(recent)
        wait_minutes = int((_RATE_WINDOW_SECONDS - (now - oldest)) // 60) + 1
        _call_times[key] = recent
        raise RuntimeError(
            f"Rate limit reached: {RATE_LIMIT_PER_HOUR} FibreFlow requests per hour for "
            f"this connection. Try again in about {wait_minutes} minute(s). If you are "
            "gathering a lot of data, narrow the query or use the endpoint's page/limit "
            "parameters instead of fetching everything."
        )
    recent.append(now)
    _call_times[key] = recent


@mcp.tool()
def list_endpoints(filter: str = "", group: str = "") -> str:
    """Discover FibreFlow API endpoints. Call this FIRST, before fibreflow_get, whenever
    you are not certain a path exists.

    FibreFlow has hundreds of read endpoints; guessing a path wastes a call and can make
    you conclude data is missing when it is not. Filter by keyword (matches the path and
    description) or by group (the first path segment, e.g. "projects", "noc", "fleet").
    Results are capped, and the reply states how many matched in total — if the total
    exceeds what is shown, narrow the filter rather than assuming you have seen
    everything.
    """
    routes = _load_routes()
    needle = filter.strip().lower()
    wanted_group = group.strip().lower()

    matched = [
        r
        for r in routes
        if (not wanted_group or r.get("group", "").lower() == wanted_group)
        and (
            not needle
            or needle in r.get("path", "").lower()
            or needle in (r.get("description") or "").lower()
        )
    ]

    shown = matched[:MAX_ROWS]
    payload = {
        "matched": len(matched),
        "shown": len(shown),
        "truncated": len(matched) > len(shown),
        "routes": shown,
    }
    if payload["truncated"]:
        payload["note"] = (
            f"{len(matched)} endpoints matched; showing the first {len(shown)}. "
            "Narrow with a more specific filter or a group to see the rest."
        )
    if not matched:
        payload["note"] = (
            "Nothing matched. Try a broader keyword, or call list_endpoints with no "
            "arguments to see the available groups."
        )
    return json.dumps(payload, indent=2)


@mcp.tool()
def describe_endpoint(path: str) -> str:
    """Show what a specific FibreFlow endpoint accepts before you call it.

    Use this when list_endpoints has given you a path containing :params (e.g.
    /api/projects/:projectId) so you know which values you must supply. Returns the
    methods, the description, and the required path parameters.
    """
    wanted = path.strip()
    for route in _load_routes():
        if route.get("path") == wanted:
            params = [
                seg[1:] for seg in route["path"].split("/") if seg.startswith(":")
            ]
            return json.dumps(
                {
                    "path": route["path"],
                    "methods": route.get("methods", []),
                    "group": route.get("group"),
                    "description": route.get("description"),
                    "pathParams": params,
                    "note": (
                        "Substitute a real value for each pathParam before calling "
                        "fibreflow_get."
                        if params
                        else None
                    ),
                },
                indent=2,
            )
    return json.dumps(
        {
            "error": f"No catalogued endpoint matches {wanted!r}.",
            "hint": "Call list_endpoints with a keyword to find the correct path.",
        },
        indent=2,
    )


def _reject(message: str, **extra) -> str:
    return json.dumps({"error": message, **extra}, indent=2)


@mcp.tool()
def fibreflow_get(path: str, query: str = "") -> str:
    """Read data from FibreFlow as the signed-in user. Read-only — FibreFlow refuses
    every write made with this connection.

    Use a path from list_endpoints (e.g. "/api/projects"), not a full URL. Pass query
    parameters as a urlencoded string (e.g. "limit=20&status=active"). You see exactly
    what that user sees in the app: their projects, their permissions, nothing more. A
    403 or 404 means they lack access to that data — report it rather than retrying
    variants of the path.
    """
    target = path.strip()
    if not target.startswith("/api/"):
        return _reject(
            "path must be a FibreFlow API path beginning with /api/ — not a full URL "
            "and not an app page.",
            received=target,
        )
    if ".." in target or "//" in target[1:]:
        return _reject("path must not contain '..' or '//'.", received=target)

    group = _group_of(target)
    denied = _denied_group(group)
    if denied:
        # Stated plainly so the model stops rather than probing sibling paths.
        return _reject(
            f"The '{denied}' area is not available through this connector. This is a "
            "deliberate restriction, not a missing endpoint — do not try other paths "
            "in this area.",
            group=group,
        )

    try:
        token = _access_token()
        _rate_limit(token)
    except RuntimeError as exc:
        return _reject(str(exc))

    url = FF_APP_BASE + target
    if query.strip():
        url += ("&" if "?" in url else "?") + query.strip().lstrip("?&")

    req = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            "User-Agent": "ff-remote-mcp/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        # Passed through verbatim: a 403 MCP_READ_ONLY is informative, and the model
        # should see FibreFlow's own message rather than a laundered one.
        detail = exc.read(2000).decode("utf-8", "replace")
        return _reject(
            f"FibreFlow returned HTTP {exc.code}", path=target, response=detail
        )
    except urllib.error.URLError as exc:
        return _reject(f"FibreFlow unreachable: {exc.reason}", path=target)

    if len(body) > MAX_RESPONSE_CHARS:
        # Never truncate silently — a partial page that looks whole is worse than an
        # error, because the model will summarise it as if it were the full result.
        return json.dumps(
            {
                "truncated": True,
                "shownChars": MAX_RESPONSE_CHARS,
                "totalChars": len(body),
                "note": (
                    "This response was cut short. You are NOT seeing the full result. "
                    "Re-request with pagination — most FibreFlow list endpoints accept "
                    "'limit' and 'page' (some use 'offset') — rather than treating this "
                    "as complete."
                ),
                "body": body[:MAX_RESPONSE_CHARS],
            },
            indent=2,
        )
    return body
