# Stores PWA — photo→serial fallback, non-serial issue path, Gizzu scan fix

**Date:** 2026-06-11
**Status:** Approved by Hein (design review 2026-06-11)
**Module:** `src/modules/field-stock-pwa/` (`/my/stores`, `withMySession` tier)
**Builds on:** PRs #1919/#1920 (stores `/my` auth migration), #1923 (DataMatrix), #1927 (ISO 15434 serial extraction)

## Problem

The `/my/stores` issue flow only handles serial-tracked items via live barcode
scanning. Three gaps:

1. **Scan failures dead-end into typing.** When the live scanner can't decode a
   label, the only fallback is manually typing the serial — error-prone on
   18-char serials.
2. **Non-serial stock can't be issued at all.** `PickItemStep` filters to
   `tracking_type='serial'` (28 items). The 204 `lot` + 59 `quantity` items —
   all the real consumables: cable, clips, screws, splice protectors, cable
   ties — have no issue path in the PWA.
3. **Gizzu (FT-GIZZU, 23,159 in_stock units) won't scan.** Diagnosed
   2026-06-11: the label is a dense Code 128 encoding the plain 18-char serial
   (`GU18W12V25` + 8 digits). `CODE_128` is already enabled; the failure is
   optical — `html5-qrcode`'s live-video decode (low-res frames, square scan
   box, no try-harder pass) can't resolve a dense 1D symbol on a ~3 cm sticker.
   Evidence: both `zbar` and `zxing-wasm` (`tryHarder`) decoded a close-up
   still photo of the same label instantly, and the decoded serials exist as
   `in_stock` FT-GIZZU rows in `stock_serials`.

## Design overview

Three features, one worktree, two PRs:

- **PR A — non-serial issue path** (qty + required photo proof) + the
  `stock_pickings` migration.
- **PR B — photo→serial fallback** (server-side barcode decode → VLM →
  pre-filled manual entry) + live-scanner tuning for dense 1D (Gizzu).

Fallback order for serial items: (1) live barcode scan, (2) photo →
server-side extract, (3) manual typing. Hein's principle: assets should in
most cases have a serial; consumables take the quantity path.

---

## Feature 1 — Photo→serial fallback

### Endpoint

`POST /api/my/stores/serials/extract` — `withMySession` + `requireStoresActor`
(from `src/modules/field-stock-pwa/lib/storesActor.ts`). Multipart upload,
field `photo`, max 8 MB, JPEG/PNG/HEIC/WebP (same envelope as
`/api/my/receipts/extract`, which is the structural precedent).

### Server pipeline

1. **Resize** with `sharp` to fit 1024×768, JPEG q85 (canonical VLM prep from
   `.claude/modules/vlm.md`).
2. **Barcode pass first:** `zxing-wasm` `readBarcodes` with
   `tryHarder/tryRotate/tryInvert` on the still (run on the *original*
   resolution image, not the resized one — density matters). If a decode is
   found, run it through `extractScannedSerial()`
   (`src/modules/field-stock-pwa/lib/scannedSerial.ts`) to unwrap ISO 15434
   envelopes; return `{ serial, method: 'barcode', confidence: 1 }`.
   Proven against the real Gizzu label photo (Code128 → full serial) and the
   Nokia DataMatrix envelope.
3. **VLM pass** only if no barcode decode: one call to Qwen3-VL
   (`VLM_CHAT_ENDPOINT` on `100.96.203.105:8100`, existing `vlmClient`
   pattern, `VLM_MAX_TOKENS_OCR`, temperature 0.1) with a stores-specific
   prompt covering both known serial families:
   - ONT: `ALCLB4` + 6 hex chars, exactly 12 (reuse rejection rules from
     `ONT_SERIAL_BACK_PROMPT` — no SSID/MAC/part numbers, hallucination guard
     via `isPromptExampleSerial`-style known-example rejection).
   - Gizzu/UPS: `GU18W12V25` + 8 digits, exactly 18.
   - Generic fallback: value following an `S/N:` label.
   Return `{ serial, method: 'vlm', confidence }` or
   `{ serial: null, method: 'none' }`.
4. **Store the photo** to VF Storage (`:8091`) under
   `stores/serial-scans/{timestamp}-{uuid}.jpg` regardless of outcome, and
   return the storage path. Failed extractions stay diagnosable and become
   VLM training material. No DB table in v1 — the storage path is returned to
   the client and logged via `@/lib/logger`; a corrections feedback loop
   (`recordVlmCorrection`) is explicitly out of scope for v1.

### Client

In `ScanSerialsStep`, alongside the existing "Type serial instead"
disclosure, add **"Take a photo instead"**:

- Live camera capture only (`capture="environment"`, per
  `feedback_camera_only_pwa`) with client-side compression before upload
  (reuse the receipts `compressImage` approach, but keep ≥1280 px so barcode
  density survives).
- On response, **pre-fill the manual-entry field** with the extracted serial
  and focus it — the user verifies/edits, then submits through the existing
  `handleRawSerial` → `validateSerial` funnel unchanged. Never auto-add the
  serial without user confirmation.
- On `method: 'none'`, show "Couldn't read the label — type the serial" and
  open the manual field.

### Error handling

- VLM timeout/unreachable (30 s real-time budget): degrade to manual entry
  with a toast; the barcode pass already ran, so most labels still resolve.
- Photo too blurry / no serial found: same degrade path. No retry loops.

---

## Feature 2 — Non-serial issue path (qty + photo proof)

### Item listing

`/api/my/stores/items` (and `PickItemStep`) stop filtering to
`trackingType=serial`. Return all issuable tracking types with the
`tracking_type` in the payload; render a small badge (Serial / Qty) per row.
Both `lot` and `quantity` items take the quantity path (`none` items too —
treat as quantity). Zero-on-hand handling keeps whatever the items endpoint
does today (verify during planning; do not change it in this work).

### Flow branch

`IssueOrchestrator` step 4 branches on the picked item's `tracking_type`:

- `serial` → `ScanSerialsStep` (unchanged).
- anything else → new **`EnterQuantityStep`**: numeric quantity input with
  uom label, on-hand quantity shown, reuse of the existing R-value cap guard
  (`stockValueGuard` — qty × `unitValueZar` against the cap, same
  warn/server-enforce split as serials).
- **No lot selection in v1.** Storemen don't know lot numbers; the picking
  line records `lot_number = null` and quantity only. (Server-side lot
  allocation is a later concern; `stock_picking_lines` is near-empty so
  nothing depends on it yet.)

### Photo proof — required, one per picking

Decision (Hein, 2026-06-11): photo proof is **mandatory for non-serial
pickings**, one photo per picking (the flow is single-item-per-picking, so
this is also one per item). Serial pickings stay photo-free — the serial is
the evidence.

- Captured in `SignAndSubmitStep` when the item is non-serial: a camera
  capture block above the signature pad (live camera only). Submit stays
  disabled until both photo and signature exist.
- Upload-first sequencing: `POST /api/my/stores/pickings/upload-proof`
  (`withMySession` + `requireStoresActor`, multipart) uploads to VF Storage
  under `stores/picking-proof/{timestamp}-{uuid}.jpg` and returns
  `{ photoKey, photoUrl }`; the subsequent picking create includes them.
- Server enforcement: `pickings/_create.ts` rejects (400) a picking whose
  lines are non-serial when `proofPhotoKey` is absent. Serial pickings ignore
  the fields.
- **Offline (decided during planning):** non-serial issues are blocked
  offline in v1 — the proof photo must upload before the picking exists, so
  `SignAndSubmitStep` shows an inline "needs a connection" error instead of
  enqueueing to the IndexedDB queue. Serial issues keep the offline queue
  unchanged.

### Migration

Add to `stock_pickings` (fleet's `*_photo_key`/`*_photo_url` pattern):

```sql
ALTER TABLE stock_pickings
  ADD COLUMN proof_photo_key text,
  ADD COLUMN proof_photo_url text;
```

`scripts/migrations/sql/`, version = MAX(DB max, ls max)+1 at implementation
time. No backfill (table near-empty; existing rows are serial pickings).

### Backend verification task (must be in the plan)

`pickings/_create.ts` already accepts non-serial lines (`plannedQuantity`,
null `serialIds`). What is *unverified* is the confirm/process path:
`confirmPicking`/`processPicking` must correctly handle quantity/lot lines —
decrement `stock_quants` (or whatever the existing quantity-line handling
does) without touching `stock_serials`. The implementation plan must include
a task that reads and exercises this path (unit test with a quantity line)
before UI work lands on it.

---

## Feature 3 — Gizzu / dense-1D live-scan tuning

Config-level changes to `useBarcodeScanner` (`src/modules/barcode-scanner/`)
as used by `ScanSerialsStep`:

1. Enable `html5-qrcode`'s `useBarCodeDetectorIfSupported: true` — on Android
   Chrome this delegates to the native `BarcodeDetector`, which is
   substantially better at dense Code 128 than the zxing-js fallback.
2. Replace the square scan box with a **wide rectangular `qrbox`**
   (e.g. ~80% width × ~30% height) suited to 1D labels; DataMatrix/QR still
   fit inside it.
3. Request higher-resolution video frames via `videoConstraints`
   (e.g. `width: { ideal: 1920 }`) so the dense bars resolve.
4. UI hint in the scanner overlay: "Hold barcodes horizontally, fill the box".

Acceptance: a physical Gizzu label decodes in the live scanner on a mid-range
Android phone; if it still fails in the field, the feature-1 photo fallback
is the guaranteed path (proven against the real label photo).

No changes to `extractScannedSerial` — plain Code 128 text passes through the
ISO 15434 parser untouched (covered by existing unit tests in #1927).

---

## Out of scope (v1)

- VLM corrections feedback loop (`recordVlmCorrection`) for stores scans.
- Lot selection / server-side lot allocation for lot-tracked issues.
- Photo proof on serial pickings or returns.
- Multi-item pickings (flow stays single-item).
- Backfilling proof photos for historical pickings.

## Testing

- **Unit:** extract endpoint pipeline (barcode-hit short-circuits VLM; VLM
  response parsing; serial-pattern validation; reject non-serial picking
  without proof photo in `_create`); `EnterQuantityStep` value-cap guard;
  orchestrator branch on `tracking_type`.
- **Integration:** quantity-line picking through create→confirm→process
  against a dev DB (verifies the unproven backend path).
- **Field/browser:** Playwright or Claude-in-Chrome against dev for the two
  new UI branches; physical-device check for the Gizzu live scan (Hein or a
  storeman, real label).
- Decoder evidence already captured: `zxing-wasm` `tryHarder` decodes the
  real Gizzu label still (`Code128: GU18W12V2512041619`) and the Nokia
  ISO 15434 DataMatrix.

## Rollout

- PR A (non-serial path + migration) and PR B (extract endpoint + scanner
  tuning) off this worktree's branch, blind-reviewed per the standing rule,
  deployed to dev first.
- Dev verification with the storeman flow before any prod promote
  (after-hours, Hein's approval, `bash scripts/deploy-local.sh production`).
- Independent of this work: scanner fixes #1923/#1927 still need their prod
  promote (`fdc72a040` → `origin/master`).
