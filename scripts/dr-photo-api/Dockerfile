# dr-photo-api (BOSS) — reconstructed 2026-07-18 from the running container.
#
# The original image (boss-vps-dr-photo-api:latest) was DANGLING with no build
# context on disk, and the source lived only in the container's writable layer.
# This Dockerfile is a best-effort rebuild — VALIDATE it (build + smoke test the
# /api/record endpoint) before relying on it to recreate the container.
#
# Secrets (ONEMAP_EMAIL/ONEMAP_PASSWORD, DATABASE_URL, *_API_KEY) come from the
# environment / docker-compose.yml at runtime — never baked into the image.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agents ./agents
COPY api ./api
COPY lib ./lib

# data/ (~35G of downloaded DR photos) is a runtime volume, not part of the image.
EXPOSE 8001
CMD ["uvicorn", "api.dr_photo_api:app", "--host", "0.0.0.0", "--port", "8001"]
