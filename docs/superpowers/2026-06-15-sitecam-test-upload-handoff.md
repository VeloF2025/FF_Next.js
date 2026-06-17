# SiteCam QA Fixes + Test-Upload — Session Handoff
> **Date:** 2026-06-15
> **Continue with:** Get PR #1975 reviewed + merged, then set `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD=true` on dev and redeploy dev so Zander can phone-test SiteCam by uploading screenshots against a test DR.
> **Plans:** none (changes were small/surgical; no plan file)

---

> ## ✅ UPDATE 2026-06-17 — Step 1 COMPLETED
> A later session executed "Step 1" below:
> - **PR #1975 reviewed (blind), fixed, and MERGED** → squash commit `37896a19` on master.
>   - Review fix: added `StepCapture.test.tsx` coverage for the `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD` gating (hidden by default; shown only when `'true'`).
> - **`NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD=true` set in `/home/velo/fibreflow-dev/.env.local`** and **dev rebuilt** — verified the upload button is compiled into the dev bundle (flag folded to true).
> - **Current HEADs:** dev = `37896a19` · prod = `c7ead665` (both advanced past the 2026-06-15 values in the tables below).
> - **Remaining:** Step 2 (Zander phone-tests) → Step 3 (revert temp feature when Zander signals) → Step 4 (promote #1951/#1973/#1975 to prod, after-hours + Hein).
>
> _The "Current State" / "deploy tracking" tables below are the 2026-06-15 snapshot — kept for history; see this stamp for live state._

---

## What We Did Today

### 1. Investigated the SiteCam "five changes" batch (PR #1951)
- Zander asked which five changes were made to SiteCam "last week." Traced it to **PR #1951 `feat/sitecam-fixes-round2`** (4 commits, merged 2026-06-15). The five:
  1. **Photo watermark** — burns `DR<num> • YYYY-MM-DD HH:MM` into the JPEG pixels on capture (`src/modules/sitecam/lib/watermarkPhoto.ts`)
  2. **Save photo(s) to device** for 1Map re-upload (`src/modules/sitecam/lib/savePhotoToDevice.ts`)
  3. **Photo-validation fix** — resize images to 1024×768 before VLM (`validate.ts` + `vlmGallery.ts`) so requests stop 400-ing & failing open; plus enable VLM on steps 3 & 4 (`sitecamSteps.ts`)
  4. **Serial cross-reference** against 1Map/OES (`src/modules/sitecam/lib/serialCrossRef.ts`)
  5. **Failed photo on supervisor Failed tab** (`pages/api/sitecam/escalate.ts` + hook)

### 2. Diagnosed + fixed the false "Human ✓" badge (PR #1973 — MERGED)
- **Symptom:** two Mohadin DRs (`DR1855395`, `DR1855362`) showed a green **"Human ✓"** QA-Centre badge though no human reviewed them. Both were Jan-activated DRs re-photographed via SiteCam today.
- **Root cause:** the QA-Centre badge (`QaCentrePage.getQaReviewStatus`) derives "Human ✓" from `feedback_sent && !qa_decision_by.startsWith('system:')`. The **SiteCam upload endpoint never reset the prior QA cycle**, so it kept January's `feedback_sent=true` / human `qa_decision_by`. Auto-QA (`autoQaHelpers`) and WA-resubmission (`ack/drStatusService.markForRework`) already reset; SiteCam was the third write-path that didn't.
- **Fix:** new `resetPriorQaCycleForResubmission()` (`src/modules/sitecam/services/resubmissionReset.ts`), called from `/api/sitecam/upload` (activations). Archives the prior cycle into `submission_history`, bumps `submission_count`, clears stale QA-decision + feedback markers. Guarded (only rows with a prior cycle) and non-fatal. Regression test added; `ci:quick` green.

### 3. Verified active SiteCam test fixtures (live DB)
The seed (`scripts/test-fixtures/sitecam-seed.sql`) HAS been run. Confirmed live:
- **Activation DRs (enter WITHOUT "DR" prefix):** `9999990` ✅clean, `9999991` ⚠️stale feedback_sent, `9999992` ⚠️stale, `9999993` ✅clean, `9999994` ✅clean, `9999999` ⚠️stale
- **Civil pole IDs (enter full):** `TEST-CIVIL-001`…`005` — all clean
- Reset between runs: `scripts/test-fixtures/sitecam-reset.sql`

### 4. Built the temporary test-upload feature (PR #1975 — OPEN)
- Adds a dev-only **"Upload Photo (test)"** button to the SiteCam wizard: a file input *without* `capture=`, so on a phone it opens the gallery/photo picker. Selected file flows through the identical `onCapture → watermark → validate` pipeline.
- Gated behind build-time flag `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD` (default off). One file: `src/modules/sitecam/components/StepCapture.tsx` + a documented line in `.env.local.example`. `ci:quick` green.
- **Intentionally temporary** — one flag constant + one `{ALLOW_TEST_UPLOAD && …}` block, all marked `TEMPORARY`. Remove later via `git revert` of the single commit.

---

## All Decisions Made (don't re-litigate)

| Decision | Outcome |
|----------|---------|
| Fix the false "Human ✓" at data layer vs badge display layer | **Data layer** — badge fix alone can't distinguish a stale prior-cycle review (the Jan `qa_decision_by` is also human). Reset the cycle on SiteCam upload (PR #1973). |
| Make the resubmission reset its own PR or fold into `fix/auto-feedback-stale-cycle` | **Separate PR (#1973)** — distinct write path, though same stale-`feedback_sent` family. |
| Test-upload gating: env-flag-dev-only vs always-on | **Env-flag, default off, dev-only** — uploads defeat SiteCam's live-capture/anti-reuse guarantee; must never be on in prod. |
| Test-upload: keep watermark + VLM validation on uploaded photos | **Yes** — only the photo *source* changes; pipeline identical for realistic testing. |
| Which DR to test uploads against | **Test DRs (`9999990`/`9999993`/`9999994`)**, NOT real DRs — dev & prod share ONE DB, so uploading to a real DR mutates live production data. |
| EXIF-age check blocking screenshots | **Non-issue** — client never sends `exifTimestamp` and the watermark canvas strips EXIF; the 2-hour age check in `validate.ts` is dormant. |

---

## What's Next (in order)

### Step 1 — Merge PR #1975 + enable test-upload on dev (FIRST)
1. Review + merge **#1975** (`feat/sitecam-temp-photo-upload`).
2. On the **dev** deploy box, add `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD=true` to `/home/velo/fibreflow-dev/.env.local`.
3. Redeploy dev: `bash scripts/deploy-local.sh dev` — **must rebuild** (the flag is inlined at build time; a plain restart won't pick it up).
4. Success condition: on a phone, `dev.fibreflow.app/my/sitecam` → enter test DR `9999990` → an amber **"Upload Photo (test)"** button appears under "Take Photo" and opens the gallery.

### Step 2 — Zander phone-tests SiteCam end-to-end
Upload screenshots against test DRs; verify watermark + validation + accept/fail/escalate flow. Reset between runs with `sitecam-reset.sql`.

### Step 3 — Remove the temp upload feature (when Zander says testing is done)
`git revert` PR #1975's commit (or delete the `ALLOW_TEST_UPLOAD` block in `StepCapture.tsx` + the `.env.local.example` line), open a PR, and unset the env var on dev. **Zander will explicitly signal when to do this — do not remove early.**

### Step 4 — Promote merged SiteCam work to production (after-hours + Hein approval)
Production is on `#1970` (2026-06-14) and is **missing** PR #1951 and PR #1973. Promote when after-hours (deploys blocked 08:00–17:00 SAST Mon–Fri) with Hein's approval, via `bash scripts/deploy-local.sh production`.

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/modules/sitecam/components/StepCapture.tsx` | Step capture UI; holds the gated `ALLOW_TEST_UPLOAD` block (PR #1975) |
| `src/modules/sitecam/services/resubmissionReset.ts` | `resetPriorQaCycleForResubmission()` — clears stale QA cycle on SiteCam upload (PR #1973) |
| `pages/api/sitecam/upload.ts` | SiteCam submission endpoint; calls the reset before writing `pwa_*` columns |
| `src/modules/activate/components/QaCentrePage.tsx` | `getQaReviewStatus()` (~line 810) — the "Human ✓ / AI Sent / Pending" badge logic |
| `src/modules/sitecam/lib/watermarkPhoto.ts` | Burns DR + timestamp into photo pixels (PR #1951) |
| `scripts/test-fixtures/sitecam-seed.sql` / `sitecam-reset.sql` | Test DR/pole fixtures + reset |
| `.env.local.example` | Documents `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD` |

---

## Current State of Dev & Prod

| Item | Status |
|------|--------|
| dev.fibreflow.app | `05a6c691e` (PR #1981) — current master |
| app.fibreflow.app (prod) | `5fa46ebbf` (#1970, 2026-06-14) — **behind** |
| PR #1951 (5-change batch incl. watermark) | ✅ Merged, ✅ on dev, ❌ not on prod |
| PR #1973 (stale "Human ✓" reset) | ✅ Merged, ✅ on dev, ❌ not on prod |
| PR #1975 (temp test-upload) | 🔄 **OPEN** — not merged, not deployed anywhere |
| `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD` on dev | ❌ not set yet (needed for #1975 to show) |
| SiteCam test fixtures (DRs/poles) | ✅ seeded & live in shared DB |

---

## PRs We Created This Session (deploy tracking)

| PR | Branch | State | On dev? | On prod? | Action needed |
|----|--------|-------|---------|----------|---------------|
| **#1973** | `fix/sitecam-resubmission-stale-qa-reset` | MERGED | ✅ | ❌ | Promote to prod (after-hours + Hein) |
| **#1975** | `feat/sitecam-temp-photo-upload` | **OPEN** | ❌ | ❌ | Review → merge → enable env var on dev → redeploy dev |

(PR #1951 `feat/sitecam-fixes-round2` was pre-existing, not created this session, but is also merged + on dev / not on prod — promote with #1973.)

---

## To the AI Reading This Tomorrow

1. **PR #1975 is the live thread.** It's open and unmerged. The "Upload Photo (test)" button is invisible until both: (a) the PR is merged, AND (b) `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD=true` is set on dev with a **rebuild**. A restart alone won't work — the flag is compile-time inlined.
2. **Do NOT remove the temp upload feature until Zander explicitly says testing is done.** It's built to be reverted in one step; just don't do it early.
3. **dev & prod share ONE database.** Any SiteCam upload to a *real* DR mutates live production data. Always test with the test DRs (`9999990`/`9999993`/`9999994`), not real drop numbers.
4. **Three test DRs have stale `feedback_sent=true`** (`9999991`, `9999992`, `9999999`) — they'll show a misleading "Human ✓" after submission. Use the clean ones, or run `sitecam-reset.sql` (note: reset clears `pwa_*`/hashes/escalations but NOT `feedback_sent` — clear that manually if needed).
5. **Production is a day behind** and missing PR #1951 + #1973. The watermark, the stale-"Human ✓" fix, serial cross-ref, etc. are NOT live for technicians yet — only on dev.
6. **Never auto-merge or deploy.** All deploys are Hein's call; production deploys are after-hours only. Stop at "PR opened / merged" and hand to Hein.
7. **DB access from the Windows dev box:** no local psql/creds/docker. Reach the live DB via `ssh zander@100.96.203.105` (key auth works) → read `DATABASE_URL` from `/home/velo/fibreflow-dev/.env.local` (zander is in the `velo` group) → use the host's `/usr/bin/psql`. zander canNOT run docker.
8. **Related memory:** `project_qa_cycle_reset_paths` — the three write-paths (auto-QA, WA-resubmission, SiteCam upload) must all reset the QA cycle; SiteCam was the gap fixed in #1973.
