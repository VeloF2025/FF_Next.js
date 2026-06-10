# SiteCam & QA Status — Session Handoff
> **Date:** 2026-06-10
> **Continue with:** Deploy master to dev (includes the VLM token fix from PR #1924), then ask Hein to review and merge PR #1916 for the "AI Sent" badge.
> **Plans:** `docs/superpowers/plans/2026-06-09-auto-qa-gallery-all-steps.md`

---

## What We Did Today

### 1. Received Yesterday's Handoff
- Read `.claude/handoffs/2026-06-09-1800.md` for full context on the previous session's work
- Confirmed PR #1916 (`feat/auto-qa-gallery-all-steps`) is still open, awaiting Hein's review

### 2. Committed & Pushed SiteCam Seed SQL (now in PR #1916)
- `scripts/test-fixtures/sitecam-seed.sql` and `sitecam-reset.sql` were untracked — committed to `feat/auto-qa-gallery-all-steps` and pushed
- Commit: `4889b14c5`
- Pre-existing test IDs already in DB: `DR9999999` (activations) and `TEST-CIVIL-001` (civils) — usable in SiteCam right now
- Remaining 9 fixtures need the seed run first

### 3. Diagnosed "AI Sent" Status Not Showing
- Root cause: PR #1916 not merged → badge logic not on dev
- Confirmed auto-feedback cron IS running every 5 min (systemd timer installed on Velocity)
- **20 auto-feedback messages sent today** across Lawley, Mohadin, Etwatwa, Mamelodi
- `auto_feedback_sent_at` IS being written by the cron; badge just needs PR #1916 deployed
- One anomaly: `DR1870346` has `auto_feedback_sent_at` set but `feedback_sent = false` (minor inconsistency to watch)

### 4. Rebased PR #1916 onto Current Master
- Master was 41 commits behind local — pulled, including the full auto-feedback infrastructure (feedbackSendService, cron endpoint, DB migration) which had been stranded on `fix/sitecam-appeals-nav` remote
- Rebased `feat/auto-qa-gallery-all-steps` onto updated master — zero conflicts
- Force-pushed: `ca8a4bc23 → 4889b14c5`

### 5. Fixed SiteCam VLM Token Budget — PR #1924 (already merged)
- **Problem:** Zander submitted a valid cable-from-pole photo in SiteCam Step 2, got "The pole is not in view" — same photo passes auto-QA at 98% confidence
- **Root cause:** SiteCam used `VLM_MAX_TOKENS_QUICK = 500`; auto-QA uses `VLM_MAX_TOKENS_QA = 2000`. Qwen3-VL needs chain-of-thought reasoning — 500 tokens truncates it on borderline photos
- **Fix:** Raised `VLM_MAX_TOKENS_QUICK` 500 → 1200 in `src/lib/vlm/config.ts`
- PR #1924 created and **already merged to master** — needs a dev deploy to take effect

---

## All Decisions Made (don't re-litigate)

| Decision | Outcome |
|----------|---------|
| Cherry-pick auto-feedback commits vs new branch | Not needed — they were already on master (we just needed to pull) |
| VLM token increase amount | 500 → 1200 (enough reasoning room, minimal latency impact) |
| DB seed command to use | `docker exec -i supabase-db psql -U postgres -d fibreflow < /home/hein/Workspace/FF_Next.js/scripts/test-fixtures/sitecam-seed.sql` |
| `DR9999999` re-use | Needs manual `feedback_sent=false` reset — use `sitecam-reset.sql` for other fields |
| PR #1916 scope | No new code added today beyond seed SQL; changes are safe (additive only) |

---

## What's Next (in order)

### Step 1 — Deploy master to dev (FIRST)
PR #1924 (VLM token fix) is on master but dev is still on `ce3056657`. Deploy:
```bash
bash scripts/deploy-local.sh dev
```
After deploy, SiteCam step validation will use 1200 tokens — borderline photos should now pass correctly.

### Step 2 — Run the SiteCam DB seed
Once Hein has the branch (PR #1916 is the source), run on Velocity:
```bash
docker exec -i supabase-db psql -U postgres -d fibreflow \
  < /home/hein/Workspace/FF_Next.js/scripts/test-fixtures/sitecam-seed.sql
```
This creates test DRs `9999990–9999994` and poles `TEST-CIVIL-002–005`. Then all 10 test IDs are usable in SiteCam.

### Step 3 — Hein reviews and merges PR #1916
Contains: AI Sent badge, steps 3 & 4 gallery checks, seed SQL files.
After merge + dev deploy, all 20 DRs that already received auto-feedback today will show the purple **"AI Sent"** badge in the QA Centre immediately — no backfill needed, data is already in DB.

### Step 4 — Reset DR9999999 for clean SiteCam testing
```sql
UPDATE dr_photo_unified_reviews
SET feedback_sent=false, pwa_submission_at=NULL,
    pwa_completed_at=NULL, pwa_photo_urls=NULL
WHERE drop_number='DR9999999';
```

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/lib/vlm/config.ts` | VLM token budgets — `VLM_MAX_TOKENS_QUICK` now 1200 |
| `pages/api/sitecam/validate.ts` | SiteCam real-time step validation endpoint |
| `src/modules/activate/services/feedbackSendService.ts` | Writes `auto_feedback_sent_at` when cron sends feedback |
| `pages/api/cron/auto-feedback.ts` | Auto-feedback cron — finds DRs 30+ min post auto-QA, sends private WA |
| `scripts/activate/setup-auto-feedback-cron.sh` | Systemd timer setup (already installed on dev) |
| `scripts/migrations/sql/404_auto_feedback_columns_and_system_flags.sql` | DB migration for `auto_feedback_sent_at` + `system_flags` |
| `scripts/test-fixtures/sitecam-seed.sql` | Creates 5 test DRs + 4 test poles under Lawley project |
| `scripts/test-fixtures/sitecam-reset.sql` | Wipes PWA submission state between test sessions |
| `src/modules/activate/components/QaCentrePage.tsx` | "AI Sent" badge logic (~line 810) |
| `src/modules/activate/services/stepQualityCriteria.ts` | Steps 3 & 4 now in `QUALITY_CHECK_STEPS` |

---

## Current State of Dev

| Item | Status |
|------|--------|
| dev.fibreflow.app | Running `ce3056657` (PR #1923) — NOT yet on master |
| VLM token fix (PR #1924) | ✅ Merged to master, ❌ not deployed to dev yet |
| "AI Sent" badge (PR #1916) | 🔄 PR open, awaiting Hein review |
| Steps 3 & 4 gallery checks (PR #1916) | 🔄 PR open, awaiting Hein review |
| Auto-feedback cron | ✅ Running every 5 min on dev — 20 messages sent today |
| SiteCam DB seed | ❌ Not run — only `DR9999999` and `TEST-CIVIL-001` exist |
| `DR9999999` | ⚠️ Has `feedback_sent=true` from prior test — needs reset before re-use |
| `TEST-CIVIL-001` | ✅ Clean, ready to use |
| `system_flags.auto_feedback_enabled` | ✅ `true` (kill switch is armed but off) |

---

## To the AI Reading This Tomorrow

1. **PR #1924 is already merged** — the VLM token fix is on master. Don't re-investigate or re-fix it. Just deploy.

2. **PR #1916 is the priority merge** — it contains the "AI Sent" badge. The data (`auto_feedback_sent_at`) is already in the DB for 20 DRs from today. The badge will appear instantly once deployed — no backfill needed.

3. **The auto-feedback cron is real and working** — it fires every 5 minutes via systemd timer on Velocity (`fibreflow-auto-feedback-dev.timer`). Messages ARE going to technicians. Don't re-investigate whether it's running.

4. **The DB seed is NOT run yet** — `9999990–9999994` and `TEST-CIVIL-002–005` do not exist in the database. Only `DR9999999` and `TEST-CIVIL-001` are live. Don't tell the user these IDs work until the seed is run.

5. **`DR9999999` has `feedback_sent=true`** — it will behave as already-reviewed in SiteCam. Reset it before using for a clean activation test.

6. **The inconsistency between SiteCam and gallery QA** was caused by the token budget (500 vs 2000), not a criteria bug. It's fixed in PR #1924. Don't re-diagnose.

7. **Master is 2 commits ahead of dev** (PRs #1923 and #1924 merged since last dev deploy). A single `bash scripts/deploy-local.sh dev` brings dev up to date.
