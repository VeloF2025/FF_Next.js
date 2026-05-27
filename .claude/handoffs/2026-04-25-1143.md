# Handoff — 2026-04-25 11:43 SAST

**Project:** FF_Next.js (FibreFlow Next.js)
**Branch:** master (clean — main checkout untouched all session, work happened in worktrees)
**Master tip:** `d596fe897` (in production)
**Session goal:** Build a /my staff PWA (PRD-040) end-to-end across 4 phases, then add receipt scanning on top.

## Status

PRD-040 plus the receipts feature are **fully merged on master and live in production** at https://app.fibreflow.app. Field staff can sign in to `/my`, see a hub tile grid (Clock / My Vehicle / Payslips / Receipts / Corrections / History), capture any receipt with their phone camera → Qwen3-VL OCR extracts vendor / total / VAT / date / line items / category guess → review + edit + save. POPIA-style server-proxy downloads, GPS captured at scan time, vehicle auto-tagged when active assignment exists. **What is NOT yet built: the HR / finance review queue at `/staff/receipts` (Phase 2 of receipts).** Today only the staff who captured a receipt can see it.

## What got done this session

PRs (all merged into master):

- **#1463** — PRD-040 docs (`docs/PRDs/PRD-040-unified-staff-portal.md` + plan)
- **#1465** — PWA service worker + manifest for `/my`
- **#1466** — Tile-grid hub at `/my` + `/api/my/hub-summary` aggregator
- **#1467** — Add-to-home-screen install prompt (Android programmatic + iOS Share-menu instructions)
- **#1468** — Fleet SSO bridge: `/my/fleet-handoff` mints a real `ff_portal_session`; chrome unification + dark palette on `/fleet/portal`; plate scan retained for SSO users as presence + GPS proof
- **#1469** — Payslips schema: migration `326_payslips.sql`, RBAC seed (`payslips.import` permission), `src/modules/payslips/queries.ts`
- **#1470** — Staff `/my/payslips` viewer + hub tile + server-proxy download endpoint
- **#1471** — HR `/staff/payslips/import` (CSV+PDF preview & commit)
- **#1472** — WCAG tap-target sweep (≥48px floor) + Sign-out button restructure
- **#1473** — Recovery merge (the 1466–1472 stack squashed into stack bases instead of master originally)
- **#1474** — Receipts schema: migration `328_staff_receipts.sql`, `RECEIPT_CATEGORIES` constant, `RECEIPT_PROMPT`, `parseReceiptVlmResponse`, queries module
- **#1476** — Receipts staff capture flow (recovery merge, since #1475 squashed into its stack base): `/api/my/receipts/{extract,save,list,download,edit}`, `/my/receipts`, `/my/receipts/new`, `/my/receipts/[id]`, MyHub Receipts tile, footer nav 4-col

Schema migrations applied to dev/prod (single shared Supabase):
- `326_payslips.sql` + follow-up `327_payslips_imported_by_users.sql` (FK fix: `imported_by` → `users(id)`, not `staff(id)`)
- `328_staff_receipts.sql`

Bugs found and fixed live (each by surfacing diagnostics in the response, then reverting):
- Payslips: `imported_by` FK pointed at `staff(id)` but `withAuth` exposes `users(id)` → migration 327
- Payslips: pg `DATE` columns serialized as UTC midnight, shifting day in SAST → projected via `to_char(col, 'YYYY-MM-DD')` in queries
- Fleet handoff: `'sso:my:<UUID>'` marker overflowed `plate_scanned VARCHAR(20)` → trimmed to `'sso:my'`
- Fleet handoff: SQL JOINed via `va.vehicle_id` but the column is `vehicle_registration` → JOIN on `v.registration = va.vehicle_registration`
- Logout from `/my` (post-hub) was a no-op because `router.push('/my')` doesn't remount the page → `window.location.assign('/my')` instead
- `/fleet/portal` `handleReset` couldn't see `source: 'my'` → plate-auth response now includes source; hook's setSession copies it; signout from fleet correctly bounces SSO users back to `/my`
- **Receipts OCR: VLM hit 404 on every fetch** because `vfStorage.uploadFile(file, 'staff', '<staffId>/receipts', ...)` URL-encodes the slash in `category`, files landed at one path on disk but URL said another → flattened to single-level `staff/receipts/<staffId>__<uuid>.jpg`

Live OCR verified on 3 real receipts (Taso's Bar & Grill R1300, The Goat and Co R809, UC Jacaranda R254.10) — all parsed correctly with vendor, total, VAT, date, line items, category=food, confidence 0.95.

Out of scope but called out:
- Restaurant-slip + tip-card-slip = 2 photos for 1 dinner. Today they'd be 2 separate rows. Phase 2 candidate: multi-photo per receipt + a tip column.
- PDF receipts: file picker accepts them but `serverExtraction` doesn't run `convertPdfToImage` yet — only JPEG-optimised. Use `src/services/ocr/imageProcessingService.convertPdfToImage` when needed.

## What's next

1. **Build PR3 of receipts: HR/finance review queue at `/staff/receipts`.**
   - List all submitted receipts across staff (gated by `receipts.review` permission — RBAC already seeded in migration 328)
   - Filters: staff, project, category, status, month
   - Approve / reject / reconcile actions
   - Export CSV for accounting reconciliation
   - Cross-link from `pages/staff/[id].tsx` to "this staff member's receipts"
   - Mirror the structure of `pages/staff/payslips/import.tsx` for consistency
2. After PR3 merges, decide whether to enable the multi-photo-per-receipt Phase 2 (restaurant + tip card use case).
3. Phase 4 polish that's still rolling on PRD-040: WCAG AA contrast audit, real PWA install QA on iOS Safari + Android Chrome.

## Open questions / blockers

- **Multi-photo per receipt** — Hein wants this *eventually* for restaurant+tip case, but it's a schema migration (drop `image_url` single col → `staff_receipt_images` join table) plus a tip-amount column. Defer until Phase 2 review queue is ergonomically used and finance feels the pain.
- **Project picker on capture** — schema column `project_id` exists on `staff_receipts`, but the `/my/receipts/new` form doesn't render a picker yet. Hein's plan answer was "optional, both project + vehicle". Vehicle is auto-tagged at save time; project picker is a follow-up.
- **Edit-after-submit** — confirmed editable while `status='submitted'`; locks once finance approves. Implemented in `/api/my/receipts/[id]/edit` and `/my/receipts/[id]`. Phase 2 review queue is what flips status.
- **Accounting integration with `/api/accounting/bank-match-fleet.ts`** — left for Phase 3.

## Context the next session needs

**WORKTREE RULE (mandatory):** All work on FF_Next.js MUST happen in a worktree, never in the main `/home/hein/Workspace/FF_Next.js` checkout. The OpenClaw agent fleet hard-resets that tree to master periodically. Hein has hard guards via a hook (`ff-next-worktree-guard.sh`) that block writes there — including writes to `.claude/handoffs/` in the main checkout. This handoff was written from a worktree, committed, and pushed so master receives it.

**Two repeating gotchas this session:**

1. **GitHub squash-merge of stacked PRs.** When you stack PR B onto PR A and call `gh pr merge B --squash`, GitHub sometimes squashes B into branch-A (its stack base) NOT into master, even after the base looks merged. Recovery pattern: open a fresh PR from the latest stack tip directly to master. Done twice this session (#1473 and #1476).

2. **OCR storage path.** `vfStorageAdapter.uploadFile(file, type, category, fileName)` URL-encodes the `category` param. Slashes inside category turn into `%2F` on disk but stay as `/` in the returned URL. Always pass single-level categories; encode hierarchy in the filename.

**VLM endpoint is live and read-tested in production:** `http://100.96.203.105:8100/v1/chat/completions`, model `QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ`. The receipts module calls it directly via `fetch` with `RECEIPT_PROMPT` from `src/modules/receipts/extraction.ts`.

**Database is single-shared Supabase** (Velocity, port 5437). Dev = prod. Migration runner needs `MIGRATION_DATABASE_URL` (postgres superuser); the app's `DATABASE_URL` lacks CREATE TABLE. Both are in `/home/velo/fibreflow-dev/.env.local`. CLAUDE.md is stale on this — it still says Neon.

**The /my portal needs hard reload, not router.push, for sign-in/out.** When you're already at /my, `router.push('/my')` is a no-op and React doesn't re-mount → session-fetch effect doesn't re-run. Always `window.location.assign('/my')` after login/logout actions on that route.

**Live diagnostic pattern that worked 4× this session:**
- Wrap the failing endpoint's response with a temporary `details.reason` field exposing the raw error
- Hit it via Playwriter network capture (not console — the project's logger writes to `window.__appLogs`, not `console.log`)
- See the actual root cause (FK name, column name, VLM 404 URL, etc.)
- Fix
- Revert the diagnostic surface

**Worktrees still on disk** (none with uncommitted work; all merged via PR):
- `/home/hein/Workspace/FF_Next.js-receipts-schema` — feature/receipts-schema (merged via #1474)
- `/home/hein/Workspace/FF_Next.js-receipts-staff` — feature/receipts-staff (merged via #1476) — this handoff was written here
- Plus 5 unrelated worktrees from other workstreams (ts-fixer, neon-serverless, etc.) — leave alone.

## Git state

- **Uncommitted (main checkout):** Only `.claude/*` session files + various untracked report PNGs/PDFs predating this session. Nothing to commit on master.
- **Unpushed commits on master:** none (origin/master at `d596fe897` matches local).
- **Stashes:** 118 — all from prior workstreams, predate this session, unrelated to PRD-040 / receipts. Do not touch.

## Where to resume

```
cat /home/hein/Workspace/FF_Next.js/.claude/handoffs/LATEST.md
```

Then to start receipts PR3 (HR review queue):
```bash
git fetch origin master --quiet
git worktree add /home/hein/Workspace/FF_Next.js-receipts-review \
  -b feature/receipts-review origin/master
cd /home/hein/Workspace/FF_Next.js-receipts-review
npm install --prefer-offline --no-audit --no-fund
```

Read `pages/staff/payslips/import.tsx` and `pages/api/staff/payslips/import.ts` first — the receipts review page should mirror that structure, gated by `receipts.review` permission (already seeded in migration 328). The `staff_receipts.status` column moves from `'submitted'` → `'approved' | 'rejected' | 'reconciled'`; once it leaves `submitted` the staff-side `/api/my/receipts/[id]/edit` already locks editing.

Reference docs:
- `/home/hein/.claude/plans/i-want-to-expand-moonlit-biscuit.md` — the approved receipts plan (Phase 1 is shipped; Phase 2 review queue is next)
- `docs/PRDs/PRD-040-unified-staff-portal.md` — the parent PRD
- `.claude/CLAUDE.md` — project rules (worktree mandatory, deploy script always, after-hours prod)
