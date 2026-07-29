# dr-photo-api (BOSS)

Canonical, reproducibly specified source for the production DR Photo Verification API on
Velocity (`dr-photo-api`, host port `8003`).

The source was recovered from the running container on 2026-07-18. On
2026-07-29 it was reconciled again against that container, including the
parent-account cross-project resolver and null-GPS guards added live on
2026-07-24. The Dockerfile was then built and its `/health` endpoint smoke
tested successfully.

Do not build from `/opt/boss` on the Hostinger VPS or from an untracked copy
under `/srv/data`. Those are not authoritative. All changes start here, go
through a FibreFlow pull request, and use an immutable Git SHA as the image tag.

## What it does

FastAPI service FibreFlow calls to check a DR against 1Map
(`GET /api/record/{dr}`) and download activation photos. The lookup order is:

1. primary v1 token on layer 5121;
2. parent-account v1 token on contractor layer 6236, when
   `ONEMAP_RESOLVE_EMAIL` and `ONEMAP_RESOLVE_PASSWORD` are configured;
3. per-project web-session fallback.

The parent path preserves all Property IDs for a DR. Photo binaries remain on
the primary token because the parent account cannot read attachments.

## Test and build

Build only an explicitly reviewed commit from a tracked-files-only Git archive.
The working tree is never used as Docker context, so ignored bytecode, backup
files, or local environment files cannot enter the image. The Docker base image
and complete Python dependency graph are pinned.

From the repository root, export `REVIEWED_SHA` as the approved full commit and
`BUILD_RECORD_DIR` as a new persistent directory:

```bash
export REVIEWED_SHA="<approved-full-git-sha>"
export BUILD_RECORD_DIR="/persistent/path/dr-photo-api-${REVIEWED_SHA}"
bash scripts/dr-photo-api/build-reviewed-image.sh
EXPECTED_IMAGE_ID="$(cat "$BUILD_RECORD_DIR/image.iid")"
IMAGE_TAG="$REVIEWED_SHA"
```

The builder verifies its own bytes against `REVIEWED_SHA`, neutralizes inherited
Git/Tar configuration, tests one archive extraction, builds a second pristine
extraction, verifies critical archive blobs, and rejects ignored/local artifacts
inside the completed image. It atomically publishes an immutable directory
containing `source.sha`, `image.iid`, and `compose.yml` only after every check
passes; concurrent publication cannot overwrite or interleave the records.

Smoke-test the exact image without touching production:

```bash
docker run -d --rm \
  --name "dr-photo-smoke-${IMAGE_TAG:0:12}" \
  -p 127.0.0.1:18003:8001 \
  -e ONEMAP_EMAIL=test@example.invalid \
  -e ONEMAP_PASSWORD=test-only \
  "$EXPECTED_IMAGE_ID"

curl -fsS --retry 10 --retry-connrefused \
  http://127.0.0.1:18003/health

docker stop "dr-photo-smoke-${IMAGE_TAG:0:12}"
```

Expected health response includes `"status":"healthy"`.

## Production promotion

Production promotion is a separate, explicitly approved operation. Do not
perform it as part of a code review or merge.

The live service uses:

- compose project: `/srv/services/dr-photo-api/`
- container: `dr-photo-api`
- network: external `boss-network`
- host-local binding: `127.0.0.1:8003:8001`
- trusted remote binding: `100.96.203.105:8003:8001`
- persistent mounts:
  `/srv/data/boss/dr_photos:/app/data/dr_photos` and
  `/srv/data/boss/dr_sessions:/app/data/dr_sessions`

After approval:

1. Build the reviewed commit and retain its `BUILD_RECORD_DIR` using the
   workflow above.
2. Load the expected content ID and verify the convenience tag has not moved:
   ```bash
   EXPECTED_IMAGE_ID="$(cat "$BUILD_RECORD_DIR/image.iid")"
   test "$(docker image inspect "boss-vps-dr-photo-api:${REVIEWED_SHA}" \
     --format '{{.Id}}')" = "$EXPECTED_IMAGE_ID"
   export DR_PHOTO_API_IMAGE_ID="$EXPECTED_IMAGE_ID"
   ```
3. Set `REVIEWED_COMPOSE="${BUILD_RECORD_DIR}/compose.yml"` and use only that
   archived compose artifact. Keep credentials in
   `/srv/services/dr-photo-api/.env`; do not use an implicit default or override
   compose file.
4. Do not parameterize or widen its pinned loopback and Velocity Tailscale
   bindings: this internal service is unauthenticated and returns subscriber
   contact data.
5. Validate and run the exact reviewed artifact explicitly:
   ```bash
   docker-compose --env-file /srv/services/dr-photo-api/.env \
     -f "$REVIEWED_COMPOSE" config --quiet
   docker-compose --env-file /srv/services/dr-photo-api/.env \
     -f "$REVIEWED_COMPOSE" up -d --no-build dr-photo-api
   ```
6. Verify Compose started the reviewed content ID, require the health check to
   pass, then verify the container ID:
   ```bash
   test "$(docker inspect dr-photo-api --format '{{.Image}}')" = \
     "$EXPECTED_IMAGE_ID"
   ```
   Then check `http://127.0.0.1:8003/health` and one known DR from each project.
7. Record the promoted source SHA and expected image ID in the deployment
   handoff.

Never promote `latest`: it cannot prove which reviewed source is running.

## Rollback

Keep the previous immutable build-record directory. To roll back, export
`DR_PHOTO_API_IMAGE_ID` from its `image.iid` and use its `compose.yml` with the
same explicit `--env-file` / `-f` command. The photo/session bind mounts are not
replaced by an image rollback. Verify the running container ID after rollback
with the same check above.

## Runtime configuration

Required credentials are environment-only:

- `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`
- `ONEMAP_RESOLVE_EMAIL`, `ONEMAP_RESOLVE_PASSWORD`

Other runtime settings are listed in `compose.example.yml`. Never commit the
runtime `.env` or copy values from the live container into Git.
