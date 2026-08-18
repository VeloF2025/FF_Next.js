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
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from functools import partial
from pathlib import Path

import anyio.to_thread

from mcp.server.auth.middleware.auth_context import get_access_token

from .config import FF_APP_BASE
from .server import mcp


# Mirrors DENIED_GROUPS in scripts/build-mcp-endpoint-catalogue.ts. Omitting a group
# from the catalogue is not enough on its own — Claude can construct a path it never saw
# listed — so fibreflow_get refuses them too.
# `action-items` is denied because those rows are meeting content and /api/action-items
# applies no attendance filter — see the note in build-mcp-endpoint-catalogue.ts. The
# attendance-scoped report at /api/reporting/action-items is in the `reporting` group and
# stays reachable.
DENIED_GROUPS = (
    "accounting",
    "staff",
    "my",
    "cortex-remote-mcp",
    "ff-remote-mcp",
    "action-items",
    # Added 2026-08-18 after an audit of the COMBINED surface: each of these holds a
    # route that reads the same rows as a sanctioned tool under a weaker gate.
    # `meetings` covers /api/meetings (withAuth-only, returns full summary text and a
    # wider attendance predicate than find_meetings); `procurement` covers
    # purchase-orders and boq-spend-summary (withAuth-only PO/BOQ money that
    # get_procurement_summary withholds from callers lacking `procurement` view).
    # The sanctioned tools are unaffected — they all call the `reporting` group.
    #
    # `field` is deliberately NOT here: the hyphenated-sibling rule would make it match
    # `field-stock` and take out the whole warehouse module. See DENIED_PATHS.
    "meetings",
    "procurement",
)

# Individual routes withheld where denying the whole GROUP would be too broad.
#
# Matched on the canonical path, exactly or as a path prefix, so query strings and
# trailing segments cannot walk around an entry. Group denial stays the default — this
# exists for the case where one route in an otherwise legitimate area is the problem.
#
# /api/field/attendance carries the same permission key as the supervisor-scoped report
# (`people.staff.attendance.search`) but applies NO scope: its only predicates are
# `role IN ('technician','casual')` and a date range, so any holder gets the entire field
# workforce with clock_in_at/clock_out_at and site_geofence_id. Denying the `field` group
# instead would also deny `field-stock`, which is unrelated and legitimate.
#
# Like DENIED_GROUPS this is blast-radius, not a boundary — the route still needs its own
# scope, which cannot be applied until staff.reports_to is populated (currently zero of
# the 32 active field staff have a supervisor set).
DENIED_PATHS = ("/api/field/attendance",)

MAX_RESPONSE_CHARS = 15_000

# Ceiling on upstream calls per token per hour. The guard is against an agent
# enumerating export routes in a loop, not against a human asking questions.
RATE_LIMIT_PER_HOUR = 40
_RATE_WINDOW_SECONDS = 3600
_call_times: dict[str, list[float]] = defaultdict(list)
# Guards every read-modify-write of _call_times; see _rate_limit.
_call_times_lock = threading.Lock()


def _canonical(path: str) -> str:
    """Decode and lower-case a path for guard checks.

    The guards must run on what FibreFlow will ACTUALLY route, not on the raw string.
    Next.js decodes percent-escapes before matching and route directories are all
    lower-case, so checking the raw string lets `/api/Accounting/ledger` and
    `/api/%2e%2e/x` walk straight past an exact-match denylist and a literal ".."
    substring check. Decoding is repeated until stable so a double-encoded `%252e`
    cannot survive one pass.

    Single-dot segments are then collapsed, because Next.js resolves them before routing:
    `/api/field/./attendance` reaches the same handler as `/api/field/attendance`. Without
    this the guards saw a different string than the router did, and ONE character defeated
    every deny in this module — `_group_of("/api/./meetings")` returned "." rather than
    "meetings", so the group check passed, and the literal path check failed to match too.
    Confirmed live before the fix: the dotted form returned 401 (the real route, awaiting
    auth) where a genuinely unknown route returns 404.

    `..` is NOT resolved here. It stays a refusal in _guard_path — collapsing it would
    silently accept `/api/staff/../field/x`, and a caller with a legitimate path has no
    reason to send one.
    """
    prev, cur = None, path
    for _ in range(5):
        if cur == prev:
            break
        prev, cur = cur, urllib.parse.unquote(cur)
    cur = cur.lower()

    # Drop "." segments while preserving everything else, including a trailing slash and
    # any query string (which later checks strip themselves).
    if "." in cur:
        head, sep, tail = cur.partition("?")
        segments = [seg for seg in head.split("/") if seg != "."]
        head = "/".join(segments)
        # A path that was entirely dots after /api/ must not collapse to "" and lose its
        # leading slash, which would fail the /api/ prefix check for the wrong reason.
        if not head.startswith("/") and path.startswith("/"):
            head = "/" + head
        cur = head + sep + tail
    return cur


def _group_of(path: str) -> str:
    trimmed = path[len("/api") :] if path.startswith("/api") else path
    return trimmed.strip("/").split("/")[0] or "root"


def _denied_group(group: str) -> str | None:
    """Match a denied group OR any hyphenated sibling: `staff` also covers `staff-documents`.

    Routes in this repo are flattened, so one logical area spreads across sibling group
    names. Exact matching would leave `staff-documents` reachable.

    Lower-cases defensively even though callers pass an already-canonical path — this
    predicate is the guard, and it should not depend on every caller remembering.
    """
    normalised = group.lower()
    for denied in DENIED_GROUPS:
        if normalised == denied or normalised.startswith(denied + "-"):
            return denied
    return None


def _denied_path(canonical: str) -> str | None:
    """Match a denied route exactly, or as a path prefix so sub-paths cannot slip by.

    Prefix matching is on a path SEGMENT boundary: `/api/field/attendance` denies
    `/api/field/attendance/2026-08` but not a hypothetical `/api/field/attendance-policy`,
    which is a different route and not what this entry is about.

    The query string and fragment are stripped before matching. `fibreflow_get` takes the
    query as its own parameter, but nothing stops a model putting it in the path — and
    `/api/field/attendance?from=2026-01-01` must not walk around the entry just because it
    is no longer string-equal. The group check does not need this (it splits on "/" and so
    never sees the query), which is exactly why it was missed here first.
    """
    bare = canonical.split("?", 1)[0].split("#", 1)[0]
    for denied in DENIED_PATHS:
        if bare == denied or bare.startswith(denied + "/"):
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
    """Sliding-window limiter keyed by token. Raises when over budget.

    Holds _call_times_lock for the whole read-sweep-append-write sequence. This is not
    theoretical caution: fibreflow_get now runs on a real worker-thread pool
    (anyio.to_thread), so two concurrent calls genuinely execute this at once. Without
    the lock the sweep iterates the dict while another thread inserts into it —
    "RuntimeError: dictionary changed size during iteration", which the caller would
    swallow and report to Claude as a nonsense tool error — and two calls sharing a key
    can both read the same list, both append, and lose one increment, making the limit
    quietly more permissive than it claims.
    """
    now = time.time()
    # Key on a digest-length prefix rather than the token itself so the raw credential is
    # not held as a dict key any longer than the request needs it.
    key = token[-16:]

    with _call_times_lock:
        # Sweep keys that have gone quiet, not just old timestamps within a key. Without
        # this the dict grows one entry per token ever seen, forever, in a process
        # systemd keeps alive indefinitely. The comprehension materialises before the
        # loop body deletes, and the lock keeps other threads out meanwhile.
        for stale in [
            k for k, v in _call_times.items()
            if not v or now - max(v) >= _RATE_WINDOW_SECONDS
        ]:
            if stale != key:
                del _call_times[stale]

        recent = [t for t in _call_times[key] if now - t < _RATE_WINDOW_SECONDS]
        if len(recent) >= RATE_LIMIT_PER_HOUR:
            oldest = min(recent)
            wait_minutes = int((_RATE_WINDOW_SECONDS - (now - oldest)) // 60) + 1
            _call_times[key] = recent
            raise RuntimeError(
                f"Rate limit reached: {RATE_LIMIT_PER_HOUR} FibreFlow requests per hour "
                f"for this connection. Try again in about {wait_minutes} minute(s). If "
                "you are gathering a lot of data, narrow the query or use the endpoint's "
                "page/limit parameters instead of fetching everything."
            )
        recent.append(now)
        _call_times[key] = recent


def build_query(**params: object) -> str:
    """Urlencode the parameters that were actually given, dropping the rest.

    Shared by every tool module. Sending `type=None` would filter on the literal string
    "None" and match nothing, which reads back to the model as "this project has no depth
    photos" rather than as an error.
    """
    present = {k: v for k, v in params.items() if v is not None and v != ""}
    return urllib.parse.urlencode(present)


def _reject(message: str, **extra) -> str:
    return json.dumps({"error": message, **extra}, indent=2)


def _guard_path(target: str) -> dict[str, object] | None:
    """Refuse a path that must never reach FibreFlow.

    Returns the `_reject` payload for a refusal (its "message" plus the context fields
    that refusal carries), or None when the path may proceed.

    Extracted so every tool that reaches FibreFlow shares ONE guard. A second tool with
    its own copy is a guard that drifts: the copy would keep passing the tests written
    against this one while quietly diverging from it.
    """
    # Every guard below runs on the canonical form, never on the raw string.
    canonical = _canonical(target)
    if not canonical.startswith("/api/"):
        return {
            "message": (
                "path must be a FibreFlow API path beginning with /api/ — not a full URL "
                "and not an app page."
            ),
            "received": target,
        }
    if ".." in canonical or "//" in canonical[1:]:
        return {"message": "path must not contain '..' or '//'.", "received": target}

    denied_path = _denied_path(canonical)
    if denied_path:
        return {
            "message": (
                f"'{denied_path}' is not available through this connector. This is a "
                "deliberate restriction, not a missing endpoint."
            ),
            "path": canonical,
        }

    group = _group_of(canonical)
    denied = _denied_group(group)
    if denied:
        # Stated plainly so the model stops rather than probing sibling paths.
        return {
            "message": (
                f"The '{denied}' area is not available through this connector. This is a "
                "deliberate restriction, not a missing endpoint — do not try other paths "
                "in this area."
            ),
            "group": group,
        }
    return None


def _build_url(target: str, query: str) -> str:
    url = FF_APP_BASE + target
    if query.strip():
        url += ("&" if "?" in url else "?") + query.strip().lstrip("?&")
    return url


def _fibreflow_get_sync(path: str, query: str = "") -> str:
    """The body of fibreflow_get. Sync, because it does blocking HTTP.

    The tool wrapper runs this on a worker thread. It must not be called directly from
    the event loop — see the note on fibreflow_get.
    """
    target = path.strip()
    refusal = _guard_path(target)
    if refusal is not None:
        return _reject(str(refusal.pop("message")), **refusal)

    try:
        token = _access_token()
        _rate_limit(token)
    except RuntimeError as exc:
        return _reject(str(exc))

    url = _build_url(target, query)

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


@mcp.tool()
async def fibreflow_get(path: str, query: str = "") -> str:
    """Read data from FibreFlow as the signed-in user. Read-only — FibreFlow refuses
    every write made with this connection.

    Use a path from list_endpoints (e.g. "/api/projects"), not a full URL. Pass query
    parameters as a urlencoded string (e.g. "limit=20&status=active"). You see exactly
    what that user sees in the app: their projects, their permissions, nothing more. A
    403 or 404 means they lack access to that data — report it rather than retrying
    variants of the path.
    """
    # async + to_thread, deliberately. FastMCP calls a SYNC tool inline on the event
    # loop (func_metadata.py: `return fn(**args)` with no thread offload), and this
    # service is a single process, so one slow FibreFlow response would stall every
    # other user's tool call AND the OAuth endpoints for the whole 30s timeout.
    return await anyio.to_thread.run_sync(partial(_fibreflow_get_sync, path, query))
