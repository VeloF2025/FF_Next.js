# SiteCam Fixes (test-upload live + progress/appeal/VLM) — Session Handoff
> **Date:** 2026-06-17
> **Continue with:** Browser-verify the 3 fixes in PR #1988 on dev from a phone (progress survives refresh, approved appeal advances, Step-3 outdoor photo passes). Everything is merged + deployed to dev; only on-device verification remains.
> **Plans:** none (surgical fixes; no plan file)

---

## What We Did Today

### 1. Confirmed the SiteCam "Upload Photo (test)" feature is live on dev
- **PR #1975** (`feat/sitecam-temp-photo-upload`) — the TEMPORARY dev-only gallery-upload button — was **merged** (squash commit `37896a198`) at ~09:55 SAST and **deployed to dev** (build 10:16, service restart 10:17).
- Verified end-to-end: button compiled into the dev client bundle (`.next/static/chunks/pages/my/sitecam/[siteId]-*.js`), and dev `.env.local` has `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD=true`.
- Zander's first screenshot (09:10) predated the build, which is why he initially saw camera-only. After a PWA reload the amber **"Upload Photo (test)"** button appears under "Take Photo".
- **Dev link:** `https://dev.fibreflow.app/my/sitecam` (staff login required; capture wizard is at `/my/sitecam/<siteId>`).

### 2. Rebased the stale 2026-06-15 handoff branch
- `docs/handoff-2026-06-15-sitecam` was 1 ahead / 30 behind. Rebased onto `origin/master`; the single local commit was already on master via PR #1982 (+ a newer 2026-06-17 update block), so it was correctly dropped. Branch ended level with master.

### 3. Diagnosed + fixed three SiteCam bugs Zander hit while phone-testing → PR #1988 (MERGED + deployed to dev)
Used systematic debugging. Root causes, all confirmed in code:

- **Bug A — refresh wiped all progress.** The wizard kept every captured photo + current step purely in React state (`useSiteCamCapture`), no persistence. Any refresh / PWA reload reset to Step 1.
- **Bug B — an approved appeal never advanced the live wizard.** Appeals are reviewed async on the supervisor side (`sitecam_appeals.status`), but the PWA never read the decision back. The `appeal-status` endpoint existed but had **zero** client consumers.
- **Bug C — Step 3 (Cable Entry Outside) false-rejected a clearly-outdoor photo as "the inside of the structure".** The gallery pipeline was verified working (44 positive / 16 negative step-3 activation examples exist; the example photo URLs return HTTP 200 server-side; the VLM genuinely ran). It was a **model mis-judgment** on an upward eave/soffit angle, not a broken gallery.

**Fixes shipped (PR #1988, base commit `4d26c6b14`):**
- **A:** New `src/modules/sitecam/lib/sitecamDraft.ts` — mirrors wizard state to `localStorage`, restored via the hook's lazy initialiser. Quota-safe: on `QuotaExceededError` it retries persisting **progress only** (photos stripped). Draft cleared on successful submit.
- **B:** Hook now polls `/api/my/sitecam/appeal-status/<dr>/<step>` every 8s after an appeal. approved → mark pass + advance (if still current step); denied → back to failed with the supervisor's reason. "Appeal sent — waiting…" indicator; pending appeal persisted so polling resumes after refresh.
- **C:** Refined `STEP_CRITERIA[3]` in `stepQualityCriteria.ts` — an upward outdoor shot of the eave/soffit/roofline (sky/overhang visible) is a valid OUTSIDE view, with an explicit "roof-overhang underside is not a ceiling" guard.

### 4. Hein blind-reviewed #1988, hardened it, and merged
- Hardening commit `bf5e150f4` (Hein): **namespace the draft key by job type** (`sitecam:draft:v1:<jobType>:<siteId>`) so the same DR under activations vs civils can't restore the wrong draft; and **range-validate `appealedIndex`** in `loadDraft` (a stale out-of-range pointer would make `steps[appealedIndex]` undefined and silently stall the polling effect — now dropped, progress kept).
- Merged as `e95291e0c`. **Dev is deployed at this commit** — all three fixes are LIVE on dev. 89 sitecam tests pass; `ci:quick` green.

---

## All Decisions Made (don't re-litigate)

| Decision | Outcome |
|----------|---------|
| How to persist wizard progress | **localStorage** (quota-safe, photos best-effort), not a server-side draft |
| How an approved appeal reaches the wizard | **Poll the existing `appeal-status` endpoint and auto-advance**, not a manual "check" button |
| Fix the Step-3 false reject | **Criteria text tweak** (done). Add a real positive gallery example later via the QA gallery UI |
| Add Zander's test photo as a gallery example? | **No.** `vlm_visual_photo_examples` is in the shared prod DB and the only retrievable copy is the watermarked test screenshot (DR9999999) — inserting it would pollute the live VLM. Use a real clean field photo via curation instead |
| Draft key scope | Namespaced by **jobType + siteId** (Hein's review fix) |
| Merge/deploy authority | Zander/Hein only — Claude stops at "PR opened". (#1988 was merged by Hein this session) |

---

## What's Next (in order)

### Step 1 — Phone-verify PR #1988 on dev (FIRST)
On a phone at `https://dev.fibreflow.app/my/sitecam/<testDR>` (fully close/reopen first to bust the PWA service-worker cache):
1. **Progress persistence:** capture a couple of steps, refresh the page → you should resume on the same step with photos intact (NOT back at Step 1).
2. **Appeal advance:** fail a step (e.g. wrong photo) → "Appeal This Step" → approve it on the FibreFlow side (`/activate` Appeals, manager role) → within ~8s the wizard should mark it pass and advance. Refresh mid-appeal → polling should resume.
3. **Step-3 outdoor photo:** re-upload the eave/roofline photo to Step 3 (Cable Entry Outside) → should now pass (or at least not be rejected as "inside").
Success = all three behave as above on-device.

### Step 2 — Decide on the Step-3 gallery example
If the criteria tweak alone doesn't reliably pass good outdoor eave shots, add a **real clean field photo** (no watermark, not a test DR) as a positive step-3 activation example via the QA gallery curation UI. Do NOT hand-insert into `vlm_visual_photo_examples`.

### Step 3 — Remove the TEMPORARY upload feature when testing is done
When Zander signals he's finished phone-testing:
- `git revert 37896a198` (or delete the `ALLOW_TEST_UPLOAD` block + `uploadInputRef` in `StepCapture.tsx` and the env var), and remove `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD=true` from dev `.env.local`, then redeploy dev. It must NEVER reach production (defeats live-capture).

### Step 4 — Promote SiteCam fixes to production (after-hours + Hein approval)
Prod is behind. Candidates to promote: the merged SiteCam fixes (#1951, #1973, #1988). **Exclude the #1975 upload feature.** Use `bash scripts/deploy-local.sh production` after 17:00 SAST with Hein's go-ahead — never manual.

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/modules/sitecam/lib/sitecamDraft.ts` | localStorage draft persistence (key `sitecam:draft:v1:<jobType>:<siteId>`, quota fallback) |
| `src/modules/sitecam/hooks/useSiteCamCapture.ts` | Wizard state machine — now also restores draft, persists on change, polls appeal status, exposes `onAppealSubmitted` + `appealPending` |
| `src/modules/sitecam/components/SiteCamWizard.tsx` | Routes `AppealModal.onSubmitted` → `onAppealSubmitted`; passes `appealPending` to StepCapture |
| `src/modules/sitecam/components/StepCapture.tsx` | Capture UI; "Appeal sent — waiting…" indicator; TEMPORARY `ALLOW_TEST_UPLOAD` block (to be removed) |
| `src/modules/activate/services/stepQualityCriteria.ts` | `STEP_CRITERIA[3]` (Cable Entry Outside) — refined this session |
| `src/lib/vlmGallery.ts` | Loads gallery few-shots for the VLM (verified working; fetches via `resolveInternalPhotoUrl`) |
| `pages/api/sitecam/validate.ts` | PWA per-step VLM validation endpoint |
| `pages/api/my/sitecam/appeal-status/[drNumber]/[step].ts` | Appeal status the wizard now polls |

---

## Current State of Dev / Prod

| Item | Status |
|------|--------|
| `origin/master` tip | `e95291e0c` (PR #1988 merge) |
| **dev.fibreflow.app** | 🔄 deployed at `e95291e0c` — all of today's SiteCam work LIVE; `NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD=true` |
| **app.fibreflow.app (prod)** | `c7ead6653` — behind; has NONE of today's SiteCam fixes and NOT the upload feature |
| Upload Photo (test) — #1975 | ✅ live on dev only · ⏳ to be reverted after testing · ❌ never to prod |
| Progress persistence — #1988 A | ✅ merged + on dev · ⏳ on-device verify |
| Appeal auto-advance — #1988 B | ✅ merged + on dev · ⏳ on-device verify |
| Step-3 criteria fix — #1988 C | ✅ merged + on dev · ⏳ on-device verify |
| Step-3 positive gallery example | ❌ not added (deliberate — see decisions) |
| PR #1988 | ✅ MERGED (Hein) incl. hardening `bf5e150f4` |

---

## To the AI Reading This Tomorrow

1. **Everything from today is already merged AND on dev.** Don't re-implement — the next action is on-device verification, not coding.
2. **The DB is shared dev+prod (single self-hosted Supabase).** Do NOT hand-insert into `vlm_visual_photo_examples` or any table to "improve" the VLM — it changes production for everyone. Gallery curation goes through the UI with real clean photos.
3. **The upload button (#1975) is TEMPORARY and dev-only.** It bypasses live-capture. It must be reverted after testing and must never be enabled in production. The flag is build-time inlined — enabling/disabling requires a redeploy.
4. **SiteCam is a PWA** — a service worker caches the bundle. After any dev deploy, you must fully close/reopen (or clear site data) on the phone to see changes, else you'll wrongly conclude "it didn't deploy."
5. **The Step-3 reject was NOT a broken gallery.** The gallery pipeline is verified working (data present, photos fetch 200, VLM runs). It was a genuine model miss on an upward eave angle. If still failing after the criteria tweak, add a real positive example — don't go hunting for a "gallery not wired up" bug that doesn't exist.
6. **Appeals are async/supervisor-side.** The wizard now polls for the decision; it does not block. An approved appeal advances within ~8s. A denied one returns to failed with the reason.
7. **Draft key is namespaced by jobType+siteId** (`sitecam:draft:v1:<jobType>:<siteId>`). Same DR under activations vs civils keeps separate drafts.
8. **Process rules:** branch from fresh `origin/master`, stage files explicitly, PR-only (never commit to master), `npm run ci:quick` before every PR, and stop at "PR opened" — Hein/Zander merge and deploy.
