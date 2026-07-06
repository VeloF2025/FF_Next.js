# Works QA — "Download whole zone" photo ZIP

**Date:** 2026-07-06
**Requested by:** Johan (via Hein) — Works QA field ops
**Branch:** `feat/works-qa-zone-zip`

## Problem

To archive a project's QA photos onto SharePoint, Johan currently downloads the
Works QA photo ZIP **one PON at a time**, then extracts and files each into a
`Zone → PON → Pole` folder tree by hand. Tonga is a single zone with ~89–110
PONs, so this is ~100 manual download/extract cycles per zone.

He wants **one button** that downloads an entire zone's photos as a single ZIP,
already laid out `Zone → PON → Pole` — the *same* per-pole structure the
existing per-PON download produces, just wrapped in a zone level and covering
every PON at once.

## Measured scale (Tonga, Zone 1)

| Metric | Value |
|--------|-------|
| PONs | 89 (with QA photos) |
| Poles | 1,354 (1,290 approved) |
| Photo keys (approved) | ~18,186 |
| Files on disk | ~12,615 (`tonga/…` → `/home/velo/storage/qa-photos/`) |
| Total size | **≈ 4.5 GB** |
| Avg photo | ~250–350 KB JPEG |

**Implication:** the existing `pon-zip.ts` buffers the whole ZIP in memory
(`JSZip … generateAsync({ type: 'nodebuffer' })`) and fetches every photo with
`Promise.all`. That is fine for one PON but would OOM the shared Velo box (which
also runs production) for a 4.5 GB / ~12.6k-file zone. The zone endpoint must
**stream**.

## Chosen approach — live streaming ZIP

(Decision: Hein, 2026-07-06. Alternatives considered: "prepare-then-resumable-link"
and "push straight to SharePoint" — both deferred as heavier later phases.)

A dedicated streaming endpoint that pipes a ZIP straight to the browser as it is
built, keeping server memory flat. Accepted tradeoff: a single ~4.5 GB browser
download with **no resume** if the connection drops; if that proves flaky in
practice we upgrade to prepare-then-link later.

### Components

**1. `src/modules/works-qa/utils/zip-entries.ts` (new) — layout single source of truth**

A pure function that maps one `pole_qa_photos` row to its in-ZIP entries:

```ts
interface ZipEntry { path: string; storageKey: string; }
function poleToZipEntries(pole: PoleQaPhoto, prefix: string): ZipEntry[]
```

Reproduces the existing per-PON layout exactly (reusing `SLOT_META` and the
`slotFilename` / `photoUrl` conventions from `pon-zip.ts`):

- civil slots → `{prefix}/{pole_label}/civil/{NN}_{label}.jpg`
- dome + main_joint slots → `{prefix}/{pole_label}/optical/{NN}_{label}.jpg`
- tray keys → `{prefix}/{pole_label}/optical/tray_{NN}.jpg`
- unassigned keys → `{prefix}/{pole_label}/unassigned/photo_{NN}.jpg`

`prefix` = `Zone_{zone}/PON_{pon}` for the zone endpoint (and would be `PON_{pon}`
for the per-PON one). Result: `Zone_1/PON_5/LAW.P.A123/civil/07_after_photo.jpg`.

**2. `pages/api/works-qa/zone-zip.ts` (new) — streaming endpoint**

- Params: `project_id` (req, uuid), `zone_no` (req, int), `include_unapproved`
  (opt, default false) — mirrors `pon-zip`.
- Query: `SELECT * FROM pole_qa_photos WHERE project_id=$1::uuid AND zone_no=$2
  [AND approved_at IS NOT NULL] ORDER BY pon_no, pole_label`. ~1,354 rows; the
  existing `(project_id)` index is sufficient — **no migration / new index**.
- Build with **`archiver`** (new dep) in streaming mode, **`store` (no
  compression)** — photos are already-compressed JPEG, so DEFLATE burns CPU for
  ~0 gain. `archive.pipe(res)`.
- Fetch each photo via the **same proven loopback proxy** `pon-zip` uses
  (`http://127.0.0.1:${PORT}` + forwarded cookie + `?vlm=true`), but with
  **bounded concurrency (~6–8 in-flight)** instead of `Promise.all`-everything;
  append each to the archive as it resolves. Rely on archiver + `res`
  backpressure to keep memory flat.
- **Missing photos are skipped, not fatal** (disk has ~12.6k files vs ~18k keys;
  one 404 must not abort a 4.5 GB build). Skips counted and logged; a
  `_manifest.txt` at the ZIP root lists skipped keys.
- Streaming headers set **before** piping: `Content-Type: application/zip`,
  `Content-Disposition: attachment; filename="works-qa-{project}-Zone_{n}.zip"`,
  `X-Accel-Buffering: no` (stop nginx buffering 4.5 GB). Chunked (no
  `Content-Length`).
- `export const config = { api: { responseLimit: false, externalResolver: true } }`
  so Next.js does not cap/limit the large streamed response.
- Error handling: validate + run the DB query **before** streaming starts (so a
  bad request still returns JSON via `apiResponse`). Once bytes are flowing, on
  error `archive.abort()` + `res.destroy()` and log — cannot send a JSON error
  mid-stream.
- Auth: `withAuth(withPermission('construction-qa.works-qa.export','view')(handler))`
  — identical gate to `pon-zip`.

**3. `src/modules/works-qa/components/WorksQAPageHeader.tsx` — UI**

`zoneNo` / `ponNo` are already props. Add a zone ZIP link shown when **a zone is
selected but no specific PON** (`zoneNo !== null && ponNo === null`), mirroring
the two existing PON links:

- primary: `Download zone ZIP` → `/api/works-qa/zone-zip?project_id=…&zone_no=…`
- secondary: `+ in-progress` → same URL with `&include_unapproved=true`

Plain `<a download>` (browser streams natively, shows its own progress). Add a
`title` hint that a whole zone can be several GB and the tab must stay open.

### Deliberately NOT doing

- **Not modifying `pon-zip.ts`.** It works and is tested; per FibreFlow's
  surgical-changes rule we leave the production per-PON path alone. Cost: the
  per-pole layout logic lives in two places (pon-zip inline + `zip-entries.ts`).
  Guard: `zip-entries.test.ts` pins the produced paths to the known structure,
  so the two cannot silently drift. DRY-ing pon-zip onto the shared helper is a
  possible follow-up PR, out of scope here.
- No `zone_no` DB index (query is already project-scoped and tiny).
- No background job / resumable link / SharePoint push (deferred phases).

## Testing

- `zip-entries.test.ts` (new, TDD): `poleToZipEntries` produces the exact paths
  `Zone_1/PON_999/TEST.P.A001/civil/07_after_photo.jpg`,
  `…/optical/tray_01.jpg`, `…/unassigned/photo_01.jpg`; omits `unassigned/` when
  no unassigned keys.
- `zone-zip` endpoint test (mock `pool` + `fetch`, `node-mocks-http`, following
  `pon-zip-unassigned.test.ts`): asserts the streamed archive contains
  `Zone_{z}/PON_{n}/{pole}/…` entries, drops the `approved_at` filter on
  `include_unapproved=true`, skips a 404 photo without aborting, and 404s when
  the zone has no matching poles.
- Existing `pon-zip-unassigned.test.ts` must stay green (untouched code).
- Manual verification on dev against Tonga Zone 1: download the ZIP, `unzip -l`
  to confirm the `Zone_1/PON_*/…` tree and a sane size; watch the app process
  **RSS stays flat** during the full-zone stream (proves no OOM). Evidence
  captured before claiming done.

## Success criteria

1. Zone ZIP button appears for export-permitted users when a zone (no PON) is selected.
2. Click yields a valid `.zip` with `Zone_{z}/PON_{n}/{pole}/civil|optical|unassigned/…`
   matching the per-PON structure.
3. Server RSS stays flat on a full-zone (~4.5 GB) run — no OOM.
4. Missing photos are skipped and listed in `_manifest.txt`; the ZIP completes.
5. `npm run ci:quick` green; `pon-zip` test still passes.

## New dependency

`archiver` + `@types/archiver`. Node has no native streaming-ZIP and `jszip`
cannot stream 4.5 GB. (`yazl` is a lighter alternative if a smaller dep is
preferred — flagged for Hein.)
