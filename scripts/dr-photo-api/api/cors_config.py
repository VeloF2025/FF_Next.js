"""Shared CORS configuration for the BOSS FastAPI apps.

Both entry points (``api.dr_photo_api`` and ``api.main``) call ``configure_cors``
so their CORS policy can never diverge again.

These are internal server-to-server APIs (the FibreFlow backend, n8n, the hourly
catch-up scripts) plus same-origin dashboards. None are cross-origin browser
callers, so credentialed wildcard CORS is never required — and
``allow_origins=["*"]`` combined with ``allow_credentials=True`` lets any website
drive credentialed cross-origin requests against the host and read the responses.

Origins come from ``DR_PHOTO_API_CORS_ORIGINS`` (comma-separated). The secure
default is empty: no cross-origin browser access, while server-to-server callers
(which send no ``Origin`` header) are unaffected. Credentials are enabled only
for an explicit, non-wildcard allowlist, so the wildcard+credentials combination
can never recur.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

CORS_ORIGINS_ENV = "DR_PHOTO_API_CORS_ORIGINS"


def configure_cors(app: FastAPI) -> None:
    """Attach the CORS middleware with the secure, env-driven policy."""
    origins = [
        origin.strip()
        for origin in os.environ.get(CORS_ORIGINS_ENV, "").split(",")
        if origin.strip()
    ]
    allow_credentials = bool(origins) and "*" not in origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
