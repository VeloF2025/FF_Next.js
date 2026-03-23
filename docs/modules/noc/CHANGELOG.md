# NOC Module — CHANGELOG

---

## 2026-03-13 — DevOps Ticket Support: VLM-Powered Bug Reports + Security Hardening

### Summary

Three commits delivered **DevOps ticket type** with AI-powered screenshot analysis:

1. **Commit** [`907e711`](https://github.com/FibreFlow/fibreflow/commit/907e711dddcad06fbc15624b48bed20bb2bc0d84) — Added DEV_OPS ticket type with form sections and database schema
2. **Commit** [`4da9f65`](https://github.com/FibreFlow/fibreflow/commit/4da9f65100bf1b0cdbb47aa95640d65f2f7bb28c) — Implemented VLM + Whisper pipeline for screenshot/video/audio analysis
3. **Commit** [`e1dc7cb`](https://github.com/FibreFlow/fibreflow/commit/e1dc7cbbbb57e7c20213ffd922d0af4760444cba) — Added auth to DevOps API routes + refactored uploader

**Size**: 1,238 lines added across 11 files | **Authors**: Claude Sonnet 4.5, Claude Opus 4.6

---

### DevOps Ticket Type (Feature)

**What it solves**: DevOps/dev issues (bugs, errors, crashes) in FibreFlow needed a first-class ticket type separate from field operations. Classic tickets (new_installation, fault_repair) assume physical work. DevOps tickets are for application issues requiring code fixes.

**New enum values**:
```typescript
enum TicketType {
  DEV_OPS = 'dev_ops' // FibreFlow application bug/error/feature
}

enum TicketSource {
  DEV_OPS = 'dev_ops' // FibreFlow application issues
}
```

**Evidence** (Commit 907e711):
```diff
 const VALID_SOURCES: TicketSource[] = [
   TicketSource.ONT_SWAP,
   TicketSource.MANUAL,
   TicketSource.PP_DATA,
+  TicketSource.DEV_OPS,
 ];

 const VALID_TYPES: TicketType[] = [
   TicketType.OLT_INVESTIGATION,
   TicketType.HSE_INCIDENT,
   TicketType.HSE_NEAR_MISS,
+  TicketType.DEV_OPS,
 ];
```

---

### Type-Aware Form Sections

Each ticket type now shows/hides form sections based on workflow:

| Ticket Type | Location | Equipment | Client | Fault | DevOps |
|-------------|----------|-----------|--------|-------|--------|
| `new_installation` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `fault_repair` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `incident` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `hse_incident` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `olt_investigation` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `dev_ops` | ❌ | ❌ | ❌ | ❌ | ✅ |

**Evidence** (Commit 907e711 — TicketForm.tsx):
```typescript
const SECTIONS_BY_TYPE: Record<string, SectionVisibility> = {
  dev_ops: { location: false, equipment: false, client: false, fault: false, devops: true },
};
```

---

### DevOps Form Section Fields

**Commit 907e711** created `DevOpsSection.tsx` with:

| Field | Type | Required |
|-------|------|----------|
| Affected Module | dropdown | Yes |
| Environment | button group (prod/dev/local) | Yes |
| Error URL | text | Optional |
| Steps to Reproduce | textarea | Optional |
| Stack Trace / Error Message | textarea (monospace) | Optional |
| Browser / Device Info | text | Optional |

**Evidence** (Commit 907e711 — DevOpsSection.tsx, ~182 lines):
```typescript
export function DevOpsSection({ formData, errors, setField, disabled }: DevOpsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <Bug className="w-5 h-5 text-purple-400" />
        DevOps Details
      </div>
      {/* Module dropdown, Environment buttons, Error URL, Steps, Stack Trace, Browser Info */}
    </div>
  );
}
```

---

### Database Schema: dev_ticket_details Table

**Commit 907e711** added migration 196:

```sql
CREATE TABLE IF NOT EXISTS dev_ticket_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
  error_url TEXT,
  stack_trace TEXT,
  affected_module VARCHAR(100),
  environment VARCHAR(20) DEFAULT 'production',
  steps_to_reproduce TEXT,
  browser_info VARCHAR(255),
  -- Future Claude agent columns (for automated fixes)
  github_pr_url TEXT,
  github_branch VARCHAR(255),
  agent_session_id VARCHAR(255),
  agent_status VARCHAR(30) DEFAULT 'pending', -- pending, approved, running, completed, failed
  agent_approved_by UUID REFERENCES users(id),
  agent_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_id)
);
```

**Purpose**: Stores DevOps-specific metadata linked to each dev_ops ticket. Includes future columns for Claude agent integration (PR auto-creation, deployment automation).

---

### Verification Steps for DevOps Tickets

**Commit 907e711** added `DEV_OPS_STEPS` constant:

| Step | Name | Photo | QA-Required |
|------|------|-------|-------------|
| 1 | Issue Reproduction | ✅ | ✅ |
| 2 | Root Cause Analysis | ❌ | ✅ |
| 3 | Fix Implementation | ❌ | ✅ |
| 4 | Testing & Verification | ✅ | ✅ |
| 5 | Deployment | ✅ | ✅ |

**Evidence** (Commit 907e711 — verificationSteps.ts):
```typescript
const DEV_OPS_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'Issue Reproduction',
    step_description: 'Reproduce the reported issue. Confirm environment, URL, and steps.',
    photo_required: true,
    required_for_qa: true,
  },
  {
    step_number: 2,
    step_name: 'Root Cause Analysis',
    step_description: 'Identify the root cause. Check logs, stack traces, and related code.',
    photo_required: false,
    required_for_qa: true,
  },
  // ... 3 more steps
];
```

---

### Screenshot-First Workflow: VLM + Whisper Analysis

**Commit 4da9f65** added screenshot upload UI and two AI analysis APIs:

#### 1. **ScreenshotUploader Component** (~433 lines)

Users can:
- **Paste** (Ctrl+V) a screenshot from clipboard
- **Drag & drop** image, video, or audio
- **Click to upload** file

Accepts:
- **Images**: `image/*` (JPEG, PNG, WebP, etc.) — max 10MB
- **Videos**: `.mp4`, `.webm`, `.mov`, `.avi`, `.mkv` — max 50MB
- **Audio**: `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`, `.wma` — max 50MB

**Evidence** (Commit 4da9f65 — ScreenshotUploader.tsx):
```typescript
const ACCEPTED_TYPES = 'image/*,video/*,audio/*,.mp4,.webm,.mov,.mp3,.wav,.ogg,.m4a';

export function ScreenshotUploader({ onFieldsExtracted, disabled }: ScreenshotUploaderProps) {
  return (
    <div>
      {/* Instructions banner with F12/DevTools guidance */}
      {/* Drag-drop zone with visual feedback */}
      {/* Success banner: "Fields auto-populated from [screenshot/recording/memo]" */}
      {/* Media previews with lightbox for images */}
    </div>
  );
}
```

---

#### 2. **VLM Screenshot Analysis API** (`POST /api/noc/devops-vlm-analyse`)

Analyzes static screenshots using Qwen3-VL-8B-Instruct (VLM):

**Input**: base64-encoded image  
**Processing**: Sends to VLM with prompt asking for:
- Bug title (max 80 chars)
- Detailed description
- Affected module (from enum list)
- Environment (prod/dev/local)
- Error URL (if visible)
- Stack trace / error messages
- Steps to reproduce (inferred)
- Browser info (if visible)
- Priority suggestion (critical/high/normal/low)
- Confidence score (0.0-1.0)

**Output**: JSON with extracted fields, auto-fills DevOps form

**Evidence** (Commit 4da9f65 — devops-vlm-analyse.ts):
```typescript
const ANALYSIS_PROMPT = `You are analyzing a screenshot of a FibreFlow error.
Extract the following:
{
  "title": "Short bug title (max 80 chars)",
  "description": "Detailed description",
  "affected_module": "One of: Dashboard, NOC, Activate, ...",
  "environment": "production, dev, or local",
  "error_url": "URL if visible",
  "stack_trace": "Any error messages visible",
  "steps_to_reproduce": "Inferred steps",
  "browser_info": "Browser/version if visible",
  "priority_suggestion": "critical|high|normal|low",
  "confidence": 0.0 to 1.0
}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { imageBase64 } = req.body;
  
  // Fetch from VLM API (Qwen3-VL-8B-Instruct)
  const vlmResponse = await fetch(VLM_API_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      model: 'Qwen/Qwen3-VL-8B-Instruct',
      messages: [{ role: 'user', content: [
        { type: 'text', text: ANALYSIS_PROMPT },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
      ]}]
    }),
  });
  
  // Parse VLM response → extract JSON → validate fields → return
}
```

---

#### 3. **Media Analysis API** (`POST /api/noc/devops-media-analyse`)

Processes videos and audio files:

**For Videos**:
1. Extract key frames (3-5 frames, scaled to 1024px max)
2. Analyze each frame with VLM (same prompt as screenshots)
3. Extract audio → transcribe with Whisper
4. Combine frame descriptions + transcript → LLM (GPT-4o-mini) → structured fields

**For Audio**:
1. Transcribe with Whisper
2. Use transcript to infer bug fields (LLM field extraction)

**Evidence** (Commit 4da9f65 — devops-media-analyse.ts, ~330 lines):
```typescript
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { file } = await parseForm(req);
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');

  // Step 1: Extract audio + Whisper transcribe
  const audioPath = extractAudio(filePath, jobId);
  const transcript = await whisperTranscribe(audioPath);

  // Step 2: Extract frames + VLM analysis (video only)
  if (isVideo) {
    const framePaths = extractFrames(filePath, jobId);
    const frameDescriptions = await Promise.all(
      framePaths.map(fp => vlmAnalyseFrame(base64))
    );
  }

  // Step 3: Combine → LLM field extraction
  const analysis = await extractFieldsFromText(transcript, frameDescriptions);
  return apiResponse.success(res, analysis);
}
```

---

### Screenshot Uploader Refactor + Code Quality

**Commit e1dc7cb** split the monolithic ScreenshotUploader into:

1. **`ScreenshotUploader.tsx`** (185 lines)
   - Render-only component
   - Imports hook + utils
   - Handles UI, drag-drop zones, previews, lightbox

2. **`useScreenshotUploader.ts`** (171 lines)
   - Custom hook with all state + event handlers
   - `processImage()`, `processMedia()`, `processFile()`
   - File input handling, drag-drop, paste logic

3. **`screenshotUtils.ts`** (114 lines)
   - Pure utility functions (no React)
   - `getMediaType()`, `getMaxSize()`, `resizeImage()`, `createVideoThumbnail()`
   - Constants: `ACCEPTED_TYPES`, `ANALYSING_MESSAGES`, `MAX_DIMENSION`

**Before**: 433 lines in one file  
**After**: 185 + 171 + 114 = 470 lines split across 3 files (better separation of concerns)

**Evidence** (Commit e1dc7cb):
```diff
- src/modules/noc/components/TicketForm/sections/ScreenshotUploader.tsx (433 lines)
+ src/modules/noc/components/TicketForm/sections/ScreenshotUploader.tsx (185 lines)
+ src/modules/noc/components/TicketForm/sections/useScreenshotUploader.ts (171 lines)
+ src/modules/noc/components/TicketForm/sections/screenshotUtils.ts (114 lines)
```

---

### Critical Security Fix: DevOps API Authentication

**Issue**: Both DevOps API routes were **unauthenticated** (🔴 CRITICAL)

**Commit e1dc7cb** added `withAuth` wrapper:

```typescript
// devops-vlm-analyse.ts
- export default async function handler(req, res) { ... }
+ async function handler(req, res) { ... }
+ export default withAuth(handler);

// devops-media-analyse.ts
- export default async function handler(req, res) { ... }
+ async function handler(req, res) { ... }
+ export default withAuth(handler);
```

**Also added** `credentials: 'include'` to client-side fetch calls:

```typescript
const response = await fetch('/api/noc/devops-vlm-analyse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
+ credentials: 'include',  // Send auth cookies
  body: JSON.stringify({ imageBase64: dataUrl }),
});

const response = await fetch('/api/noc/devops-media-analyse', {
  method: 'POST',
+ credentials: 'include',  // Send auth cookies
  body: formData,
});
```

**Evidence** (Commit e1dc7cb):
```diff
+ import { withAuth } from '@/lib/auth';

- export default async function handler(req: NextApiRequest, res: NextApiResponse) {
+ async function handler(req: NextApiRequest, res: NextApiResponse) {
   if (req.method !== 'POST') { ... }
   // ... handler body ...
 }
+
+ export default withAuth(handler);
```

---

### Files Modified

| File | Size | Purpose |
|------|------|---------|
| `src/modules/noc/types/ticket.ts` | +11 lines | Added `TicketType.DEV_OPS`, `TicketSource.DEV_OPS` enums |
| `app/api/noc/tickets/route.ts` | +2 lines | Added DEV_OPS to VALID_SOURCES and VALID_TYPES |
| `scripts/migrations/196_dev_ticket_details.sql` | **New** | dev_ticket_details table + indexes |
| `src/modules/noc/components/TicketForm/TicketForm.tsx` | +65 lines | Section visibility config, conditionally render DevOpsSection before DetailsSection |
| `src/modules/noc/components/TicketForm/sections/DevOpsSection.tsx` | **New** (182 lines) | Module, environment, error URL, stack trace, steps, browser info fields |
| `src/modules/noc/components/TicketForm/sections/ScreenshotUploader.tsx` | **New** (433→185 lines) | Drag-drop, paste, upload; image resize; video thumbnail; preview gallery; lightbox |
| `pages/api/noc/devops-vlm-analyse.ts` | **New** (164 lines) | VLM screenshot analysis endpoint (auth-protected) |
| `pages/api/noc/devops-media-analyse.ts` | **New** (330 lines) | Media analysis (video frame extraction + Whisper + LLM field extraction) |
| `src/modules/noc/hooks/useTicketForm.ts` | +18 lines | Added DevOps fields to TicketFormData interface |
| `src/modules/noc/services/ticketService.ts` | +31 lines | Insert dev_ticket_details row for dev_ops tickets |
| `src/modules/noc/constants/verificationSteps.ts` | +46 lines | 5-step DevOps workflow: reproduce → RCA → fix → test → deploy |

---

### API Endpoints (New)

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| POST | `/api/noc/devops-vlm-analyse` | ✅ | Analyze screenshot with VLM, extract fields |
| POST | `/api/noc/devops-media-analyse` | ✅ | Process video/audio: frame extraction + Whisper + LLM |

**Request bodies**:
```typescript
// devops-vlm-analyse
POST /api/noc/devops-vlm-analyse
{ "imageBase64": "data:image/png;base64,..." }
→ { "title": "...", "description": "...", "affected_module": "...", ... }

// devops-media-analyse
POST /api/noc/devops-media-analyse
FormData { file: <video|audio> }
→ { "title": "...", "description": "...", "transcript": "...", ... }
```

---

### Ticket Creation Flow

When a user creates a dev_ops ticket:

1. **Select type** → `Ticket Type: DevOps` (shown in type selector)
2. **Expand DevOps section** → appears before Details section
3. **Upload media** → paste screenshot, drag-drop video, or upload voice memo
4. **AI analysis** → VLM/Whisper processes media, displays progress
5. **Auto-fill fields** → title, description, module, environment, error URL, steps, stack trace, priority auto-populated
6. **User review** → fields are editable (user can correct AI extraction)
7. **Submit** → form submission creates ticket + dev_ticket_details row
8. **Verification workflow** → 5-step checklist: reproduce → RCA → fix → test → deploy

---

### Testing Notes

**Manual testing** (per commits):
- ✅ Paste screenshot from clipboard → VLM analysis → field auto-fill
- ✅ Drag-drop image → VLM analysis works
- ✅ Upload screen recording (~60s) → frame extraction + Whisper transcription works
- ✅ Upload voice memo → Whisper transcription works
- ✅ All media types show previews/thumbnails
- ✅ Lightbox works for image previews
- ✅ Auth wrapper blocks unauthenticated requests
- ✅ Credentials header included in fetch calls

**Not tested**: VLM model availability, Whisper timeout handling, concurrent uploads, video codec edge cases

---

### Known Limitations

1. **VLM model not deployed** — API endpoint (`/v1/chat/completions`) may not be available. Code assumes `http://100.96.203.105:8100` is running Qwen3.
2. **Video processing timeout** — Whisper + VLM analysis may exceed 60s for long videos.
3. **No async job tracking** — Large media uploads block the request. Should use job queue (Bull, Celery) for production.
4. **Fallback on frame extraction failure** — If ffmpeg fails to extract frames, tries first frame only; falls back to transcript-only analysis.

---

### Co-Authors

- Claude Sonnet 4.5 (implementation)
- Claude Opus 4.6 (design + QA)

---

## 2026-03-13 — Type-Specific Verification Steps + Photo Upload UX

**Commit**: [`a63c493`](https://github.com/FibreFlow/fibreflow/commit/a63c49316f0eddae0d0df95f57576708cc7f8cde)  
**Author**: Claude Sonnet 4.5  
**Size**: 604 lines changed, 4 files modified

### Summary

Verification checklists are now **customized per ticket type**. Previously, all ticket types used the same 12-step new installation checklist. Now each ticket type (fault repair, ONT swap, incidents, etc.) has a tailored checklist that matches the actual work being done.

Photo upload UX improved with **clipboard paste support** (Ctrl+V) in addition to drag-drop and click-to-upload.

---

### Type-Specific Verification Steps

Each ticket type now has its own verification checklist:

| Ticket Type | Steps | Focus |
|-------------|-------|-------|
| **new_installation** | 12 | Full fiber installation workflow: site assessment → materials → installation → splicing → testing → documentation |
| **fault_repair** | 7 | Fault assessment → root cause → repair → signal verification → connectivity test → documentation |
| **ont_swap** | 7 | Document old ONT → swap device → activate → signal test → connectivity → documentation |
| **olt_investigation** | 4 | Review OLT data → cross-reference with tickets → verify signal → resolve |
| **serial_mismatch** | 3 | Review mismatch → physical check → resolve |
| **pre_provision** | 3 | Check OES → search 1Map → resolve |
| **hse_incident** | 6 | Scene assessment → injuries → witnesses → RCA → corrective actions → documentation |
| **hse_near_miss** | 3 | Document event → contributing factors → corrective actions |
| **incident** | 7 | Impact assessment → containment → RCA → restore → verify → post-incident review |
| **modification** | 6 | Assess scope → plan → modify → verify → test → documentation |

**Note**: Ticket types without a defined checklist fall back to the 12-step new_installation workflow.

---

### Photo Upload: Clipboard Paste

Users can now **paste images directly from clipboard** into photo upload fields:

- **Ctrl+V** (or Cmd+V on Mac) — paste from clipboard
- **Drag & drop** — existing feature
- **Click to upload** — existing feature

Useful for screenshots, phone camera photos synced via cloud, or images copied from other apps.

---

### Files Changed

| File | Purpose |
|------|---------|
| `src/modules/noc/constants/verificationSteps.ts` | **+496 lines** — Defines all 10 ticket-type-specific step arrays |
| `src/modules/noc/services/verificationService.ts` | **+51 lines** — Updated to fetch steps based on ticket type |
| `app/api/noc/tickets/[id]/verification/route.ts` | **+27 lines** — API route now returns type-specific steps |
| `src/modules/noc/components/Verification/PhotoUpload.tsx` | **+45 lines** — Added clipboard paste handler |
| `pages/api/noc/verification.ts` | Refactored (70 lines changed) |

---

### API Impact

**No breaking changes.** Existing GET `/api/noc/tickets/[id]/verification` endpoint now returns type-specific steps based on `ticket.type`. Clients that already handle dynamic step arrays (by step count and step_number) will work without modification.

**Example response** (fault_repair ticket):
```json
{
  "ticket_id": "uuid",
  "ticket_type": "fault_repair",
  "steps": [
    { "step_number": 1, "step_name": "Fault Assessment", "photo_required": true, ... },
    { "step_number": 2, "step_name": "Safety Check", "photo_required": false, ... },
    { "step_number": 3, "step_name": "Root Cause Identification", "photo_required": true, ... },
    ...
  ],
  "total_steps": 7,
  "completed_steps": 2,
  "progress_percent": 29
}
```

---

### Migration Notes

**No database migration required.** The verification step structure is code-only — steps are generated dynamically based on ticket type at runtime.

**Existing tickets**: Any tickets with in-progress verification checklists will now see the **correct type-specific steps** on their next load. If they had completed steps using the old 12-step checklist, those completed steps will still be marked as complete (step numbers are preserved).

---

### Testing

**Manual testing completed** (per commit message):
- ✅ New installation ticket → 12-step checklist
- ✅ Fault repair ticket → 7-step checklist
- ✅ ONT swap ticket → 7-step checklist
- ✅ HSE incident ticket → 6-step checklist
- ✅ Clipboard paste for photo upload (tested on Chrome, Firefox)

**Unit tests**: Not included in commit. Verification service tests should be added to cover ticket type mapping.

---

### Co-Authors

- Claude Opus 4.6 (design review + QA)

---

## 2026-03-12 — NOC Module Rename + PP Data Enrichment

**Commit**: [`96d8cc9`](https://github.com/FibreFlow/fibreflow/commit/96d8cc9411b41be6427ae40629dbf4972fd6bcc4)  
**Author**: Claude Sonnet 4.5  
**Size**: 1,876 lines changed, 68 files modified

### Summary

The **maintenance** module was renamed to **noc** (Network Operations Centre) to better reflect its scope. The module handles the full NOC function — faults, escalations, QA workflows, handovers, QContact sync — not just reactive maintenance.

This was a **code-only refactor**: all directories, imports, exports, navigation config, sidebar sections, data-sync groups, and API routes were updated. Database schema and data were not migrated.

Additionally, **PP data enrichment** was added to the module: a new endpoint enriches Pre-Provision tickets with location data from `drops` and `onemap_properties` tables.

---

### Files Changed

**Renamed directories:**
- `src/modules/maintenance/` → `src/modules/noc/`
- `app/(main)/maintenance/` → `app/(main)/noc/`
- `app/api/maintenance/` → `app/api/noc/`

**Updated imports** (68 files total):
- All components, services, hooks, and constants now import from `@/modules/noc/`
- Navigation config updated: sidebar section renamed `maintenance` → `noc`
- Data-sync groups updated: `noc_tickets`, `noc_escalations`, etc.

---

### PP Data Enrichment

**New endpoint**: `PATCH /api/activate/pp-data-tickets`

Enriches Pre-Provision (PP) tickets with location data from:
- **`drops` table** — pole, PON, zone, GPS coordinates
- **`onemap_properties` table** — address, ERF number, cadastral info

**Backfill status**: 372 tickets enriched (as of 2026-03-12).

**Why**: PP tickets often arrive from QContact with incomplete location data. Enrichment fills gaps before NOC triage.

---

### Known Issues

**Test failures** (pre-existing, unrelated to rename):
- 6 NOC module tests failing (verification service, QA readiness, handover)
- GitHub Actions billing suspended — CI offline
- Tests were failing before the rename and are not addressed in this commit

---

### Migration Notes

**No database migration required.** Database table names (`noc_tickets`, `noc_escalations`, etc.) were already named `noc_*` — the rename was code-only.

**API routes**: All `/api/maintenance/*` routes are now `/api/noc/*`. Frontend clients were updated in the same commit. No backwards compatibility layer needed.

---

## 2026-03-11 — Procurement 10-Step Workflow Restructure

**Commit**: [`146da95`](https://github.com/FibreFlow/fibreflow/commit/146da958008d20f5cc3429411d05cc85302f8ba0)  
**Author**: Claude Sonnet 4.5  
**Size**: 1,142 lines changed, 11 files modified

### Summary

Procurement workflow restructured from **9 steps to 10 steps** to separate RFQ award and PO creation into distinct stages. Previously, Step 6 combined "Quote Award" and "Create PO" — now Step 6 is Quote Award, and Step 7 is Create PO.

**Why**: POs can be created via RFQ award OR directly (no RFQ). Splitting the steps clarifies the two paths and allows direct PO creation to skip RFQ-related steps.

---

### Step Comparison

| Old (9 steps) | New (10 steps) | Change |
|---------------|----------------|--------|
| Step 1: Create Draft | Step 1: Create Draft | _(unchanged)_ |
| Step 2: Add Suppliers | Step 2: Add Suppliers | _(unchanged)_ |
| Step 3: Add Items | Step 3: Add Items | _(unchanged)_ |
| Step 4: Send RFQ | Step 4: Send RFQ | _(unchanged)_ |
| Step 5: Receive Quotes | Step 5: Receive Quotes | _(unchanged)_ |
| **Step 6: Quote Award + Create PO** | **Step 6: Quote Award** | **Split** |
|  | **Step 7: Create PO** | **New** |
| Step 7: Receive Goods | Step 8: Receive Goods | _(renumbered)_ |
| Step 8: Verify Delivery | Step 9: Verify Delivery | _(renumbered)_ |
| Step 9: Invoice Processing | Step 10: Invoice Processing | _(renumbered)_ |

---

### RFQ vs Direct PO Paths

**RFQ Path** (full 10-step workflow):
1. Create Draft → 2. Add Suppliers → 3. Add Items → 4. Send RFQ → 5. Receive Quotes → **6. Award Quote** → **7. Create PO** → 8. Receive → 9. Verify → 10. Invoice

**Direct PO Path** (skip RFQ steps):
1. Create Draft → 2. Add Suppliers → 3. Add Items → _(skip 4-6)_ → **7. Create PO** → 8. Receive → 9. Verify → 10. Invoice

---

### Files Changed

| File | Purpose |
|------|---------|
| `src/modules/procurement/components/Step6QuoteAward.tsx` | **New** — Quote award UI (split from old Step6) |
| `src/modules/procurement/components/Step7CreatePO.tsx` | **New** — PO creation UI (previously part of Step6) |
| `src/modules/procurement/components/Step6Receive.tsx` → `Step8Receive.tsx` | Renumbered |
| `src/modules/procurement/components/Step7Verify.tsx` → `Step9Verify.tsx` | Renumbered |
| `src/modules/procurement/components/Step8Invoice.tsx` → `Step10Invoice.tsx` | Renumbered |
| `src/modules/procurement/constants/workflowSteps.ts` | Updated to 10-step array |
| `app/api/procurement/rfq-suppliers/route.ts` | **New endpoint** — GET `/api/procurement/rfq-suppliers` |

---

### API Changes

**New endpoint**: `GET /api/procurement/rfq-suppliers`

Returns suppliers associated with an RFQ (for quote award step). Previously this data was fetched inline — now it's a dedicated endpoint for clarity.

**No breaking changes**: Existing procurement endpoints unchanged.

---

### Migration Notes

**No database migration required.** Workflow step numbering is code-only — the step field is an enum/string, not a stored integer.

**Existing procurement records**: Any in-flight procurement workflows will see the new 10-step UI on their next load. Step numbering is cosmetic — the actual workflow state fields (`rfq_sent`, `quotes_received`, `po_created`, etc.) are unchanged.

---

### Known Issues

**Step file naming discrepancy**: The step component files are named based on their **logical position** (Step8Receive, Step9Verify, Step10Invoice) but the old Step6/7/8 file names were retained in some places. This is cosmetic only — the components render correctly based on the `workflowSteps` array order.

**TODO**: Rename all step component files to match their logical position (Step1CreateDraft, Step2AddSuppliers, etc.) in a future refactor for consistency.

---

