# SiteCam Enhancements — Design Spec
**Date:** 2026-06-08  
**Branch:** feat/sitecam-serial-appeals  
**Scope:** Three additions to the SiteCam PWA and FibreFlow activations module

---

## Context

SiteCam (`/my/sitecam`) is the field technician's PWA for capturing installation photos across 12 activation steps and 8 civil steps. This spec adds three capabilities:

1. **Serial barcode scanning** — ONT and UPS serials scanned on-device, saved to FibreFlow, cross-referenced async against 1Map + OES
2. **SiteCam photos tab on activations page** — QA staff can view all SiteCam photos with serial scan status for a DR inside FibreFlow
3. **Step appeal system** — technicians can dispute a rejected step; appeals route to a WhatsApp approval group and an in-app FibreFlow queue

---

## Change 1 — Serial Barcode Scanning

### Problem

When a technician installs an ONT and UPS, there is currently no on-site record that captures which physical device was installed at which DR. Cross-referencing happens later in FibreFlow and 1Map, but the barcode data is not captured in the field.

### Affected Steps

| Step | Device | Scan required |
|------|--------|---------------|
| Step 6 — ONT Back After Install | ONT (Nokia) | ONT serial barcode |
| Step 8 — Final Installation | UPS (Gizzu) | UPS serial barcode |

### Serial Format Rules

Device serials follow known manufacturer prefixes:

| Device | Prefix | Example |
|--------|--------|---------|
| ONT (Nokia) | `ALCL` | `ALCLB4ABC123` |
| UPS (Gizzu) | `GU` | `GU18WXXXXXX` |

At scan time, the PWA validates only the **format** (correct prefix). A scan that doesn't match the expected prefix is rejected immediately so the technician can try again — it almost certainly means a wrong barcode was scanned (e.g. scanned a box label instead of the device label).

### Verification Flow

There is no expected serial to compare against at scan time. Verification is a three-stage async process:

```
Stage 1 — Field capture (PWA, at install time)
  → Tech takes photo
  → Tech scans barcode
  → PWA validates prefix format (ALCL / GU)
  → Valid prefix: serial saved to dr_photo_unified_reviews, status = 'pending'
  → Step proceeds immediately (tech's job is done)

Stage 2 — 1Map cross-reference (FibreFlow background, when 1Map data is live)
  → FibreFlow compares saved serial against 1Map ONT/UPS serial for this DR
  → Match: status → 'cross_ref_1map_pass'
  → Mismatch: status → 'cross_ref_1map_fail'

Stage 3 — OES cross-reference (FibreFlow background, when OES report is processed)
  → FibreFlow compares saved serial against OES report for this DR
  → Both Stage 2 AND Stage 3 pass → ont_serial_status / ups_serial_status = 'pass'
  → Any mismatch → status = 'fail', QA team notified, appeal process can be initiated
```

**At scan time (PWA), the only failure mode is invalid format.** There is no 3-strike locking at scan time. The appeal system is triggered from FibreFlow when an async cross-reference returns `fail`.

### PWA UI Changes

**Step 6 and Step 8** get an additional sub-step after photo upload:

```
[Photo uploaded ✓]

Scan ONT Serial (starts with ALCL)
──────────────────────────────────
                         [Scan Barcode]
```

On valid format:
```
✓ Serial saved — ALCLB4XXXXXX
  Cross-reference pending (1Map + OES)
[Next Step →]
```

On invalid format (wrong prefix):
```
✗ Invalid format — ONT serials start with ALCL
  Scanned: GU18WXXXXXX
[Try Again]
```

### DB Status Values

`ont_serial_status` / `ups_serial_status` on `dr_photo_unified_reviews`:

| Value | Meaning |
|-------|---------|
| `NULL` | Not yet scanned |
| `'pending'` | Scanned in field, awaiting cross-reference |
| `'pass'` | Cross-referenced against both 1Map and OES — match |
| `'fail'` | Cross-referenced — mismatch on 1Map or OES |

### API Changes

**`GET /api/sitecam/site/[id]`** — unchanged (no serial fields needed at scan time)

**New: `POST /api/my/sitecam/verify-serial`**

```typescript
// Request
{
  drNumber: string,
  step: number,            // 6 = ONT, 8 = UPS
  scannedSerial: string,
  attemptNumber: number    // 1+ (counts invalid-format retries)
}

// Response — valid format
{
  result: 'saved',
  serial: string,          // the normalised serial that was saved
  message: 'Serial saved — cross-reference pending'
}

// Response — invalid format
{
  result: 'invalid_format',
  message: 'ONT serials must start with ALCL'
}
```

**New: `POST /api/activate/serials/cross-reference`** (called by 1Map/OES integration, future)

```typescript
{
  drNumber: string,
  device: 'ont' | 'ups',
  source: '1map' | 'oes',
  expectedSerial: string
}
```

This endpoint is stubbed in this PR as a no-op skeleton; the actual cross-reference logic is a separate sprint.

### Database Changes

SiteCam photos are stored on `dr_photo_unified_reviews`. Serial scan tracking columns are added to the same table. `ont_serial_scanned` and `ups_serial_scanned` already exist (migration 364/365). We add attempt counters and status:

```sql
ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN ont_serial_attempts  smallint NOT NULL DEFAULT 0,
  ADD COLUMN ont_serial_status    text CHECK (ont_serial_status IN ('pending','pass','fail','locked')),
  ADD COLUMN ups_serial_attempts  smallint NOT NULL DEFAULT 0,
  ADD COLUMN ups_serial_status    text CHECK (ups_serial_status IN ('pending','pass','fail','locked'));
```

Note: `'locked'` is reserved in the check constraint for future use but not used in this sprint (no scan-time locking).

---

## Change 2 — SiteCam Photos Tab on Activations Page

### Existing Foundation

`PwaComparisonTab.tsx` already exists at `src/modules/activate/components/PwaComparisonTab.tsx` and is wired into `UnifiedReviewCard.tsx` as the `'pwa'` tab. It renders a grid of step thumbnails from `dr_photo_unified_reviews.pwa_photo_urls`.

**What already works:** step grid, thumbnails, submitted-at timestamp, tech name.  
**What is missing:** serial scan status, power meter reading.

### Solution

Enhance `PwaComparisonTab` to surface serial scan status (pending/pass/fail) and VLM power meter data. No new tab needed.

### UI Layout (per-step tile)

```
Step 6 — ONT Back After Install     [thumbnail]
  Serial: ALCLB4XXXXXX  ⏳ pending
  
Step 7 — Power Meter                [thumbnail]
  -21.3 dBm ✓

Step 8 — Final Installation         [thumbnail]
  Serial: GU18WXXXXXX   ⏳ pending
```

---

## Change 3 — Step Appeal System

### Architecture

```
PWA (SiteCam) — when VLM rejects a photo OR serial cross-ref fails
  └─ Appeal form (text + photo) → POST /api/my/sitecam/appeal

Backend
  └─ Write to sitecam_appeals table
  └─ Send WA message to approval group (Go Bridge via SITECAM_APPEAL_GROUP_JID)
  └─ Appeal appears in FibreFlow /activate/sitecam-appeals queue

Approver action (either channel)
  └─ Approve → step unlocked in PWA, appeal marked resolved
  └─ Deny    → step stays locked, tech notified via PWA next refresh
```

### PWA

An **Appeal** button appears on any step that has failed (photo VLM) or been escalated. It is also available to be triggered from FibreFlow when a serial cross-reference returns `fail`.

### Decision Effect

On **Approve**:
- `sitecam_appeals.status` → `'approved'`
- Step unlocked

On **Deny**:
- `sitecam_appeals.status` → `'denied'`
- Tech sees denial reason on next PWA refresh

### Database

```sql
CREATE TABLE sitecam_appeals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dr_number       text NOT NULL,
  step_number     smallint NOT NULL,
  technician_id   uuid NOT NULL REFERENCES users(id),
  appeal_text     text NOT NULL,
  photo_url       text NOT NULL,
  serial_scanned  text,
  serial_expected text,
  attempt_number  smallint NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','denied')),
  decided_by      uuid REFERENCES users(id),
  decided_via     text CHECK (decided_via IN ('whatsapp','in_app')),
  decided_at      timestamptz,
  denial_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

---

## Implementation Order

1. **Phase A — Foundation:** Migration 402 + site API helpers test
2. **Phase B — PWA serial scan:** Format validation logic + scan sub-step UI + hook wiring
3. **Phase C — Appeal system:** Appeal API endpoints + AppealModal + SiteCamWizard wiring + FibreFlow queue page
4. **Phase D — PwaComparisonTab:** Extend submission API + serial status badges + power meter

---

## Out of Scope

- Async cross-reference against 1Map or OES (separate sprint — serial cross-reference endpoint stubbed only)
- Civil steps serial verification (civils do not install ONT/UPS)
- Bulk appeal management
- WhatsApp group JID provisioning (ops task)
