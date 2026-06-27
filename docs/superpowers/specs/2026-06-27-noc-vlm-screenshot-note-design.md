# VLM Screenshot-to-Note for NOC Tickets — Design

**Date:** 2026-06-27
**Branch:** `feat/noc-vlm-screenshot-note`
**Status:** Approved design → ready for implementation plan

## Problem

On a NOC ticket detail page (`/noc/tickets/[id]` → **Notes** tab), a tech or admin
investigating a drop often pastes a screenshot from **1map** (the "fibertime
Installation" layer) to judge install state: are all the photos uploaded, is the
drop in the wrong status, does the DR/serial match. Today they read the screenshot
by eye and type a note manually (e.g. *"There are no photos uploaded, the drop is
still showing pole permissions, home installation not yet recorded."*).

We want to let them **upload/paste the screenshot(s) and have the VLM (Qwen3-VL)
read them, cross-check against this ticket, and auto-post that note** — with the
screenshot attached as evidence.

## Decisions (locked with Hein, 2026-06-27)

| Decision | Choice |
|---|---|
| Note creation | **Auto-post** — no edit-the-text gate. Explicit "Analyze & post" trigger button. |
| Analysis intelligence | **1map-aware + cross-check this ticket** (DR / pole / PON / serial). |
| Screenshot storage | **Attach & show thumbnail** on the note (VF Storage). |
| Visibility | **Match the form's current Private/Public toggle.** Public ⇒ pushed to QContact (customer-facing) as today. |
| Images per analysis | **Up to 4** combined into one note. |

## Existing infrastructure reused

- **Notes UI:** `src/modules/noc/components/TicketDetail/NotesTab.tsx` (the textarea +
  Private/Public toggle + Save Note form). `NoteCard` within it renders notes but
  **does not currently render `attachments`** — that gets added.
- **Create-note API:** `app/api/noc/tickets/[id]/notes/route.ts` `POST` already accepts
  and persists `attachments: string[]` and handles the QContact `pushNote` for public
  notes. This logic gets **extracted into a shared `createTicketNote()` service** so the
  new endpoint and the manual form share one code path.
- **VLM client/config:** `src/lib/vlm/config.ts` (`VLM_CHAT_ENDPOINT`,
  `VLM_EXTRACTION_MODEL`, `stripThinkTags`, timeouts, token budgets). Closest precedent:
  `pages/api/noc/devops-vlm-analyse.ts` + `src/modules/noc/components/TicketForm/sections/useScreenshotUploader.ts`
  (paste/drag-drop screenshot → resize → VLM → parse JSON). We model on it but keep the
  new endpoint in the App-Router notes domain.
- **Client resize/paste:** `src/modules/noc/components/TicketForm/sections/screenshotUtils.ts`
  (`resizeImage` → 1280px JPEG @0.85) and the paste/drop handlers in `useScreenshotUploader.ts`.
- **Storage:** `attachmentService.uploadAttachment()` / `vfStorage.uploadFile()` →
  public `/storage/...` URL (passes `isAllowedPhotoUrl` SSRF guard).

## Architecture

**New App-Router endpoint:** `app/api/noc/tickets/[id]/analyze-screenshot/route.ts`
performs upload → VLM → note-create atomically, behind the same auth wrapper as the
sibling notes routes.

*Alternative considered & rejected:* extending `pages/api/noc/devops-vlm-analyse.ts`.
That endpoint is bug-ticket-shaped (returns form fields, pages-router); the notes
domain is App-Router. Keeping them separate is cleaner and avoids coupling.

### Data flow

1. **Client** (`ScreenshotAnalyzer.tsx`, new): user drags/drops/browses/**pastes** up to
   4 screenshots → each resized client-side to 1280px JPEG (`resizeImage`) → thumbnails
   staged → **"Analyze & post"** button (disabled until ≥1 staged; spinner while running).
   The resulting note's visibility = the current Private/Public toggle in `NotesTab`.
2. **Endpoint:**
   a. Upload each image to VF Storage (`attachmentService` / `vfStorage.uploadFile`) →
      `/storage/...` URLs. On any upload failure → abort, return error (no orphan note).
   b. Load this ticket's cross-reference context from the DB: DR number, pole, zone, PON,
      site, and serial if present (the same data the "FibreFlow Cross-Reference" panel shows).
   c. Build the **1map-aware prompt** (below) embedding that context.
   d. Call Qwen3-VL: one multimodal message with the text prompt + N `image_url` entries
      carrying the **base64 data URLs** (sidesteps the `isAllowedPhotoUrl` SSRF guard;
      images are already resized client-side), `VLM_EXTRACTION_MODEL`,
      `max_tokens: 2048`, `temperature: 0.1`, `AbortController` @ ~90s.
   e. Parse: `stripThinkTags` → strip markdown fences → `JSON.parse` (reuse the existing
      parse-helper pattern).
   f. Compose the note body from the parsed result (below).
   g. Call `createTicketNote()` with `note_type:'system'`, `attachments:[storageUrls]`,
      `visibility` from the request → inserts `maintenance_notes`; if public, the shared
      service runs the existing `pushNote` to QContact.
   h. Return the created note row so the client appends it to the list.
3. **`NoteCard`** gains: thumbnail rendering for `attachments` (click → full-size in new
   tab/lightbox) and a 🤖 **"AI analysis"** badge so an occasional misread is obvious and
   deletable via the existing delete-note API.

### Component extraction (file-size hygiene)

`NotesTab.tsx` is already ~419 lines (over the 300 guideline). To avoid growing it:
- New **`ScreenshotAnalyzer.tsx`** owns the upload/paste/analyze UI.
- Extract **`NoteCard`** into its own file if it isn't already, where attachment
  rendering lives.
`NotesTab.tsx` stays the composition point and should shrink, not grow.

## The prompt (heart of the feature)

Single user-message prompt (Qwen3-VL convention, no separate system role), embedding the
ticket context, ending with "Return ONLY valid JSON, no markdown fences." It instructs
the VLM to:

- Determine whether this is a 1map "fibertime Installation" screenshot.
- For each **photo column** (e.g. *Photo of the Dome, Home Entry Point, Outside cable
  span, ONT Barcode, Mini-UPS Serial No, …*) decide image-present vs **`NO IMAGE`** →
  compute uploaded/total and list the missing ones.
- Read and **interpret the Status** (e.g. *"Pole Permission: Approved" ⇒ still at
  pole-permission stage; home installation not yet recorded*).
- Read visible identifiers: DR number, ONT barcode/serial, pole, PON, site, sections.
- **Cross-check against the ticket context** (DR/pole/PON/serial passed in) and list any
  mismatches explicitly.
- Produce a 1–3 sentence `summary` written like a human tech note.

### Output schema

```json
{
  "is_1map_screenshot": true,
  "dr_number": "DR1746579",
  "status": "Pole Permission: Approved",
  "status_interpretation": "Still at pole-permission stage; home installation not recorded",
  "photos": { "total": 8, "uploaded": 0, "missing": ["Photo of the Dome", "Home Entry Point", "..."] },
  "serial": "ALCLB491D094",
  "pole": "LAW.P.B799",
  "pon": "92",
  "site": "LAW",
  "mismatches": ["Ticket expects Home Installation but 1map shows Pole Permission"],
  "summary": "No photos uploaded; drop still at Pole Permission, home installation not yet recorded.",
  "confidence": "high"
}
```

### Note body composition (server-side)

```
🤖 AI screenshot analysis

No photos uploaded; drop still at Pole Permission, home installation not yet recorded.

Photos: 0/8 uploaded · Status: Pole Permission: Approved
DR: DR1746579 ✓ matches ticket · Serial: ALCLB491D094
⚠ Ticket expects Home Installation but 1map shows Pole Permission
(confidence: high)
```

`summary` is the lead; the compact checks/mismatch block follows. Thumbnails of the
uploaded screenshots render under the note via `attachments`.

## Error handling

- **VLM timeout / unreachable / unparseable JSON** → **no note posted**; return an error
  the client shows as a toast. Never fabricate a note.
- **Storage upload failure** → abort before VLM; no orphan note referencing a missing image.
- **Not a 1map screenshot** (`is_1map_screenshot:false`) → still post the note using the
  generic `summary`, but skip the photo/status/mismatch checks block.
- Every AI note carries the 🤖 marker + `note_type:'system'` so a wrong note is identifiable
  and removable.

## Testing

- **Unit:** prompt-parser (think-tag strip, fence strip, JSON extraction, mismatch
  detection) against fixture VLM responses; `createTicketNote()` service (insert shape +
  public⇒pushNote path).
- **Manual / Playwright on dev:** paste the real **DR1746579** screenshots (the two 1map
  views) into a test ticket → assert the posted note reads ≈ *"no photos uploaded, still
  pole permission"*, thumbnails render, visibility matches the toggle. UI change ⇒ browser
  verification, not code-review alone (CLAUDE.md hard rule 4).
- **VLM accuracy spot-check:** the two example screenshots are the golden case.

## Open risks / verification before/early in implementation

1. **`maintenance_notes.attachments` column type.** The add-migration isn't discoverable
   in-repo; confirm the live column exists and its type (text vs jsonb) via `\d
   maintenance_notes` before relying on `JSON.stringify(attachments)`. The current POST
   handler already writes it, which is strong evidence it exists — but verify.
2. **App-Router body size** for multiple base64 images. Client resize keeps each ~a few
   hundred KB; with ≤4 images the JSON payload is ~1–2 MB. If App-Router default limits
   bite, switch the upload leg to `multipart/form-data` (matches the attachments route).
3. **SSRF guard:** if images are re-sent to the VLM by stored URL, they must pass
   `isAllowedPhotoUrl` (`/storage/...` same-origin). Sending base64 sidesteps this.
4. **Ticket cross-ref source:** confirm where DR/pole/PON/serial are queryable per ticket
   (the Cross-Reference panel's data source) to feed prompt context.

## Out of scope (YAGNI)

- No draft/edit-before-post flow (Hein chose auto-post).
- No general document OCR beyond 1map install screenshots (generic `summary` fallback only).
- No batch/queue processing — this is interactive, one analysis per click.
- No new VLM model or accuracy-learning loop wiring.
