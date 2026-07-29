# dr-photo-api (BOSS) — reconstructed from the running container on 2026-07-18
# and build + /health smoke validated on 2026-07-29.
#
# Secrets (ONEMAP_EMAIL/ONEMAP_PASSWORD, DATABASE_URL, *_API_KEY) come from the
# environment / docker-compose.yml at runtime — never baked into the image.
FROM python:3.12-slim@sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agents ./agents
COPY api ./api
COPY lib ./lib

# data/ (~35G of downloaded DR photos) is a runtime volume, not part of the image.
EXPOSE 8001
CMD ["uvicorn", "api.dr_photo_api:app", "--host", "0.0.0.0", "--port", "8001"]
