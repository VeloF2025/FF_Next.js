# dr-photo-api (BOSS) — source snapshot

Preserved **2026-07-18** from the running `dr-photo-api` container on velo
(`100.96.203.105`, exposed on `:8003`). The source existed **only** in the
container's writable layer, and the Docker image was dangling with no build
context — so a `docker rm`/recreate would have lost it permanently. This repo is
the recovery baseline.

## What it does
FastAPI service FibreFlow calls to check a DR against 1Map (`GET /api/record/{dr}`):
returns sign-up `status`, `photo_count`, `ont_barcode`, `ups_serial`, etc. Used by
the WhatsApp acknowledgment path (`fetchOneMapRecord` in FF_Next.js).

## Key files
- `agents/integrations/onemap_specialist_agent.py` — 1Map lookup + auth.
  - Etwatwa: v1 token API, fresh login every request.
  - Non-Etwatwa (Lawley/Mamelodi/Mohadin/Thembisa): cookie web-login per
    `account_id`. **As of 2026-07-18 this logs in FRESH per request.** It used to
    cache the session in a process-wide dict with no TTL; 1Map expired the cookie
    server-side (still HTTP 200, empty results, no error), so every non-Etwatwa
    lookup silently returned "not found" from ~18:15 SAST 2026-07-17 until the
    container was restarted — the "NOT ON 1MAP" false-flag regression.
- `api/dr_photo_api.py` — HTTP endpoints / response builder.

## Runtime
`uvicorn api.dr_photo_api:app --host 0.0.0.0 --port 8001` (python:3.12).
Secrets via env — see `/srv/services/dr-photo-api/docker-compose.yml` (NOT committed).
`data/` (~35G downloaded photos) is a runtime volume, gitignored.

## TODO
- Validate `Dockerfile` (build + smoke test) so the container is rebuildable.
- Consider pushing to a private GitHub repo after a secret scan.
