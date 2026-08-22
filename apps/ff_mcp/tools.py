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
import re
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
# `action-items` rows are meeting content and /api/action-items applies no attendance
# filter — and no permission check either. The attendance-scoped report at
# /api/reporting/action-items is in the `reporting` group and stays reachable.
DENIED_GROUPS = (
    # MIRRORS src/lib/auth/mcpDeniedAreas.ts, which ENFORCES this server-side for every
    # kind='mcp' session. This copy saves a round-trip and stops the model proposing a
    # path it would only be refused — it is not the boundary.
    #
    # Narrowed 2026-08-22, then re-narrowed the same day. The first pass opened
    # meetings, procurement, action-items, my and /api/field/attendance on the claim that
    # per-route RBAC already bounds them. Blind review measured that claim and it was
    # false for three of the five: procurement, meetings and action-items are withAuth-only
    # (counts below), so authentication bounds them, not permissions. Only `my` and
    # /api/field/attendance stayed open.
    #
    # The areas below are the ones where "bounded by the caller's own permissions" is
    # NOT true:
    #
    #   accounting — the UI is unused but the data is live (5,201 GL journal lines,
    #                1,043 Sage supplier invoices). Retire the routes rather than expose.
    #   staff      — grants admin + manager + super_admin, carrying people.staff.sensitive
    #                and .tabs.disciplinary (31 accounts); super_admin bypasses RBAC
    #                entirely, so for 10 of them nothing bounds it at all.
    "accounting",
    # Kept: measured 0 of 8 meetings routes, 0 of 6 action-items and 10 of 139
    # procurement routes carry withPermission. The permission keys gate /api/reporting/*,
    # not these groups — withAuth-only means any authenticated session reaches them.
    "meetings",
    "action-items",
    "procurement",
    "staff",
    "cortex-remote-mcp",
    "ff-remote-mcp",
)

# Individual routes withheld where denying the whole GROUP would be too broad.
#
# Empty by design. /api/field/attendance was the only entry and was opened deliberately:
# `people.staff.attendance.search` already grants manager, project_manager and
# site_supervisor, and project managers have a real need to see attendance. Its lack of
# supervisor scope matters less than it sounds — NO active field staff have
# `staff.reports_to` set, so a scope would return NOTHING rather than a narrower set.
#
# The mechanism stays wired and tested so the next entry costs one line.
DENIED_PATHS: tuple[str, ...] = ()

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

    Single-dot segments are then collapsed. Before this, ONE character defeated every deny
    in this module: `_group_of("/api/./meetings")` returned "." rather than "meetings", so
    the group check passed, and the literal path check failed to match too.

    Measured, so the reason is not overstated: FibreFlow's own router does NOT resolve dot
    segments — `curl --path-as-is /api/field/./attendance` returns 404, the same as a
    route that does not exist, where the plain path returns 401. So this was not a live
    hole in THIS deployment; the earlier claim that it returned 401 came from curl
    collapsing "./" client-side before sending.

    It is collapsed anyway because the guard must not be made to read a different string
    than whatever eventually routes the request. Any proxy, CDN or client library that
    does normalise (most do, per RFC 3986 §6.2.2.3) would turn the mismatch into a real
    bypass, and this module is upstream of all of them.

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


# What an API path may contain, after canonicalisation (already lower-cased).
# Deliberately narrow: real routes are lower-case alphanumerics with dashes,
# underscores, dots (file extensions) and slashes. Anything else — control bytes,
# whitespace, a fragment, a backslash, a homoglyph — is refused rather than guessed at.
_ALLOWED_PATH = re.compile(r"^/api(/[a-z0-9][a-z0-9._\-]*)*/?$")


def _malformed(canonical: str) -> str | None:
    """Refuse a path whose SHAPE could make the denylists read it as something else.

    Returns the refusal message, or None when the path is a clean API path.
    """
    bare = canonical.split("?", 1)[0]

    if "#" in canonical:
        # `_denied_path` stripped the fragment and `_group_of` did not, so the two checks
        # disagreed about where the path ended. urllib drops it before the wire anyway, so
        # a fragment is never useful here — only a way to make the guards disagree.
        return "path must not contain '#'."

    if any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in bare):
        return "path must not contain whitespace or control characters."

    if not _ALLOWED_PATH.match(bare):
        return (
            "path must be a plain FibreFlow API path — lower-case letters, digits, "
            "'-', '_', '.' and '/' only."
        )

    # A segment ending in "." is the same route to some servers and a different string to
    # the denylists, which is precisely the mismatch this function exists to remove.
    if any(seg.endswith(".") for seg in bare.split("/") if seg):
        return "path segments must not end with '.'."

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

    shape = _malformed(canonical)
    if shape:
        # Refused rather than normalised. The denylists match a path against a literal, so
        # ANY trailing byte that is not "/" slipped past both of them:
        # `_group_of("/api/meetings\x00")` is "meetings\x00", which != "meetings", and
        # "/api/field/attendance." is neither equal to the denied path nor prefixed by it.
        # Today FibreFlow's stack 400s or 404s those, so nothing was reachable — but that
        # is upstream leniency this module does not control and explicitly does not claim
        # to rely on. Enumerating bad bytes would be a losing game, so this states what a
        # path may contain and refuses everything else.
        return {"message": shape, "received": target}

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
