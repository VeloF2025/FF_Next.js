# SiteCam Appeals — Failed Tab & Clickable Drop Numbers

**Date:** 2026-06-11
**Status:** Approved by Zander (Approach A)

## Problem

When a SiteCam technician's step photo fails VLM validation 3 times, the PWA already
reports the failure to `pwa_escalations` (via `POST /api/sitecam/escalate`, with all
attempt photos and fail reasons), but nothing on the SiteCam Appeals page
(`pages/activate/sitecam-appeals.tsx`) displays these. Reviewers cannot see 3-strike
failures unless the technician chooses to appeal.

Separately, on the existing appeal cards the drop number is plain text; the expand
affordance is a chevron on the row. The drop number should be the visible click
target that reveals the photo(s).

## Scope

Two changes, both confined to the FibreFlow web app (no PWA changes, no schema
changes):

### 1. "Failed" tab on the SiteCam Appeals page

- Add a fourth tab **Failed** after Pending / Approved / Denied in
  `src/modules/activate/components/SiteCamAppealsQueue.tsx`.
- The tab lists `pwa_escalations` rows: drop number or civil pole ID (`site_id`),
  step number + label, technician name, created date, and status.
- Within the Failed tab, a sub-filter toggles **Pending** (unresolved, default) and
  **Resolved** escalations.
- Clicking the drop number expands the card inline showing **all attempt photos**
  (each with its attempt number and fail reasons).
- Actions on a pending escalation (manager+ role, matching the existing resolve
  endpoint's RBAC):
  - **Approve** — overrides the failure; calls
    `POST /api/sitecam/escalation-resolve` with `resolution: 'approved'`.
  - **Reject** — requires a note (recorded against the technician); same endpoint
    with `resolution: 'rejected'`.
- Resolved escalations show the resolution, resolver, and note; no actions.

### 2. Clickable drop numbers

- In both the appeal tabs and the new Failed tab, style the drop number as a link
  (color + underline on hover) so it reads as the click target.
- Clicking it expands the card inline (existing expand-in-place pattern) showing
  the photo(s) and details. The rest of the row remains clickable as today.

## New API

`GET /api/activate/sitecam-failed?status=pending|resolved`

- Reads `pwa_escalations` joined to staff for `tech_name`.
- Returns: `id, job_type, site_id, step_number, tech_name, fail_reasons,
  attempt_photos (array of {attempt, url, reasons}), status, created_at,
  resolved_by_name, resolved_at, resolution_note`.
- Auth + RBAC identical to the existing `GET /api/activate/sitecam-appeals`
  endpoint (same page, same audience).
- Flattened route per project conventions; ordered newest first; `status`
  defaults to `pending`.

Existing endpoints reused unchanged:
- `POST /api/sitecam/escalation-resolve` (approve/reject + note, manager+).

## Data flow

1. Tech fails a step 3× in the PWA → PWA posts to `/api/sitecam/escalate` →
   `pwa_escalations` row (status `pending`). **Already implemented.**
2. Failed tab polls/loads via the new `sitecam-failed` endpoint → row appears
   with clickable drop number.
3. Reviewer expands, inspects all attempt photos, approves or rejects with note →
   `escalation-resolve` updates the row → it moves to the Resolved sub-filter.
4. Appeals continue to flow exactly as today: appeal → Pending tab → approve/deny.

## Edge case: appeal + escalation for the same step

A tech who fails 3× and then appeals produces both an escalation (Failed tab) and
an appeal (Pending tab). **Both stay visible** — the escalation is the
accountability trail; the appeal is the technician's case. No linking or
deduplication in this iteration.

## Error handling

- Failed-tab load errors: logged via `@/lib/logger`, empty-state message shown
  (matches existing queue behaviour).
- Resolve failures (e.g. already resolved by someone else → 404): surface a brief
  inline error and reload the list.
- Photo URLs are already restricted to VF Storage origins at escalation write time
  (`isAllowedPhotoUrl`); render as-is.

## Testing

- Unit tests for the new API handler: status filtering, response shape, method
  guard, RBAC wrapper presence.
- Component test for the Failed tab: renders escalation rows, expands on drop
  number click, shows all attempt photos, approve/reject wiring, note required
  for reject.
- Manual verification with the seeded test fixtures: fail a step 3× on a test DR
  (`9999990`–`9999994`) in the PWA, confirm the row appears in the Failed tab,
  approve/reject it. (Reset between runs with `sitecam-reset.sql`.)

## Out of scope

- PWA changes (escalation reporting already works).
- Schema changes / migrations.
- Notifications outside the Appeals page (no email/WhatsApp).
- Linking appeals to their escalations.
