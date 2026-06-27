# VLM Screenshot-to-Note for NOC Tickets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a NOC user upload/paste 1map screenshots into a ticket's Notes tab and have the VLM read them, cross-check against the ticket, and auto-post a note with the screenshots attached.

**Architecture:** A new App-Router endpoint `POST /api/noc/tickets/[id]/analyze-screenshot` uploads the images to VF Storage, loads the ticket's cross-reference fields, calls Qwen3-VL with a 1map-aware prompt, composes a note body, and posts it via a shared `createTicketNote()` service (extracted from the existing notes `POST`, which also fixes a latent `text[]` write bug). New UI lives in `ScreenshotAnalyzer.tsx`; note attachments render in an extracted `NoteCard.tsx`.

**Tech Stack:** Next.js App Router (`route.ts` handlers), React + TanStack Query, `pg.Pool` via `@/lib/db`, VF Storage adapter, Qwen3-VL (OpenAI-compatible vLLM at `:8100`), Vitest.

## Global Constraints

- **Visibility:** the AI note inherits the note composer's current Private/Public toggle (`newNoteVisibility`). Public ⇒ synced to QContact via `pushNote`.
- **Max 4 images** per analysis; client resizes each to ≤1280px JPEG before sending base64 data URLs.
- **Never fabricate a note:** on VLM timeout/error/unparseable JSON, or on storage-upload failure, post NO note and return an error. The user sees a toast.
- **`maintenance_notes.attachments` is Postgres `text[]`** (verified live). Write it by passing the JS `string[]` as a single query param — NEVER `JSON.stringify(...)` (that produces a malformed `["..."]` array literal). `created_by` is `uuid` and nullable.
- AI notes use `note_type: 'system'`; their content begins with the marker `🤖 AI screenshot analysis`.
- Code quality: no `console.log` (use `log`/`createLogger` from `@/lib/logger`); files < 300 lines, components < 200 lines; 100% types.
- All changes go through a PR; run `npm run ci:quick` before the PR.

---

### Task 1: Shared `createTicketNote()` service + refactor existing notes POST

Extract note creation into one service so the new endpoint and the manual form share a single, correct code path. This also fixes the latent `text[]` write bug in the existing POST.

**Files:**
- Create: `src/modules/noc/services/ticketNotesService.ts`
- Create (test): `src/modules/noc/__tests__/services/ticketNotesService.test.ts`
- Modify: `app/api/noc/tickets/[id]/notes/route.ts` (rewrite `POST`, lines 176-361; remove dead `auth()` declare at lines 18-20 and the `pushNote` import at line 16)

**Interfaces:**
- Produces:
  - `createTicketNote(params: CreateTicketNoteParams): Promise<CreateTicketNoteResult>`
  - `interface CreateTicketNoteParams { ticketId: string; content: string; visibility: 'private' | 'public'; noteType?: string; isResolution?: boolean; attachments?: string[] | null; createdBy?: string | null; }`
  - `type CreateTicketNoteResult = { ok: true; note: CreatedTicketNote } | { ok: false; status: number; message: string }`
  - `interface CreatedTicketNote { id; ticket_id; content; note_type; visibility; created_by; created_at; updated_at; is_resolution; attachments; author_name?; author_email?; }`

- [ ] **Step 1: Write the failing test**

Create `src/modules/noc/__tests__/services/ticketNotesService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
const { pushNoteMock } = vi.hoisted(() => ({ pushNoteMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: { query: queryMock } }));
vi.mock('@/modules/noc/services/qcontactSyncOutbound', () => ({ pushNote: pushNoteMock }));

import { createTicketNote } from '@/modules/noc/services/ticketNotesService';

describe('createTicketNote', () => {
  beforeEach(() => {
    queryMock.mockReset();
    pushNoteMock.mockReset().mockResolvedValue({ success: true });
  });

  it('rejects empty content with 400 and never touches the DB', async () => {
    const res = await createTicketNote({ ticketId: 't1', content: '   ', visibility: 'private' });
    expect(res).toEqual({ ok: false, status: 400, message: 'Note content is required' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the ticket does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // ticket lookup
    const res = await createTicketNote({ ticketId: 't1', content: 'hi', visibility: 'private' });
    expect(res).toEqual({ ok: false, status: 404, message: 'Ticket not found' });
  });

  it('writes attachments as a text[] array (not a JSON string) and skips QContact for private notes', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 't1' }] })  // ticket exists
      .mockResolvedValueOnce({ rows: [] })               // insert
      .mockResolvedValueOnce({ rows: [{ id: 'n1', attachments: ['/storage/a.jpg'] }] }); // fetch
    const res = await createTicketNote({
      ticketId: 't1', content: 'note', visibility: 'private',
      noteType: 'system', attachments: ['/storage/a.jpg', '/storage/b.jpg'],
    });
    expect(res.ok).toBe(true);
    const insertParams = queryMock.mock.calls[1]![1] as unknown[];
    expect(insertParams).toContainEqual(['/storage/a.jpg', '/storage/b.jpg']); // array passed through
    expect(insertParams).not.toContain(JSON.stringify(['/storage/a.jpg', '/storage/b.jpg']));
    expect(pushNoteMock).not.toHaveBeenCalled();
  });

  it('pushes public notes to QContact with the trimmed content', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 't1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'n1' }] });
    await createTicketNote({ ticketId: 't1', content: '  public note  ', visibility: 'public' });
    expect(pushNoteMock).toHaveBeenCalledWith('t1', 'public note', false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/noc/__tests__/services/ticketNotesService.test.ts`
Expected: FAIL — `Cannot find module '@/modules/noc/services/ticketNotesService'`.

- [ ] **Step 3: Write the service**

Create `src/modules/noc/services/ticketNotesService.ts`:

```ts
/**
 * Shared ticket-note creation. Used by the notes POST route and the
 * analyze-screenshot endpoint so QContact sync + the text[] attachments
 * write live in exactly one place.
 */
import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { pushNote } from '@/modules/noc/services/qcontactSyncOutbound';

const logger = createLogger('noc:ticket-notes-service');

export interface CreateTicketNoteParams {
  ticketId: string;
  content: string;
  visibility: 'private' | 'public';
  noteType?: string;
  isResolution?: boolean;
  attachments?: string[] | null;
  createdBy?: string | null;
}

export interface CreatedTicketNote {
  id: string;
  ticket_id: string;
  content: string;
  note_type: string;
  visibility: 'private' | 'public';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_resolution: boolean;
  attachments: string[] | null;
  author_name?: string | null;
  author_email?: string | null;
}

export type CreateTicketNoteResult =
  | { ok: true; note: CreatedTicketNote }
  | { ok: false; status: number; message: string };

export async function createTicketNote(params: CreateTicketNoteParams): Promise<CreateTicketNoteResult> {
  const {
    ticketId,
    content,
    visibility,
    noteType = 'internal',
    isResolution = false,
    attachments = null,
    createdBy = null,
  } = params;

  if (!ticketId) return { ok: false, status: 400, message: 'Ticket ID is required' };
  if (!content || content.trim() === '') return { ok: false, status: 400, message: 'Note content is required' };
  if (visibility !== 'private' && visibility !== 'public') {
    return { ok: false, status: 400, message: 'Visibility must be "private" or "public"' };
  }

  const ticket = await pool.query('SELECT id FROM maintenance_tickets WHERE id = $1', [ticketId]);
  if (ticket.rows.length === 0) return { ok: false, status: 404, message: 'Ticket not found' };

  const noteId = crypto.randomUUID();
  const now = new Date().toISOString();
  const trimmed = content.trim();

  // attachments is a Postgres text[] — pass the JS array directly so pg
  // serialises it to a proper array literal. Do NOT JSON.stringify it.
  await pool.query(
    `INSERT INTO maintenance_notes
       (id, ticket_id, content, note_type, visibility, created_by, created_at, updated_at, is_resolution, attachments)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [noteId, ticketId, trimmed, noteType, visibility, createdBy, now, now, isResolution, attachments ?? null],
  );

  const created = await pool.query(
    `SELECT n.id, n.ticket_id, n.content, n.note_type, n.visibility, n.created_by,
            n.created_at, n.updated_at, n.is_resolution, n.attachments,
            u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email
       FROM maintenance_notes n
       LEFT JOIN users u ON n.created_by = u.id
      WHERE n.id = $1`,
    [noteId],
  );

  logger.info('Created ticket note', { ticketId, noteId, visibility, noteType });

  if (visibility === 'public') {
    try {
      const sync = await pushNote(ticketId, trimmed, false);
      logger.info('Public note synced to QContact', { ticketId, noteId, syncSuccess: sync.success });
    } catch (syncError) {
      logger.warn('Failed to sync public note to QContact', {
        ticketId, noteId,
        error: syncError instanceof Error ? syncError.message : 'Unknown',
      });
    }
  }

  return { ok: true, note: created.rows[0] as CreatedTicketNote };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/noc/__tests__/services/ticketNotesService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor the existing notes POST to use the service**

In `app/api/noc/tickets/[id]/notes/route.ts`:

1. Remove the now-unused import at line 16: `import { pushNote } from '@/modules/noc/services/qcontactSyncOutbound';`
2. Remove the dead Clerk auth declare (lines 18-20):
```ts
// Note: auth() function is not imported ...
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare function auth(): Promise<{ userId: string | null }>;
```
3. Add the service import near the top (after the logger import):
```ts
import { createTicketNote } from '@/modules/noc/services/ticketNotesService';
```
4. Replace the **entire `POST` function body** (lines 176-361) with:
```ts
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;

    const body = await request.json();
    const result = await createTicketNote({
      ticketId,
      content: body.content,
      visibility: body.visibility ?? 'private',
      noteType: body.note_type ?? 'internal',
      isResolution: body.is_resolution ?? false,
      attachments: body.attachments ?? null,
      createdBy: body.created_by ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: { message: result.message } },
        { status: result.status },
      );
    }

    return NextResponse.json({ success: true, data: result.note });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error creating ticket note', { error: errorMessage });
    return NextResponse.json(
      { success: false, error: { message: 'Failed to create note', details: errorMessage } },
      { status: 500 },
    );
  }
}
```
Leave the `GET` handler and its `neon`/`sql` usage untouched.

- [ ] **Step 6: Verify lint + the existing notes test still pass**

Run: `npx vitest run src/modules/noc/__tests__/services/ticketNotesService.test.ts && npx eslint app/api/noc/tickets/\[id\]/notes/route.ts src/modules/noc/services/ticketNotesService.ts`
Expected: tests PASS; eslint reports no errors (warnings tolerated by the ratchet).

- [ ] **Step 7: Commit**

```bash
git add src/modules/noc/services/ticketNotesService.ts \
  src/modules/noc/__tests__/services/ticketNotesService.test.ts \
  "app/api/noc/tickets/[id]/notes/route.ts"
git commit -m "feat(noc): shared createTicketNote service; fix text[] attachments write"
```

---

### Task 2: 1map-aware analysis module (prompt + parse + compose) with unit tests

Pure, network-free functions — the testable heart of the feature.

**Files:**
- Create: `src/modules/noc/services/screenshotNoteAnalysis.ts`
- Create (test): `src/modules/noc/__tests__/services/screenshotNoteAnalysis.test.ts`

**Interfaces:**
- Consumes: `stripThinkTags` from `@/lib/vlm`.
- Produces:
  - `interface TicketCrossRef { dr_number: string | null; pole_number: string | null; pon_number: string | null; ont_serial: string | null; }`
  - `interface InstallScreenshotAnalysis { is_1map_screenshot: boolean; dr_number: string | null; status: string | null; status_interpretation: string | null; photos: { total: number; uploaded: number; missing: string[] } | null; serial: string | null; pole: string | null; pon: string | null; site: string | null; mismatches: string[]; summary: string; confidence: 'high' | 'medium' | 'low'; }`
  - `buildInstallScreenshotPrompt(ctx: TicketCrossRef): string`
  - `parseInstallScreenshotResponse(raw: string): InstallScreenshotAnalysis`
  - `composeNoteBody(a: InstallScreenshotAnalysis, ctx: TicketCrossRef): string`

- [ ] **Step 1: Write the failing test**

Create `src/modules/noc/__tests__/services/screenshotNoteAnalysis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseInstallScreenshotResponse,
  composeNoteBody,
  buildInstallScreenshotPrompt,
  type InstallScreenshotAnalysis,
  type TicketCrossRef,
} from '@/modules/noc/services/screenshotNoteAnalysis';

describe('parseInstallScreenshotResponse', () => {
  it('parses JSON wrapped in <think> tags and ```json fences', () => {
    const raw =
      '<think>looking</think>\n```json\n{"is_1map_screenshot":true,"dr_number":"DR1746579",' +
      '"status":"Pole Permission: Approved","status_interpretation":"still pole permission",' +
      '"photos":{"total":8,"uploaded":0,"missing":["Photo of the Dome"]},"serial":"ALCLB491D094",' +
      '"pole":"LAW.P.B799","pon":"92","site":"LAW",' +
      '"mismatches":["Ticket expects Home Installation but 1map shows Pole Permission"],' +
      '"summary":"No photos uploaded; still pole permission.","confidence":"high"}\n```';
    const a = parseInstallScreenshotResponse(raw);
    expect(a.is_1map_screenshot).toBe(true);
    expect(a.dr_number).toBe('DR1746579');
    expect(a.photos).toEqual({ total: 8, uploaded: 0, missing: ['Photo of the Dome'] });
    expect(a.confidence).toBe('high');
  });

  it('throws when no JSON object is present', () => {
    expect(() => parseInstallScreenshotResponse('no json here')).toThrow();
  });

  it('defaults confidence to low and is_1map to false on a sparse object', () => {
    const a = parseInstallScreenshotResponse('{"summary":"x","confidence":"banana"}');
    expect(a.confidence).toBe('low');
    expect(a.is_1map_screenshot).toBe(false);
    expect(a.photos).toBeNull();
    expect(a.mismatches).toEqual([]);
  });
});

describe('composeNoteBody', () => {
  const ctx: TicketCrossRef = { dr_number: 'DR1746579', pole_number: 'LAW.P.B799', pon_number: '92', ont_serial: null };
  const base: InstallScreenshotAnalysis = {
    is_1map_screenshot: true, dr_number: 'DR1746579', status: 'Pole Permission: Approved',
    status_interpretation: 'still pole permission',
    photos: { total: 8, uploaded: 0, missing: ['Photo of the Dome'] },
    serial: 'ALCLB491D094', pole: 'LAW.P.B799', pon: '92', site: 'LAW',
    mismatches: ['Ticket expects Home Installation but 1map shows Pole Permission'],
    summary: 'No photos uploaded; drop still at Pole Permission.', confidence: 'high',
  };

  it('includes marker, summary, photo count, status, DR match, mismatch and confidence', () => {
    const body = composeNoteBody(base, ctx);
    expect(body).toContain('🤖 AI screenshot analysis');
    expect(body).toContain('No photos uploaded; drop still at Pole Permission.');
    expect(body).toContain('Photos: 0/8 uploaded');
    expect(body).toContain('Status: Pole Permission: Approved');
    expect(body).toContain('DR: DR1746579 ✓ matches ticket');
    expect(body).toContain('⚠ Ticket expects Home Installation');
    expect(body).toContain('(confidence: high)');
  });

  it('flags a DR mismatch against the ticket', () => {
    const body = composeNoteBody({ ...base, dr_number: 'DR9999999', mismatches: [] }, ctx);
    expect(body).toContain('✗ ticket DR is DR1746579');
  });

  it('omits the 1map checks block for non-1map screenshots', () => {
    const body = composeNoteBody({ ...base, is_1map_screenshot: false }, ctx);
    expect(body).not.toContain('Photos:');
    expect(body).toContain('(confidence: high)');
  });
});

describe('buildInstallScreenshotPrompt', () => {
  it('embeds the ticket cross-reference details and the schema keys', () => {
    const p = buildInstallScreenshotPrompt({ dr_number: 'DR1746579', pole_number: 'LAW.P.B799', pon_number: '92', ont_serial: null });
    expect(p).toContain('DR1746579');
    expect(p).toContain('LAW.P.B799');
    expect(p).toContain('is_1map_screenshot');
    expect(p).toContain('"missing"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/noc/__tests__/services/screenshotNoteAnalysis.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the analysis module**

Create `src/modules/noc/services/screenshotNoteAnalysis.ts`:

```ts
/**
 * Pure (network-free) helpers for the 1map screenshot → note feature:
 * prompt building, VLM-response parsing, and note-body composition.
 */
import { stripThinkTags } from '@/lib/vlm';

export interface TicketCrossRef {
  dr_number: string | null;
  pole_number: string | null;
  pon_number: string | null;
  ont_serial: string | null;
}

export interface InstallScreenshotAnalysis {
  is_1map_screenshot: boolean;
  dr_number: string | null;
  status: string | null;
  status_interpretation: string | null;
  photos: { total: number; uploaded: number; missing: string[] } | null;
  serial: string | null;
  pole: string | null;
  pon: string | null;
  site: string | null;
  mismatches: string[];
  summary: string;
  confidence: 'high' | 'medium' | 'low';
}

export function buildInstallScreenshotPrompt(ctx: TicketCrossRef): string {
  const known = [
    ctx.dr_number ? `- DR / drop number: ${ctx.dr_number}` : null,
    ctx.pole_number ? `- Pole number: ${ctx.pole_number}` : null,
    ctx.pon_number ? `- PON: ${ctx.pon_number}` : null,
    ctx.ont_serial ? `- ONT serial: ${ctx.ont_serial}` : null,
  ].filter(Boolean).join('\n') || '- (no cross-reference data on this ticket)';

  return `You are analysing one or more screenshots from "1map" — the GIS system that tracks fibre "fibertime Installation" records. A technician wants to know the install state of a drop.

This ticket's known FibreFlow details — cross-check the screenshot against these:
${known}

Return ONLY a JSON object (no markdown fences, no commentary) with EXACTLY this shape:
{
  "is_1map_screenshot": true,
  "dr_number": "the DR/drop number visible in the screenshot, or null",
  "status": "the value of the Status field, verbatim, or null",
  "status_interpretation": "plain-English meaning of that status, or null",
  "photos": { "total": 0, "uploaded": 0, "missing": ["column headers that show NO IMAGE"] },
  "serial": "ONT barcode / serial visible, or null",
  "pole": "pole number visible, or null",
  "pon": "PON visible, or null",
  "site": "site code visible, or null",
  "mismatches": ["differences between the screenshot and the ticket details above"],
  "summary": "1-3 plain sentences a technician would write",
  "confidence": "high"
}

Rules:
- A photo cell reading "NO IMAGE" (or blank) is NOT uploaded; a visible thumbnail IS uploaded.
- "photos.total" = number of photo columns shown; "photos.uploaded" = how many show an image; "photos.missing" = the headers that show NO IMAGE.
- Read the "Status" field verbatim. Example: "Pole Permission: Approved" means the drop is still at the pole-permission stage and the home installation has NOT been recorded.
- Put any disagreement with the ticket details (e.g. a different DR number, or a status earlier than a completed home installation) into "mismatches".
- "summary" example: "No photos uploaded; drop still at Pole Permission, home installation not yet recorded."
- "confidence" is one of "high", "medium", "low".
- If the image is NOT a 1map installation screenshot, set "is_1map_screenshot": false, set photos to null, and just describe what you see in "summary".`;
}

export function parseInstallScreenshotResponse(raw: string): InstallScreenshotAnalysis {
  const cleaned = stripThinkTags(raw)
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('VLM response contained no JSON object');

  const obj = JSON.parse(match[0]) as Record<string, unknown>;

  const confRaw = String(obj.confidence ?? 'low').toLowerCase();
  const confidence = (['high', 'medium', 'low'].includes(confRaw) ? confRaw : 'low') as 'high' | 'medium' | 'low';

  const p = obj.photos as { total?: unknown; uploaded?: unknown; missing?: unknown } | null | undefined;
  const photos = p && typeof p === 'object'
    ? {
        total: Number(p.total ?? 0) || 0,
        uploaded: Number(p.uploaded ?? 0) || 0,
        missing: Array.isArray(p.missing) ? p.missing.map(String) : [],
      }
    : null;

  const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

  return {
    is_1map_screenshot: obj.is_1map_screenshot === true,
    dr_number: str(obj.dr_number),
    status: str(obj.status),
    status_interpretation: str(obj.status_interpretation),
    photos,
    serial: str(obj.serial),
    pole: str(obj.pole),
    pon: str(obj.pon),
    site: str(obj.site),
    mismatches: Array.isArray(obj.mismatches) ? obj.mismatches.map(String) : [],
    summary: str(obj.summary) ?? 'Screenshot analysed; no summary returned.',
    confidence,
  };
}

export function composeNoteBody(a: InstallScreenshotAnalysis, ctx: TicketCrossRef): string {
  const lines: string[] = ['🤖 AI screenshot analysis', '', a.summary.trim()];

  if (a.is_1map_screenshot) {
    const checks: string[] = [];
    if (a.photos) {
      let line = `Photos: ${a.photos.uploaded}/${a.photos.total} uploaded`;
      if (a.photos.missing.length > 0) line += ` · missing: ${a.photos.missing.join(', ')}`;
      checks.push(line);
    }
    if (a.status) {
      checks.push(`Status: ${a.status}${a.status_interpretation ? ` — ${a.status_interpretation}` : ''}`);
    }
    if (a.dr_number) {
      const matches = ctx.dr_number && a.dr_number.toUpperCase() === ctx.dr_number.toUpperCase();
      const verdict = matches
        ? '✓ matches ticket'
        : ctx.dr_number ? `✗ ticket DR is ${ctx.dr_number}` : '(no ticket DR to compare)';
      checks.push(`DR: ${a.dr_number} ${verdict}`);
    }
    if (a.serial) checks.push(`Serial: ${a.serial}`);

    if (checks.length > 0) {
      lines.push('', checks.join('\n'));
    }
    for (const m of a.mismatches) lines.push(`⚠ ${m}`);
  }

  lines.push('', `(confidence: ${a.confidence})`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/noc/__tests__/services/screenshotNoteAnalysis.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/modules/noc/services/screenshotNoteAnalysis.ts \
  src/modules/noc/__tests__/services/screenshotNoteAnalysis.test.ts
git commit -m "feat(noc): 1map screenshot analysis prompt/parse/compose helpers"
```

---

### Task 3: VLM client `analyzeInstallScreenshots()`

Thin network wrapper that sends all images in one multimodal call and returns the parsed analysis. Verified via the endpoint + manual run (no unit test — it is pure I/O over the pure helpers from Task 2).

**Files:**
- Create: `src/modules/noc/services/screenshotNoteVlmClient.ts`

**Interfaces:**
- Consumes: `buildInstallScreenshotPrompt`, `parseInstallScreenshotResponse`, `TicketCrossRef`, `InstallScreenshotAnalysis` (Task 2); `VLM_CHAT_ENDPOINT`, `VLM_EXTRACTION_MODEL`, `VLM_MAX_TOKENS_ANALYSIS`, `VLM_TIMEOUT_DOCUMENT`, `VLM_TEMPERATURE` from `@/lib/vlm`.
- Produces: `analyzeInstallScreenshots(images: string[], ctx: TicketCrossRef): Promise<InstallScreenshotAnalysis>` (images are base64 data URLs).

- [ ] **Step 1: Write the client**

Create `src/modules/noc/services/screenshotNoteVlmClient.ts`:

```ts
/**
 * Sends 1map screenshots to Qwen3-VL and returns the parsed analysis.
 * Throws on network error / non-200 / unparseable response. The 90s
 * document timeout accommodates multiple images in one call.
 */
import {
  VLM_CHAT_ENDPOINT,
  VLM_EXTRACTION_MODEL,
  VLM_MAX_TOKENS_ANALYSIS,
  VLM_TIMEOUT_DOCUMENT,
  VLM_TEMPERATURE,
} from '@/lib/vlm';
import { createLogger } from '@/lib/logger';
import {
  buildInstallScreenshotPrompt,
  parseInstallScreenshotResponse,
  type TicketCrossRef,
  type InstallScreenshotAnalysis,
} from '@/modules/noc/services/screenshotNoteAnalysis';

const logger = createLogger('noc:screenshot-vlm');

export async function analyzeInstallScreenshots(
  images: string[],
  ctx: TicketCrossRef,
): Promise<InstallScreenshotAnalysis> {
  const prompt = buildInstallScreenshotPrompt(ctx);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_DOCUMENT);

  try {
    const resp = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VLM_EXTRACTION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
            ],
          },
        ],
        max_tokens: VLM_MAX_TOKENS_ANALYSIS,
        temperature: VLM_TEMPERATURE,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      throw new Error(`VLM request failed (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const json = await resp.json();
    const rawContent: string = json.choices?.[0]?.message?.content ?? '';
    logger.debug('VLM raw response', { length: rawContent.length, images: images.length });
    return parseInstallScreenshotResponse(rawContent);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

- [ ] **Step 2: Verify it type-checks / lints**

Run: `npx eslint src/modules/noc/services/screenshotNoteVlmClient.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/noc/services/screenshotNoteVlmClient.ts
git commit -m "feat(noc): VLM client for multi-image 1map screenshot analysis"
```

---

### Task 4: `POST /api/noc/tickets/[id]/analyze-screenshot` endpoint

Auth → load ticket context → upload screenshots → VLM → compose → post note. Aborts (no note) on any storage/VLM failure.

**Files:**
- Create: `app/api/noc/tickets/[id]/analyze-screenshot/route.ts`

**Interfaces:**
- Consumes: `createTicketNote` (Task 1), `analyzeInstallScreenshots` (Task 3), `composeNoteBody` + `TicketCrossRef` (Task 2); `verifyToken` from `@/lib/auth/jwt`; `vfStorage` from `@/services/vfStorageAdapter`; `pool` from `@/lib/db`; `cookies` from `next/headers`.
- Request body: `{ images: string[] (base64 data URLs), visibility: 'private' | 'public' }`.
- Response: `{ success: true, data: <created note> }` or `{ success: false, error: { message } }`.

- [ ] **Step 1: Write the endpoint**

Create `app/api/noc/tickets/[id]/analyze-screenshot/route.ts`:

```ts
/**
 * POST /api/noc/tickets/[id]/analyze-screenshot
 * Uploads 1map screenshot(s), runs the VLM, and auto-posts a note with the
 * screenshots attached. On any failure NO note is posted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/jwt';
import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';
import { vfStorage } from '@/services/vfStorageAdapter';
import { analyzeInstallScreenshots } from '@/modules/noc/services/screenshotNoteVlmClient';
import { composeNoteBody, type TicketCrossRef } from '@/modules/noc/services/screenshotNoteAnalysis';
import { createTicketNote } from '@/modules/noc/services/ticketNotesService';

const logger = createLogger('noc:analyze-screenshot');
const MAX_IMAGES = 4;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ticketId } = await params;
  try {
    if (!ticketId) {
      return NextResponse.json({ success: false, error: { message: 'Ticket ID is required' } }, { status: 400 });
    }

    const body = await request.json();
    const visibility: 'private' | 'public' = body.visibility === 'public' ? 'public' : 'private';
    const rawImages: unknown = body.images;
    if (!Array.isArray(rawImages) || rawImages.length === 0) {
      return NextResponse.json({ success: false, error: { message: 'At least one image is required' } }, { status: 400 });
    }
    if (rawImages.length > MAX_IMAGES) {
      return NextResponse.json({ success: false, error: { message: `Maximum ${MAX_IMAGES} images per analysis` } }, { status: 400 });
    }
    const dataUrls = rawImages.filter(
      (x): x is string => typeof x === 'string' && x.startsWith('data:image/'),
    );
    if (dataUrls.length === 0) {
      return NextResponse.json({ success: false, error: { message: 'Images must be base64 image data URLs' } }, { status: 400 });
    }

    // Best-effort acting user (created_by is nullable).
    let createdBy: string | null = null;
    try {
      const token = (await cookies()).get('ff_auth_token')?.value;
      if (token) {
        const jwt = await verifyToken(token);
        if (jwt) createdBy = jwt.sub;
      }
    } catch {
      /* unauthenticated context — leave createdBy null */
    }

    // Ticket cross-reference context for the prompt.
    const ctxRows = await pool.query(
      'SELECT dr_number, pole_number, pon_number, ont_serial FROM maintenance_tickets WHERE id = $1',
      [ticketId],
    );
    if (ctxRows.rows.length === 0) {
      return NextResponse.json({ success: false, error: { message: 'Ticket not found' } }, { status: 404 });
    }
    const r = ctxRows.rows[0];
    const ctx: TicketCrossRef = {
      dr_number: r.dr_number ?? null,
      pole_number: r.pole_number ?? null,
      pon_number: r.pon_number ?? null,
      ont_serial: r.ont_serial ?? null,
    };

    // Upload screenshots first; abort (no note) if any upload fails.
    const storageUrls: string[] = [];
    for (let i = 0; i < dataUrls.length; i++) {
      const base64 = dataUrls[i]!.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const uploaded = await vfStorage.uploadFile(
        buffer, 'maintenance', 'ticket-screenshots', `${ticketId}_${Date.now()}_${i}.jpg`,
      );
      storageUrls.push(uploaded.url);
    }

    // VLM analysis over all images at once, then compose the note body.
    const analysis = await analyzeInstallScreenshots(dataUrls, ctx);
    const content = composeNoteBody(analysis, ctx);

    const result = await createTicketNote({
      ticketId,
      content,
      visibility,
      noteType: 'system',
      attachments: storageUrls,
      createdBy,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: { message: result.message } }, { status: result.status });
    }

    logger.info('Posted AI screenshot note', {
      ticketId, noteId: result.note.id, images: storageUrls.length,
      is1map: analysis.is_1map_screenshot, confidence: analysis.confidence,
    });
    return NextResponse.json({ success: true, data: result.note });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const detail = err instanceof Error ? err.message : 'Unknown error';
    logger.error('AI screenshot note failed', { ticketId, error: detail });
    return NextResponse.json(
      {
        success: false,
        error: {
          message: isTimeout
            ? 'VLM analysis timed out — no note was posted.'
            : 'Screenshot analysis failed — no note was posted.',
          details: detail,
        },
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
```

- [ ] **Step 2: Verify it lints / type-checks**

Run: `npx eslint "app/api/noc/tickets/[id]/analyze-screenshot/route.ts"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/noc/tickets/[id]/analyze-screenshot/route.ts"
git commit -m "feat(noc): analyze-screenshot endpoint posts VLM note with attachments"
```

---

### Task 5: `useAnalyzeScreenshotNote` client mutation hook

**Files:**
- Modify: `src/modules/noc/hooks/useTicketNotesWithMutations.ts` (add after the existing `deleteNote` API fn / `useDeleteNote`, before `useTicketNotesOperations` at line 318)

**Interfaces:**
- Produces: `useAnalyzeScreenshotNote(ticketId: string)` → TanStack mutation; `interface AnalyzeScreenshotPayload { images: string[]; visibility: 'private' | 'public'; }`. On success invalidates `ticketNotesKeys.byTicket(ticketId)` so the new note appears.

- [ ] **Step 1: Add the API function** (after `deleteNote`, ~line 170)

```ts
export interface AnalyzeScreenshotPayload {
  images: string[]; // base64 data URLs
  visibility: 'private' | 'public';
}

async function analyzeScreenshotNote(
  ticketId: string,
  payload: AnalyzeScreenshotPayload,
): Promise<TicketNote> {
  const response = await fetch(`/api/noc/tickets/${ticketId}/analyze-screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Analysis failed (${response.status})`);
  }
  const result = await response.json();
  if (!result.success) throw new Error(result.error?.message || 'Analysis failed');
  return result.data;
}
```

- [ ] **Step 2: Add the hook** (after `useDeleteNote`, ~line 303)

```ts
/**
 * Hook to analyze screenshot(s) with the VLM and auto-post the resulting note.
 */
export function useAnalyzeScreenshotNote(ticketId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AnalyzeScreenshotPayload) => analyzeScreenshotNote(ticketId, payload),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ticketNotesKeys.byTicket(ticketId) });
      logger.info('AI screenshot note posted', { ticketId, noteId: note.id });
    },
    onError: (error: Error) => {
      logger.error('Failed to post AI screenshot note', { ticketId, error: error.message });
    },
  });
}
```

- [ ] **Step 3: Verify it lints**

Run: `npx eslint src/modules/noc/hooks/useTicketNotesWithMutations.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/noc/hooks/useTicketNotesWithMutations.ts
git commit -m "feat(noc): useAnalyzeScreenshotNote mutation hook"
```

---

### Task 6: `ScreenshotAnalyzer` component (drop / paste / browse → analyze & post)

**Files:**
- Create: `src/modules/noc/components/TicketDetail/ScreenshotAnalyzer.tsx`

**Interfaces:**
- Consumes: `resizeImage` from `../TicketForm/sections/screenshotUtils`; `useAnalyzeScreenshotNote` (Task 5); `InlineSpinner` from `@/components/ui/LoadingSpinner`.
- Produces: `ScreenshotAnalyzer({ ticketId, visibility }: { ticketId: string; visibility: 'private' | 'public' })`.

- [ ] **Step 1: Write the component**

Create `src/modules/noc/components/TicketDetail/ScreenshotAnalyzer.tsx`:

```tsx
'use client';

import { useCallback, useRef, useState } from 'react';
import { resizeImage } from '../TicketForm/sections/screenshotUtils';
import { useAnalyzeScreenshotNote } from '../../hooks/useTicketNotesWithMutations';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

const MAX_IMAGES = 4;

interface ScreenshotAnalyzerProps {
  ticketId: string;
  visibility: 'private' | 'public';
}

export function ScreenshotAnalyzer({ ticketId, visibility }: ScreenshotAnalyzerProps) {
  const [images, setImages] = useState<string[]>([]); // base64 data URLs
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyze = useAnalyzeScreenshotNote(ticketId);

  const addFiles = useCallback(async (files: File[]) => {
    setError(null);
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    try {
      const resized = await Promise.all(imageFiles.map((f) => resizeImage(f)));
      setImages((prev) => [...prev, ...resized].slice(0, MAX_IMAGES));
    } catch {
      setError('Could not read one of the images.');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  const removeImage = (i: number) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const runAnalysis = () => {
    if (images.length === 0 || analyze.isPending) return;
    setError(null);
    analyze.mutate(
      { images, visibility },
      {
        onSuccess: () => setImages([]),
        onError: (e) => setError(e instanceof Error ? e.message : 'Analysis failed'),
      },
    );
  };

  return (
    <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)]">
      <p className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
        AI screenshot analysis
      </p>

      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onPaste={handlePaste}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDrop={handleDrop}
        className={`rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent-primary)] ${
          isDragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
        }`}
      >
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Drop, paste (Ctrl+V), or click to add 1map screenshots
        </p>
        <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
          Up to {MAX_IMAGES} images · the VLM reads them and posts a {visibility} note
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      </div>

      {images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`screenshot ${i + 1}`} className="h-20 w-20 object-cover rounded border border-[var(--ff-border-light)]" />
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center"
                title="Remove"
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-3">
        <button
          type="button"
          onClick={runAnalysis}
          disabled={images.length === 0 || analyze.isPending}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
        >
          {analyze.isPending ? (
            <>
              <InlineSpinner size="sm" />
              Analyzing…
            </>
          ) : (
            `Analyze & post note${images.length ? ` (${images.length})` : ''}`
          )}
        </button>
      </div>
    </div>
  );
}

export default ScreenshotAnalyzer;
```

- [ ] **Step 2: Verify it lints**

Run: `npx eslint src/modules/noc/components/TicketDetail/ScreenshotAnalyzer.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/noc/components/TicketDetail/ScreenshotAnalyzer.tsx
git commit -m "feat(noc): ScreenshotAnalyzer upload/paste/analyze component"
```

---

### Task 7: Extract `NoteCard` (with attachments + AI badge) and wire `NotesTab`

Extract `NoteCard` from `NotesTab.tsx` into its own file (keeps `NotesTab` under the size limit), add attachment thumbnail rendering and an AI badge, and render `ScreenshotAnalyzer` inside the note composer so it shares the Private/Public toggle.

**Files:**
- Create: `src/modules/noc/components/TicketDetail/NoteCard.tsx`
- Modify: `src/modules/noc/components/TicketDetail/NotesTab.tsx` (remove inline `NoteCard` at lines 314-417; add two imports; render `<ScreenshotAnalyzer>` inside the composer)

**Interfaces:**
- Consumes: `TicketNote` from `../../hooks/useTicketNotesWithMutations`.
- Produces: `NoteCard({ note, onDelete, isDeleting, formatDate })`.

- [ ] **Step 1: Create `NoteCard.tsx`**

Create `src/modules/noc/components/TicketDetail/NoteCard.tsx` (the existing card markup plus an AI badge and an attachments thumbnail row):

```tsx
'use client';

import type { TicketNote } from '../../hooks/useTicketNotesWithMutations';

interface NoteCardProps {
  note: TicketNote;
  onDelete: () => void;
  isDeleting: boolean;
  formatDate: (date: string) => string;
}

export function NoteCard({ note, onDelete, isDeleting, formatDate }: NoteCardProps) {
  const isPrivate = note.visibility === 'private';
  const isAi = note.content.startsWith('🤖');

  return (
    <div className="p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Header badges */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                isPrivate
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-green-500/20 text-green-400 border border-green-500/30'
              }`}
            >
              {isPrivate ? 'Private' : 'Public'}
            </span>

            {isAi && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                🤖 AI
              </span>
            )}

            {note.is_resolution && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                Resolution
              </span>
            )}

            <span className="text-xs text-[var(--ff-text-tertiary)]">
              {formatDate(note.created_at)}
            </span>
          </div>

          {/* Content */}
          <p className="text-[var(--ff-text-primary)] whitespace-pre-wrap break-words">
            {note.content}
          </p>

          {/* Attachment thumbnails */}
          {note.attachments && note.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {note.attachments.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" title="Open full size">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`attachment ${i + 1}`}
                    className="h-24 w-24 object-cover rounded border border-[var(--ff-border-light)] hover:opacity-90"
                  />
                </a>
              ))}
            </div>
          )}

          {/* Author */}
          {note.author_name && (
            <p className="mt-2 text-xs text-[var(--ff-text-tertiary)]">
              By {note.author_name}
              {note.updated_at !== note.created_at && (
                <span className="ml-2">(edited {formatDate(note.updated_at)})</span>
              )}
            </p>
          )}
        </div>

        {/* Delete */}
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"
          title="Delete note"
          type="button"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default NoteCard;
```

- [ ] **Step 2: Update `NotesTab.tsx` imports**

In `src/modules/noc/components/TicketDetail/NotesTab.tsx`, after the existing imports (around line 25), add:

```ts
import { NoteCard } from './NoteCard';
import { ScreenshotAnalyzer } from './ScreenshotAnalyzer';
```

And delete the inline `interface NoteCardProps { ... }` + `function NoteCard(...) { ... }` block (lines 314-417). Keep `export default NotesTab;`.

- [ ] **Step 3: Render `ScreenshotAnalyzer` inside the composer**

In `NotesTab.tsx`, inside the `{isAddingNote && ( ... )}` form, immediately AFTER the closing `</p>` of the visibility hint (the paragraph ending at line 272, before the `</div>` that closes the `space-y-3` wrapper), insert:

```tsx
            <ScreenshotAnalyzer ticketId={ticketId} visibility={newNoteVisibility} />
```

- [ ] **Step 4: Verify it lints**

Run: `npx eslint src/modules/noc/components/TicketDetail/NoteCard.tsx src/modules/noc/components/TicketDetail/NotesTab.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/noc/components/TicketDetail/NoteCard.tsx \
  src/modules/noc/components/TicketDetail/NotesTab.tsx
git commit -m "feat(noc): render note attachments + AI badge; wire ScreenshotAnalyzer into composer"
```

---

### Task 8: End-to-end verification (CI + live dev + DB readback)

No new code — prove the feature works against the real screenshots and confirm the `text[]` write lands correctly in the live DB.

- [ ] **Step 1: Full unit suite for the new modules**

Run: `npx vitest run src/modules/noc/__tests__/services/ticketNotesService.test.ts src/modules/noc/__tests__/services/screenshotNoteAnalysis.test.ts`
Expected: all PASS.

- [ ] **Step 2: Lint gates**

Run: `npm run ci:quick`
Expected: passes (no new lint-ratchet regressions). Fix any reported issues before proceeding.

- [ ] **Step 3: Deploy to dev**

Run: `bash scripts/deploy-local.sh dev`
Expected: health check passes; `dev.fibreflow.app` serves.

- [ ] **Step 4: Manual / Playwright check on dev with the real DR1746579 screenshots**

On `dev.fibreflow.app/noc/tickets/<a ticket with dr_number DR1746579>` → Notes tab → click **Add Note** → set Private → in the **AI screenshot analysis** zone, paste the two 1map screenshots (the photo-columns view and the attributes/status view) → click **Analyze & post note**.

Assert:
- A new note appears, marked `🤖 AI`, content reads approximately *"No photos uploaded; drop still at Pole Permission, home installation not yet recorded."* with a `Photos: 0/8 uploaded` line, `Status: Pole Permission: Approved`, and `DR: DR1746579 ✓ matches ticket`.
- The two screenshots render as thumbnails on the note and open full-size when clicked.
- The note's visibility badge matches the toggle you set (Private).
- Repeat once with the toggle set to Public → confirm the note posts Public (and, if QContact is reachable, that `pushNote` logged a sync).

- [ ] **Step 5: Confirm the `text[]` write in the live DB**

Read back the note row (connection string in `.claude/credentials.local.md`):

Run: `psql "$PGCONN" -c "SELECT id, note_type, visibility, attachments FROM maintenance_notes WHERE content LIKE '🤖%' ORDER BY created_at DESC LIMIT 1;"`
Expected: `attachments` prints as a Postgres array `{/storage/...,/storage/...}` (NOT a JSON string `["..."]`), `note_type = system`.

- [ ] **Step 6: Verify the manual (non-AI) note path still works**

On the same ticket, type a normal note in the textarea and click **Save Note**. Confirm it posts (Private), proving the Task 1 POST refactor didn't regress manual notes.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/noc-vlm-screenshot-note
gh pr create --title "feat(noc): VLM screenshot-to-note on tickets" \
  --body "Upload/paste 1map screenshots in a NOC ticket's Notes tab; the VLM reads them, cross-checks the ticket, and auto-posts a note with the screenshots attached. Spec: docs/superpowers/specs/2026-06-27-noc-vlm-screenshot-note-design.md"
```

---

## Self-Review Notes

- **Spec coverage:** auto-post (Task 4 posts directly), 1map-aware + cross-check (Tasks 2-3 prompt embeds ticket ctx + mismatches), attach & thumbnail (Tasks 4 upload + 7 render), visibility=form toggle (Task 7 passes `newNoteVisibility`), ≤4 images (Tasks 4/6), never-fabricate (Task 4 abort paths), component extraction (Tasks 6-7), tests (Tasks 1-2 + Task 8). All spec risks addressed: attachments `text[]` write (Task 1 + Step 5 readback), App-Router body size (client resize + ≤4 images keeps payload ~1-2 MB), SSRF (base64 to VLM, `/storage/` proxy-relative URLs from `vfStorage.uploadFile`), cross-ref source (`maintenance_tickets.dr_number/pole_number/pon_number/ont_serial`).
- **Fallback (note for implementer):** if Step 5 shows a malformed `attachments` value, the `pg` array param failed — build the literal explicitly: `'{' + arr.map((u) => '"' + u.replace(/"/g, '\\"') + '"').join(',') + '}'` and pass that string. (Not expected; `pg` serialises JS arrays to `text[]` natively.)
</content>
