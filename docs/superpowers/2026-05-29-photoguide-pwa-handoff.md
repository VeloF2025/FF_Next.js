# PhotoGuide PWA — Session Handoff (updated end-of-day)
> **Date:** 2026-05-29
> **Continue with:** Wait for PR #1828 to be approved and merged by Hein, deploy to dev, then start Sub-project B
> **Plans:** `docs/superpowers/plans/2026-05-28-fibreflow-pwa-api.md` (done) · `docs/superpowers/plans/2026-05-28-photoguide-pwa.md` (next)

---

## What We Did Today

### 1. Executed Sub-project A: FibreFlow PhotoGuide API (PR #1828 open)
All 7 API routes + DB migration 247 + 2 UI additions on `feature/pwa-fibreflow-api`:

**Migration 247** (already applied to shared DB — do NOT re-run):
- `pwa_escalations` table (step failures after 3 attempts, supervisor approve/reject)
- `pwa_photo_hashes` table (SHA-256 dedup — prevents photo reuse across retries)
- PWA columns on `dr_photo_unified_reviews`: `pwa_submission_at`, `pwa_tech_id`, `pwa_photo_count`, `pwa_completed_at`, `pwa_photo_urls`
- PWA columns on `pole_install_sessions`: `pwa_submission_at`, `pwa_tech_id`, `pwa_completed_at`

**API routes (`pages/api/photo-guide/`):**
- `GET /site/[id]` — DR + pole lookup
- `POST /validate` — EXIF age + duplicate hash fraud + VLM quality gate
- `POST /escalate` — flag step after 3 failed attempts
- `GET /escalations` — list by status (supervisor)
- `POST /escalate/[id]/resolve` — approve or reject
- `POST /upload` — store to VF Storage, update DR/pole record
- `GET /submission/[drNumber]` — PWA submission lookup for Activate DR detail

**UI additions:**
- **PWA Photos tab** in Activate DR detail (`UnifiedReviewCard`) — per-step photo grid
- **PWA Escalations tab** in Action Centre (`pages/activate/action-centre.tsx`) — supervisor approve/reject flow

### 2. Gallery: fixed decision persistence (commit `87928097c` — in PR #1828)
- **Bug:** Good/Bad decisions marked in the gallery were lost on page reload — only stored in React state, never read back from `vlm_corrections` on load
- **Fix:** Gallery API now sub-selects `vlm_corrections` per photo and returns `existingDecision`. Page pre-populates React state from DB on every step load. In-session user changes win over DB values.
- **Also:** Save hook (`usePhotoGallerySave`) now skips already-saved photos from the pending count so the "N unsaved" badge doesn't appear for photos that are already in DB.

### 3. Gallery: always-visible PASS/FAIL/Unreviewed badges (commit `87928097c` — in PR #1828)
- Old: badge only appeared after making a decision (only showed when `decision !== null`)
- New: every photo has a permanent coloured banner across the top — green PASS, red FAIL, dark gray "Unreviewed" — visible at all times in both grid and single view

### 4. Gallery steps 11-12: fixed wrong photo source (commit `9d8533f54` — in PR #1828)
- **Bug:** Steps 11 (Dome Joint Open) and 12 (Dome Joint Closed) were showing ONT device photos and Fibertime-branded docs — 2,967 and 2,739 results respectively
- **Root cause:** `ph_hh1`/`ph_hh2` `original_type` tags are assigned broadly in 1Map, not exclusively to dome joint photos
- **Fix:** Steps 11-12 now use `vlm_categorization_results` with `vlm_predicted_step = 11/12` (same approach as steps 1-10) but without the `qa_decision = 'PASS'` requirement (dome joint DRs rarely go through full QA wizard). If the VLM hasn't classified any dome joints yet, the gallery will show 0 — correct and honest rather than thousands of wrong photos.
- ⚠️ **Side effect:** The ~120 dome joint reviews Zander did in the previous session were on `ph_hh1`/`ph_hh2` photos (which were ONT/Fibertime photos, NOT dome joints). Those training examples in `vlm_visual_photo_examples` for steps 11-12 are wrong. They need to be cleared and re-done after PR #1828 is deployed and the gallery shows actual dome joint photos.

### 5. Code review of PR #1828 (commit `afd1c4b5d`)
Two bugs found and fixed before posting review:

| Bug | File | Fix |
|-----|------|-----|
| `pwa_photo_count` stored `photos.length` (requested) not actual uploaded count — diverge when VF Storage fails for some photos | `upload.ts:72` | Changed to `Object.keys(uploadedUrls).length` |
| Empty `catch {}` silently swallowed resolve errors in supervisor tab; CI silent-catch gate was exactly at limit 76/76 | `PwaEscalationsTab.tsx` | Replaced with `log.warn(...)` |

Full migration 247 coverage confirmed — every column and table the code touches is in the migration. No conflicts between gallery fixes and PWA changes.

---

## All Decisions Made (don't re-litigate)

| Decision | Outcome |
|----------|---------|
| Gallery steps 11/12 data source | **VLM `vlm_predicted_step`** — NOT `photos_metadata` by `original_type`. `ph_hh1`/`ph_hh2` proved too broad (matched thousands of wrong photos). |
| Steps 11-12 dome joint training data | ⚠️ Previous 120 reviews were on WRONG photos. Must be cleared and re-done after PR #1828 deploys and gallery is showing actual dome joints. |
| Sub-project B start condition | Only after Sub-project A is **deployed to dev** AND verified via curl |
| PhotoGuide PWA repo location | `~/Workspace/PhotoGuide/` on Velocity — completely separate repo, NOT inside FF_Next.js |
| PWA architecture | Standalone Next.js 14 App Router app, calls FibreFlow API at dev.fibreflow.app |
| Activation steps | 12 steps (including dome joint open/closed) |
| Fraud mechanism | EXIF age (<2h) + SHA-256 hash dedup per site |
| VLM fallback on error | Always pass (never block technician on VLM timeout/parse error) |
| `pwa_photo_count` field | Records actual uploaded count, not requested count |
| Gallery `existingDecision` | Loaded from DB on every step load; in-session changes win over DB values |

---

## What's Next (in order)

### Step 1 — Hein merges PR #1828 and deploys to dev (FIRST — not your action)
PR #1828 has been reviewed and approved. Hein needs to:
1. Merge `feature/pwa-fibreflow-api` → master
2. Run `bash scripts/deploy-local.sh dev` on Velocity

### Step 2 — Verify Sub-project A is live on dev
```bash
curl -s https://dev.fibreflow.app/api/photo-guide/site/DR-1234
# Must return 401 (auth required) — proves the route exists, not 404
```
Check all 7 routes exist. If any returns 404, deploy hasn't picked up yet.

### Step 3 — Clear wrong dome joint training data (steps 11-12)
⚠️ Must do this BEFORE Zander re-reviews dome joint photos.

The ~120 reviews from the previous session were on `ph_hh1`/`ph_hh2` photos (ONT devices, Fibertime docs). Delete them:
```sql
DELETE FROM vlm_visual_photo_examples WHERE step_number IN (11, 12);
DELETE FROM vlm_corrections
  WHERE module = 'activate'
    AND analysis_type = 'photo_categorization'
    AND context_json->>'stepNumber' IN ('11', '12');
```
Then Zander should re-review actual dome joint photos via the gallery (which will now show VLM-classified dome joints, or 0 if none are classified yet).

### Step 4 — Execute Sub-project B (PhotoGuide PWA standalone app)
Invoke `superpowers:executing-plans` with:
`docs/superpowers/plans/2026-05-28-photoguide-pwa.md`

New repo at `~/Workspace/PhotoGuide/` on Velocity — 11 tasks:
1. Repo bootstrap (create-next-app, install deps, shadcn)
2. Tenant config + step configs (activations 12 steps, civils 9 steps)
3. Core library (`lib/api.ts`, `lib/store.ts`, `lib/db.ts`, `lib/fraud.ts`)
4. Login screen + auth guard
5. Home screen (job type tiles)
6. Site lookup screen
7. Step overview screen
8. Step detail + camera + VLM validation
9. Job complete screen + upload
10. PWA manifest + Serwist service worker
11. Deploy to `field.fibreflow.app` (or `dev.fibreflow.app/guide`)

**Before starting:** Update `tenant.json` `apiBase` to `https://dev.fibreflow.app/api/photo-guide`.

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `docs/superpowers/plans/2026-05-28-photoguide-pwa.md` | Sub-project B plan — 11 tasks for the standalone PWA |
| `docs/superpowers/plans/2026-05-28-fibreflow-pwa-api.md` | Sub-project A plan — all done |
| `pages/api/photo-guide/validate.ts` | Core fraud + VLM validation route the PWA calls per photo |
| `pages/api/photo-guide/site/[id].ts` | DR/pole lookup — first call the PWA makes |
| `scripts/migrations/247_pwa_support.sql` | Migration 247 — DO NOT RE-RUN (already applied) |
| `src/modules/activate/components/UnifiedReviewCard.tsx` | Has new PWA Photos tab (step 'pwa') |
| `pages/activate/action-centre.tsx` | Has new PWA Escalations tab |
| `src/modules/activate/services/stepQualityCriteria.ts` | VLM criteria for all 12 steps — used by /validate |
| `pages/api/activate/photo-gallery/index.ts` | Gallery API — steps 11-12 now use VLM predictions |
| `src/modules/activate/components/photo-gallery/PhotoGridView.tsx` | Always-visible PASS/FAIL/Unreviewed banner on every photo |

---

## Current State of Dev

| Item | Status |
|------|--------|
| dev.fibreflow.app | Running master (does NOT yet have PR #1828 changes) |
| Photo gallery persistence (steps 1–10) | ✅ Live — decisions survive page reloads |
| Photo gallery (steps 11–12) data source | ⚠️ Still using old `ph_hh1`/`ph_hh2` filter in master — shows wrong photos. Fix is in PR #1828. |
| Steps 11-12 training data | ⚠️ WRONG — 120 reviews from previous session were on ONT/Fibertime photos, not dome joints. Must clear after PR #1828 deploys. |
| VLM few-shot training (steps 1-10) | ✅ 576+ decisions in `vlm_visual_photo_examples` + `vlm_corrections` |
| PASS/FAIL badges in gallery | 🔄 In PR #1828 — always-visible banner on every photo |
| Gallery decision persistence fix | 🔄 In PR #1828 — loads `existingDecision` from DB on page load |
| FibreFlow PhotoGuide API (Sub-project A) | 🔄 PR #1828 open — awaiting Hein review + merge |
| DB migration 247 | ✅ Applied to shared DB (dev + prod) |
| PWA Photos tab in Activate | 🔄 In PR #1828 — not yet deployed |
| PWA Escalations tab in Action Centre | 🔄 In PR #1828 — not yet deployed |
| PhotoGuide PWA app (Sub-project B) | ❌ Not started — waiting for Sub-project A on dev |

---

## To the AI Reading This Tomorrow

1. **PR #1828 must be merged and deployed before anything else.** All gallery fixes AND the entire Sub-project A API live in this one PR. Don't start Sub-project B until dev is running the branch.

2. **Migration 247 is ALREADY applied** to the shared DB. Do NOT re-run `247_pwa_support.sql`. All tables and columns exist.

3. **Steps 11-12 training data is WRONG** — delete rows from `vlm_visual_photo_examples` and `vlm_corrections` for `step_number IN (11, 12)` BEFORE Zander reviews dome joint photos. The SQL is in Step 3 above.

4. **`ph_hh1`/`ph_hh2` = bad filter.** Those `original_type` values in 1Map are not exclusive to dome joint photos — they match thousands of ONT/Fibertime photos. Gallery now uses `vlm_predicted_step` for steps 11-12. The old approach is gone.

5. **Gallery decisions now persist across reloads.** `existingDecision` is returned from the API for each photo and pre-populates the React state. In-session user changes win. The save hook skips photos where `decision === existingDecision` (already in DB).

6. **`withAuth` import is `@/lib/auth`** — not `@/lib/auth/withAuth`. Pool is a default import: `import pool from '@/lib/db'`. Named import `import { pool } from '@/lib/db'` also works (both are exported).

7. **VLM constants** are all in `@/lib/vlm`. `VLM_MAX_TOKENS_QUICK`, `VLM_TEMPERATURE`, `VLM_TIMEOUT_REALTIME`, `stripThinkTags` all exist and are re-exported.

8. **The PhotoGuide PWA repo goes in `~/Workspace/PhotoGuide/`** on Velocity. Completely separate from FF_Next.js. Do not create it inside this repo.

9. **Sub-project B plan has 12 activation steps** (not 10). Steps 11 (Dome Joint Open) and 12 (Dome Joint Closed) are already in the plan's step config. Do not strip them.

10. **SSH to Velocity**: `ssh zander@100.96.203.105`. Sudo password and DB superuser connection string are in `.claude/credentials.local.md` (gitignored) — never commit secrets to tracked docs.
