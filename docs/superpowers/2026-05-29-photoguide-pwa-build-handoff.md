# PhotoGuide PWA — Session Handoff
> **Date:** 2026-05-29
> **Continue with:** Hein creates `VelocityFibre/PhotoGuide` on GitHub, pushes the Velocity repo, then deploys to `field.fibreflow.app`
> **Plans:** `docs/superpowers/plans/2026-05-28-photoguide-pwa.md` (corrections applied, all 11 tasks complete)

---

## What We Did Today

### 1. Confirmed all gallery decisions saved (835 total across 12 steps)
Zander completed all photos in the Photo Criteria Review Gallery. Final counts:

| Step | Total | Positive | Negative |
|------|-------|----------|----------|
| 1 — House Photo | 60 | 26 | 34 |
| 2 — Cable from Pole | 60 | 43 | 17 |
| 3 — Entry Outside | 60 | 44 | 16 |
| 4 — Entry Inside | 60 | 50 | 10 |
| 5 — Wall Mount | 58 | 48 | 10 |
| 6 — ONT Back After Install | 60 | 58 | 2 |
| 7 — Power Meter Reading | 60 | 60 | 0 |
| 8 — Final Installation | 59 | 52 | 7 |
| 9 — Green Lights | 60 | 51 | 9 |
| 10 — Signature | 59 | 59 | 0 |
| 11 — Dome Joint Open | 119 | 59 | 60 |
| 12 — Dome Joint Closed | 120 | 50 | 70 |

All 12 steps are fully seeded in `vlm_visual_photo_examples`. VLM is already using the top-6 per step for few-shot quality checks.

### 2. Confirmed PR #1828 merged + dev.fibreflow.app deployed
- `feature/pwa-fibreflow-api` was merged to master
- All 7 `/api/photo-guide/*` routes are live on dev (confirmed `401` response — not `404`)
- Sub-project A prerequisite for Sub-project B was met

### 3. Executed Sub-project B — PhotoGuide PWA (all 11 tasks complete)
Built the standalone PhotoGuide PWA at `~/Workspace/PhotoGuide/` on Velocity. `npm run build` passes with 0 errors.

**12 commits on master, repo at `~/Workspace/PhotoGuide/`:**

| Task | Commit | What |
|------|--------|------|
| Bootstrap | `f0ffd19` | create-next-app + shadcn + @serwist/next + zustand + dexie |
| Tenant + step configs | `80d3230` | tenant.json, 12 activation steps, 9 civil steps |
| Core library | `55bc9fa` | api.ts, store.ts, db.ts, fraud.ts, tenant.ts |
| Login screen | `bcf9ac6` | JWT login, dark layout, middleware |
| Home screen | `29dfb63` | job type tiles (Activations / Civils) |
| Site lookup | `b925cc2` | DR number / pole number entry |
| Step overview | `92c3c3a` | progress bar, StepCard (locked/active/passed/escalated) |
| Step detail | `0b2112c` | camera (capture=environment), VLM validation, retry/escalate |
| Job complete | `5051953` | summary + upload to FibreFlow |
| PWA manifest + SW | `c476027` | Serwist service worker, manifest.json |
| Icons + build fix | `030ac8b` + `ad9f7a3` | placeholder icons, resolved 4 build errors |

**4 build errors found and fixed during execution (not in original plan):**
- `@/../config/...` path alias broken → use `../../config/...` relative paths
- `StepResult.attemptHistory` missing `url` field required by escalateStep payload
- `tsconfig.json` missing `"webworker"` in lib (needed for ServiceWorkerGlobalScope)
- Turbopack/Serwist conflict → `disable: process.env.NODE_ENV !== 'production'` + `turbopack: {}`

### 4. Created PR #1835 (plan corrections doc)
`docs/superpowers/plans/2026-05-28-photoguide-pwa.md` updated with all 3 original corrections + 4 build fixes. Branch: `fix/photoguide-plan-corrections`.

### 5. Security rule saved to memory
Hard rule added: never write credentials (passwords, tokens, connection strings) into any tracked file, commit, plan, or chat. Placeholders only — see `.claude/credentials.local.md`.

---

## All Decisions Made (don't re-litigate)

| Decision | Outcome |
|----------|---------|
| PhotoGuide repo location | `~/Workspace/PhotoGuide/` on Velocity — standalone, not inside FF_Next.js |
| GitHub org for PhotoGuide | `VelocityFibre/PhotoGuide` — Hein must create (Zander1798 can't create org repos) |
| camera input | `capture="environment"` — rear camera only, no gallery picker (fraud prevention) |
| VLM error fallback | Always pass on VLM timeout/parse error — never block technician |
| Activation steps | 12 steps (dome joint open + closed are mandatory) |
| Civils steps | 9 steps (4 required + 5 bonus/optional) |
| PWA service worker | Serwist via `@serwist/next` — disabled in dev, enabled in production builds only |
| Turbopack | Keep enabled (`turbopack: {}`) — Serwist SW injection happens at prod build time only |
| GitHub push from Velocity | Heinvv10 SSH key is already configured — push once VelocityFibre/PhotoGuide repo exists |
| Empty Zander1798/PhotoGuide repo | Left on GitHub (empty, private) — Hein can delete from settings when convenient |

---

## What's Next (in order)

### Step 1 — Hein creates GitHub repo and pushes (FIRST)
1. Hein creates `VelocityFibre/PhotoGuide` as a **private** repo on GitHub (no README, no init)
2. On Velocity:
```bash
cd ~/Workspace/PhotoGuide
git remote add origin git@github.com:VelocityFibre/PhotoGuide.git
git push -u origin master
```
The SSH key on Velocity (Heinvv10) already has GitHub access — no auth setup needed.

### Step 2 — Merge PR #1835 (plan corrections)
PR #1835 is doc-only — no code impact. Merge when Hein has reviewed.

### Step 3 — Deploy PhotoGuide to field.fibreflow.app
Needs Hein's input on:
- DNS subdomain: `field.fibreflow.app` (or an alternative like `guide.fibreflow.app`)
- nginx reverse proxy config pointing to port `3010`
- systemd service for the PhotoGuide app

Once deployed, update `tenant.json` `apiBase` to `https://app.fibreflow.app/api/photo-guide` for production (currently points to dev).

### Step 4 — End-to-end test on a real Android phone
Run through the full checklist in the plan (bottom of `docs/superpowers/plans/2026-05-28-photoguide-pwa.md`):
- Install as PWA from Chrome
- Login with FibreFlow credentials
- Enter real DR number → site name shown
- Take photo → VLM reviews → pass/fail shown
- Complete all 12 steps → upload → check PWA Photos tab in Activate

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `~/Workspace/PhotoGuide/tenant.json` | API base URL + branding — change `apiBase` to prod URL before production deploy |
| `~/Workspace/PhotoGuide/config/steps-activations.json` | 12 activation steps with instructions + example descriptions |
| `~/Workspace/PhotoGuide/config/steps-civils.json` | 9 civil steps (4 required + 5 bonus) |
| `~/Workspace/PhotoGuide/lib/api.ts` | All FibreFlow API calls (login, getSite, validatePhoto, escalateStep, uploadJob) |
| `~/Workspace/PhotoGuide/lib/store.ts` | Zustand job state — step lifecycle, photo storage, attempt history |
| `~/Workspace/PhotoGuide/app/[jobType]/[siteId]/step/[stepNumber]/page.tsx` | Core flow — camera capture, VLM validation, retry/escalate logic |
| `~/Workspace/PhotoGuide/app/sw.ts` | Serwist service worker (PWA offline support) |
| `pages/api/photo-guide/validate.ts` | FibreFlow API: EXIF fraud check + VLM quality gate (called by PWA per photo) |
| `pages/api/photo-guide/site/[id].ts` | FibreFlow API: DR/pole lookup (first call the PWA makes) |
| `docs/superpowers/plans/2026-05-28-photoguide-pwa.md` | Full PWA plan with corrections applied |

---

## Current State of Dev

| Item | Status |
|------|--------|
| dev.fibreflow.app | ✅ Running master (includes PR #1828 photo-guide API) |
| Photo gallery (steps 1–12) | ✅ 835 decisions in `vlm_visual_photo_examples` |
| FibreFlow photo-guide API (Sub-project A) | ✅ Live on dev — all 7 routes return 401 |
| PWA Photos tab in Activate | ✅ Live on dev |
| PWA Escalations tab in Action Centre | ✅ Live on dev |
| PhotoGuide PWA (Sub-project B) | ✅ Built — `~/Workspace/PhotoGuide/` on Velocity, `npm run build` passes |
| PhotoGuide on GitHub | ❌ Not pushed — waiting for Hein to create VelocityFibre/PhotoGuide |
| PhotoGuide deployed | ❌ Not deployed — waiting for GitHub push + nginx/DNS setup |
| PR #1835 (plan corrections) | 🔄 Open — doc-only, safe to merge any time |
| Empty Zander1798/PhotoGuide repo | ⚠️ Exists (private, empty) — can be deleted from GitHub settings |

---

## To the AI Reading This Tomorrow

1. **PhotoGuide PWA is fully built and the build passes.** All 11 tasks are done. The only thing remaining is getting it onto GitHub and deployed. Do NOT re-implement anything.

2. **The repo is at `~/Workspace/PhotoGuide/` on Velocity.** SSH with `ssh -o StrictHostKeyChecking=no zander@100.96.203.105`. Key auth works.

3. **The Heinvv10 SSH key on Velocity is authenticated to GitHub.** Once Hein creates `VelocityFibre/PhotoGuide` on GitHub, pushing is one command: `git remote add origin git@github.com:VelocityFibre/PhotoGuide.git && git push -u origin master`.

4. **`tenant.json` currently points to `dev.fibreflow.app`.** Before a production deploy, change `apiBase` to `https://app.fibreflow.app/api/photo-guide` and `authEndpoint` to `https://app.fibreflow.app/api/auth/login`.

5. **The service worker only activates in production builds** (`disable: process.env.NODE_ENV !== 'production'`). During dev testing the PWA will work as a regular app without offline support — this is expected.

6. **Do NOT re-apply the 4 build fixes** — they are already in the code on Velocity (commit `ad9f7a3`). Don't re-read the original plan and try to implement from scratch.

7. **DB migration 247 is already applied.** Tables `pwa_escalations`, `pwa_photo_hashes` exist. Do NOT re-run the migration.

8. **PR #1835 is doc-only** (plan corrections). It doesn't gate any development work — just merge it when Hein is satisfied.

9. **835 gallery decisions are saved** in `vlm_visual_photo_examples`. All 12 steps are seeded. The VLM is already using them for few-shot quality checks.

10. **Never commit credentials.** New hard rule. See memory `feedback_never_commit_credentials.md`. Placeholders only in all docs/plans/commits.
