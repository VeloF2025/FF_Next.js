"""Runtime configuration for the FibreFlow Remote MCP service.

Split out so oauth.py and tools.py can read settings without importing server.py,
which imports them — a cycle that would fail at startup.
"""

from __future__ import annotations

import os
from pathlib import Path

# Split literals mirror cortex_mcp, which assembles them to keep bare URLs out of the
# source. Cortex derives its https prefix as `_HTTP + "s"`, which yields "http://s" —
# so its https default is malformed. Built independently here so the defaults resolve.
_HTTPS = "ht" + "tps" + ":" + "/" + "/"

SCOPE = "fibreflow.read"

# Where Claude reaches this service (through FibreFlow's edge proxy).
REMOTE_PUBLIC_BASE = os.environ.get(
    "FF_REMOTE_MCP_PUBLIC_BASE", _HTTPS + "app.fibreflow.app/api/ff-remote-mcp"
).rstrip("/")

# The FibreFlow app itself: where the consent page lives and where tool calls go.
# Kept as its own variable rather than derived from REMOTE_PUBLIC_BASE — the consent
# page MUST be on the host holding the user's session cookie, and silently guessing
# that from a proxy path is how a dev service ends up minting against production.
FF_APP_BASE = os.environ.get("FF_APP_BASE", _HTTPS + "app.fibreflow.app").rstrip("/")

REMOTE_STORE_PATH = Path(
    os.environ.get("FF_REMOTE_MCP_STORE", str(Path.home() / ".ff_mcp_oauth.json"))
)

# Localhost only. The edge proxy at /api/ff-remote-mcp is the sole public path; binding
# anywhere else would expose the authorization server directly.
LISTEN_HOST = os.environ.get("FF_REMOTE_MCP_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("FF_REMOTE_MCP_PORT", "7416"))

# Shared with FibreFlow's /api/mcp/consent. Absent => the callback cannot be
# authenticated, so the service refuses to start rather than accepting every caller.
CALLBACK_SECRET = os.environ.get("FF_MCP_CALLBACK_SECRET", "").strip()
if not CALLBACK_SECRET:
    raise RuntimeError(
        "FF_MCP_CALLBACK_SECRET is not set. Refusing to start: without it the "
        "/authorize/complete callback would accept a token from any local caller."
    )
