# Works QA Dashboard — Design Spec
**Date:** 2026-05-12  
**PRD:** PRD-063 Pole Photo QA Dashboard  
**Feature branch:** `feat/works-qa-dashboard`  
**Status:** Design approved, ready for implementation planning

---

## 1. Context

Johan Scott manually cross-references 4–5 sources (QField civil, QField optical, multiple SharePoint folders) to verify civil + optical photos per pole per PON. This dashboard consolidates everything into FibreFlow: browse PONs, see all poles, upload/assign photos per slot, VLM validates, Johan approves per pole, download FiberTime-ready ZIP.

---

## 2. Architecture Decision

**Approach: New `works-qa` module, independent of `construction-qa`.**

The existing `construction-qa` module uses a different step schema (booleans, different discipline names) and a wizard UX that does not fit Johan's sweep workflow. A new module gives a clean schema and purpose-built UX.

**Reused infrastructure:**
- `vlmConstructionService` — VLM photo validation
- `qa_correction_examples` table — correction-based learning
- VF Storage — photo storage (`works-qa/{project_id}/{pole_label}/{discipline}/`)
- `qfield_photo_validations` — QField photo source
- `sharepointSyncService` — SharePoint photo source
- `jszip` — ZIP generation (already used in export routes)

---

## 3. Data Model

### New table: `pole_qa_photos`

One row per pole per project.

```sql
CREATE TABLE pole_qa_photos (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pole_label                TEXT NOT NULL,        -- e.g. "A673"
  zone_no                   INTEGER,
  pon_no                    INTEGER,

  -- Civil photo keys (7 slots, matching CIVIL_CHECKLIST steps 1–7)
  civil_step_01_key         TEXT,   -- Before Photo
  civil_step_02_key         TEXT,   -- During Photo
  civil_step_03_key         TEXT,   -- Depth Photo
  civil_step_04_key         TEXT,   -- End Plates
  civil_step_05_key         TEXT,   -- Compaction / Backfill
  civil_step_06_key         TEXT,   -- Level Check
  civil_step_07_key         TEXT,   -- After Photo

  -- Optical Dome photo keys (8 slots, matching OPTICAL_DOME_CHECKLIST steps 1–8)
  optical_dome_01_key       TEXT,   -- Dome on Pole
  optical_dome_02_key       TEXT,   -- Dome Label
  optical_dome_03_key       TEXT,   -- Open Dome
  optical_dome_04_key       TEXT,   -- Splice Protectors
  optical_dome_05_key       TEXT,   -- Slack Management
  optical_dome_06_key       TEXT,   -- Strength Members
  optical_dome_07_key       TEXT,   -- Seals & Dust Caps
  optical_dome_08_key       TEXT,   -- Pole ID

  -- Optical Joint photo keys (6 slots, matching OPTICAL_JOINT_CHECKLIST steps 11–16)
  optical_joint_11_key      TEXT,   -- Cable Entries
  optical_joint_12_key      TEXT,   -- Strength Members
  optical_joint_13_key      TEXT,   -- Tube Routing
  optical_joint_14_key      TEXT,   -- Tray Entries
  optical_joint_15_key      TEXT,   -- Coiling & Protectors
  optical_joint_16_key      TEXT,   -- Readable Labels

  -- Variable tray photos (flat bucket; QField assigns step numbers, manual upload adds freely)
  optical_joint_tray_keys   TEXT[]  DEFAULT '{}',

  -- VLM results per slot: { "civil_01": { valid, confidence, feedback }, ... }
  vlm_results               JSONB   DEFAULT '{}',

  -- Approval state (set when all slots filled + all VLM gates pass or overridden)
  civil_approved            BOOLEAN DEFAULT FALSE,
  dome_approved             BOOLEAN DEFAULT FALSE,
  joint_approved            BOOLEAN DEFAULT FALSE,
  approved_by               TEXT,
  approved_at               TIMESTAMPTZ,

  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (project_id, pole_label)
);

CREATE INDEX idx_pole_qa_photos_project    ON pole_qa_photos(project_id);
CREATE INDEX idx_pole_qa_photos_pon        ON pole_qa_photos(project_id, pon_no);
CREATE INDEX idx_pole_qa_photos_approved   ON pole_qa_photos(project_id, approved_at) WHERE approved_at IS NOT NULL;
```

---

## 4. API Routes

All under `pages/api/works-qa/` — flat routes only, no nested dynamic params (project convention).

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/works-qa/poles` | List poles for a PON (`?project_id&pon_no`) with slot counts + status |
| GET | `/works-qa/pole-detail` | Single pole detail (`?pole_id`) — photo keys, VLM results |
| POST | `/works-qa/pole-assign` | `{pole_id, slot, photo_key, source}` → assign + trigger VLM |
| POST | `/works-qa/pole-override` | `{pole_id, slot, decision, reason}` → override VLM + write correction |
| POST | `/works-qa/pole-approve` | `{pole_id}` → lock pole if all gates pass |
| GET | `/works-qa/pon-zip` | Stream ZIP of approved poles (`?project_id&pon_no`) |
| POST | `/works-qa/sync-qfield` | `{project_id, pole_label?}` → pull `qfield_photo_validations` into slots |

All routes use `apiResponse` helper (`@/lib/apiResponse`).

---

## 5. VLM Integration

**Trigger:** `POST /works-qa/poles/[id]/assign`

```
1. Upload photo to VF Storage: works-qa/{project_id}/{pole_label}/{civil|optical}/
2. Call vlmConstructionService(photo_key, step_label, discipline)
3. Store result: UPDATE pole_qa_photos SET vlm_results = vlm_results || '{slot_key: {valid, confidence, feedback}}'
4. Return slot state to client (valid/invalid + feedback)
```

**Override flow:**
```
POST /works-qa/poles/[id]/override {slot, decision: 'pass'|'fail', reason}
→ INSERT INTO qa_correction_examples (step_label, photo_key, vlm_decision, human_decision, source='works_qa')
→ Mark slot as overridden in vlm_results: {valid: true, overridden_by: user, override_reason: reason}
```

**Approve gate (server-side enforced):**  
All 21 fixed slots must have a `photo_key` AND `vlm_results[slot].valid === true` (or `overridden_by` set). Tray array must have ≥ 1 entry. If any gate fails, `approve` returns 422 with which slots are blocking.

---

## 6. UI Structure

### Navigation
`Field Operations → Works QA` (new tab in existing `ModuleNav`)

### Page hierarchy
```
/field-ops/works-qa
  → PON selector (project → zone → PON dropdowns)
  → Pole List (dense table — Option A chosen)
  → Pole Detail (right slide-in panel — Option B stacked chosen)
```

### Pole List (dense table)
Each row: `Pole Label | Civil pixel-strip (7 cells) | Dome pixel-strip (8 cells) | Joint pixel-strip (6 cells + tray count) | Status badge`

Cell colours:
- Empty: `#1f2937`
- Filled + VLM pass: `#22c55e33` (green)
- Filled + VLM fail: `#ef444444` (red)
- Filled + overridden: `#f59e0b33` (amber)
- Approved: full green row tint + `Approved ✓` badge

### Pole Detail Panel (slide-in, stacked sections)
Three sections stacked:
1. **Civil** — 7 slot cards, each showing thumbnail + step label + VLM badge + Override button if failed
2. **Optical Dome** — 8 slot cards (same pattern)
3. **Optical Joint** — 6 slot cards + tray flat bucket (drag-drop or file picker, QField tray photos auto-assigned)

Footer: **Approve Pole** button (enabled when all gates pass), **Download ZIP** link (only if approved).

---

## 7. ZIP Download

Built server-side in `/works-qa/pon-zip`:
- Query all approved `pole_qa_photos` for the PON
- Fetch each photo from VF Storage (proxy via existing storage route)
- Assemble with `jszip`:

```
{PON_NO}/
  {POLE_LABEL}/
    civil/
      01_before.jpg … 07_after.jpg
    optical/
      01_dome_on_pole.jpg … 08_pole_id.jpg
      11_cable_entries.jpg … 16_readable_labels.jpg
      tray_01.jpg … tray_N.jpg
```
- Stream response as `application/zip` with `Content-Disposition: attachment`

---

## 8. Module Structure

```
src/modules/works-qa/
  components/
    PoleListTable.tsx          — dense table with pixel progress strips
    PoleDetailPanel.tsx        — slide-in panel (stacked sections)
    PhotoSlotCard.tsx          — individual slot: thumbnail, VLM badge, override button
    TrayBucket.tsx             — flat drag-drop zone for tray photos
    ApprovePoleButton.tsx      — gate-enforced approve with blockers list
  hooks/
    usePoleList.ts             — SWR for /works-qa/poles
    usePoleDetail.ts           — SWR for /works-qa/poles/[id]
  types/
    works-qa.types.ts          — PoleQaPhoto, SlotKey, VlmSlotResult, SlotStatus
  utils/
    slot-keys.ts               — SLOT_KEYS constant (ordered array of all 21 fixed slots)
    approval-gates.ts          — allGatesPass(pole: PoleQaPhoto): {pass: boolean, blocking: SlotKey[]}
pages/api/works-qa/
  poles.ts           — GET pole list
  pole-detail.ts     — GET single pole
  pole-assign.ts     — POST assign photo → VLM
  pole-override.ts   — POST override VLM → correction
  pole-approve.ts    — POST approve pole
  pon-zip.ts         — GET stream ZIP
  sync-qfield.ts     — POST sync from QField
scripts/migrations/
  246_pole_qa_photos.sql
```

---

## 9. Constraints

- **No QField sync-back.** Feature flag stays off — writes to `pole_qa_photos` only.
- **VLM on all photo assignments.** QField photos synced via `sync-qfield` re-use their existing `qfield_photo_validations` result (stored in `vlm_results` at sync time). Manually uploaded photos always trigger a fresh VLM call.
- **Single DB** — dev and production share schema; migration runs immediately on both.
- **Files < 300 lines, components < 200 lines** per project rules.

---

## 10. Open Questions (resolved)

| Q | Answer |
|---|--------|
| Optical slot count | Dome 8 + Joint 6 (all used); trays are variable additional |
| Tray photo structure | Flat bucket for manual; QField assigns step numbers automatically |
| Photo source priority | QField primary → SharePoint secondary → manual upload |
| Approval meaning | All slots filled + all VLM gates pass (or Johan override) |
| Panel layout | Stacked sections (Civil / Dome / Joint) |
| Pole list layout | Dense table with pixel progress strips |
