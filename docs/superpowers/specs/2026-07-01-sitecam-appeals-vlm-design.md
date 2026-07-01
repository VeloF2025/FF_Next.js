# SiteCam Auto-Appeals VLM — Design & Handoff

- **Date:** 2026-07-01
- **Status:** DRAFT — awaiting design approval (do not implement yet)
- **Author:** Zander (with Claude)
- **Related modules:** `sitecam`, `activate` (VLM + auto-QA pipeline)
- **Next step after approval:** invoke `writing-plans` to produce the phased implementation plan, then implement Phase 1 behind a shadow-mode flag and open a PR.

---

## 1. Problem statement

When a SiteCam step photo (or serial scan) is rejected and the technician has exhausted the
3-strike lock, they can file an **appeal** with a written reason plus the photo. Today every
appeal is reviewed **manually** by a manager in `/activate/sitecam-appeals`.

We want an **automated VLM check dedicated to appeals** that decides whether an appeal is *good* —
one that specifically evaluates the technician's written reason **together with** the appealed
photo(s), catching things the existing per-step VLM does not. It must run **automatically** (same
spirit as the auto-QA / auto-feedback pipeline in activations).

**Critically for rollout:** we start in **shadow mode** (human-in-the-loop). The VLM records a
*recommendation* only; appeals are **not** auto-decided or sent back to the technician yet. The
first goal is simply to observe what the VLM decides on real appeals before trusting it to act.

A second, linked goal: **improve VLM detection as one feedback loop** — reduce wrong rejections
upstream (fewer valid photos ever need an appeal) *and* sharpen the appeals VLM on the hard
borderline cases, using human appeal decisions as a shared HITL training signal.

---

## 2. Confirmed decisions (from brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Appeal types in scope | **Both** photo-quality appeals **and** serial-mismatch appeals. Two evaluator "modes" behind one service. |
| D2 | Detection-improvement focus | **Both, as one feedback loop.** Human appeal decisions feed few-shot examples for both the upstream step-VLM and the appeals VLM. |
| D3 | Rollout | **Shadow mode first** (advisory recommendation only), gated by a system flag to enable auto-decisioning later. |
| D4 | Architecture | **Approach A** — async cron + shadow flag, mirroring `auto-qa` → `auto-feedback`. (Pending final sign-off in §5.) |

---

## 3. Current system (as-built) — reference

### 3.1 Appeals data flow
1. Tech fails a SiteCam step (3-strike lock) → `AppealModal` (`src/modules/sitecam/components/AppealModal.tsx`).
2. `POST /api/my/sitecam/appeal` (`pages/api/my/sitecam/appeal.ts`) inserts a row into **`sitecam_appeals`**.
3. A **text-only** WhatsApp alert goes to the appeal group (`SITECAM_APPEAL_GROUP_JID`), linking to the in-app queue.
4. Manager reviews at **`/activate/sitecam-appeals`** — list via `GET /api/activate/sitecam-appeals?status=pending` (`withRole('manager')`).
5. Decision via `POST /api/activate/sitecam-appeals/[id]/decision` (`approved`/`denied` + `denialReason`); sets `status`, `decided_by`, `decided_via='in_app'`, `decided_at`.
6. Tech polls `GET /api/my/sitecam/appeal-status/[drNumber]/[step]`.

### 3.2 `sitecam_appeals` schema (migration `402_sitecam_serial_appeals.sql`)
```
id uuid PK
dr_number text
step_number smallint
technician_id uuid → staff(id)     -- /my PWA session carries staff.id
appeal_text text                    -- the technician's written reason
photo_url text                      -- base64 data:image/ URI (self-contained, several MB)
serial_scanned text                 -- serial appeals only
serial_expected text                -- serial appeals only
attempt_number smallint
status text  pending|approved|denied
decided_by uuid → users(id)         -- reviewer authenticates via withAuth (users.id)
decided_via text  whatsapp|in_app
decided_at timestamptz
denial_reason text
created_at timestamptz
```
> Note: `photo_url` is a **base64 data URI**, not a fetchable URL — the appeals VLM reads the image
> straight from the row (no external fetch), same as the WA bridge constraint.

### 3.3 The existing per-step VLM (`/api/sitecam/validate`)
- Judges a **single** photo against `STEP_CRITERIA` (activations) / `CIVIL_STEP_CRITERIA` (civils):
  *"Is this a valid Step N photo?"*
- Uses gallery examples ranked by pHash similarity (`loadGalleryExamples`), `optimizeForVlm`
  (judged photo at 1280×960; examples downscaled), `crossStepClassification`, and a deterministic
  power-meter range check (Step 7, −18…−24 dBm).
- **Does not** see the technician's reasoning. Rigid gate. **Fails open** on VLM outage
  (auto-passes + `needsManualReview`).
- Key building blocks reusable by the appeals VLM: `buildMessageContent` / `buildCivilMessageContent`,
  `VLM_CHAT_ENDPOINT`, `VLM_CATEGORIZATION_MODEL`, `stripThinkTags`, `optimizeForVlm`,
  `loadGalleryExamples`, `enhancedBarcodeService` (zxing-wasm + Quagga2 for ONT serials).

### 3.4 The auto-QA pipeline we mirror
- `pages/api/cron/auto-qa.ts` — bearer `CRON_SECRET`, every 5 min, finds eligible DRs, runs phases 1–4, **parks** at phase 5.
- `pages/api/cron/auto-feedback.ts` — 30 min later, **gated by `system_flags.auto_feedback_enabled`**, with skip-reasons, per-DR attempt caps, and a cutoff date. Auto-sends only when the flag is on.
- The `system_flags` (key/value) table is the proven on/off switch — we reuse this exact pattern for appeals go-live.

---

## 4. Approaches considered

### Approach A — Async cron + shadow flag (RECOMMENDED)
A dedicated `appealsVlmService` with two evaluators (photo-appeal, serial-appeal) behind one
interface. A new cron `/api/cron/appeals-vlm` (bearer `CRON_SECRET`) picks up `pending`,
not-yet-scored appeals, runs the VLM, and writes an **advisory recommendation** (verdict +
confidence + reasoning + per-check detail) to new columns on `sitecam_appeals`. Shadow mode by
default; a `system_flags.appeals_vlm_autodecide` flag (default off) gates a future second cron that
auto-applies high-confidence recommendations (approve-only first). Human decisions that disagree
with the VLM become shared few-shot correction examples.

- **Pros:** proven pattern in this codebase; clean shadow-mode observability; re-runnable/backfillable; isolated from the tech-facing submit path; natural place for the HITL loop.
- **Cons:** most moving parts (cron + columns + flag + UI badge).

### Approach B — Inline at submission
Run the VLM synchronously inside `POST /api/my/sitecam/appeal` and store the recommendation on the row immediately.
- **Pros:** no cron; simplest wiring.
- **Cons:** couples appeal submission to VLM latency/availability; the tech's "Send Appeal" spinner now waits on the VLM; doesn't match the "automated like auto-QA" batch model; weak observability; backfill means re-POSTing.

### Approach C — Reuse the step-VLM with reason context
Re-invoke `/api/sitecam/validate` logic but also pass the reason text; treat pass/fail as the verdict.
- **Pros:** least new code.
- **Cons:** conflates the strict first-time gate with appeal judgement (the whole point is that appeals need *different* checks); no shadow-mode layer; can't grow appeal-specific criteria. Explicitly **not** what we want.

**Recommendation: Approach A.** It is the only option that delivers "observe first, no instant
send-back, then flip a switch" natively, and it matches the auto-QA/auto-feedback pipeline the team
already trusts.

---

## 5. Design sections (FOR APPROVAL)

> Each subsection below needs a 👍 before it goes into the implementation plan. Open questions are
> flagged inline as **[OPEN]**.

### 5.1 Architecture overview
```
                         ┌─────────────────────────────┐
  tech files appeal ───► │ sitecam_appeals (status=     │
  (existing submit path) │  pending, vlm_* = NULL)      │
                         └──────────────┬──────────────┘
                                        │  every N min, bearer CRON_SECRET
                          ┌─────────────▼──────────────┐
                          │ /api/cron/appeals-vlm       │
                          │  → appealsVlmService.evaluate│
                          │     ├─ photo-appeal mode     │
                          │     └─ serial-appeal mode    │
                          └─────────────┬───────────────┘
                                        │ writes advisory recommendation
                          ┌─────────────▼───────────────┐
                          │ sitecam_appeals.vlm_*        │  (shadow: advisory only)
                          └─────────────┬───────────────┘
                                        │ surfaced as badge/panel
                          ┌─────────────▼───────────────┐
                          │ /activate/sitecam-appeals    │  human still decides
                          │  (reviewer queue)            │
                          └─────────────┬───────────────┘
                                        │ on human decision
                          ┌─────────────▼───────────────┐
                          │ HITL: disagreements →        │
                          │ few-shot examples (shared)   │──► upstream step-VLM + appeals VLM
                          └──────────────────────────────┘

  [FUTURE, flag-gated] system_flags.appeals_vlm_autodecide = true
     → second cron auto-applies high-confidence recommendations (approve-only first)
```

### 5.2 Data model
Add advisory columns to `sitecam_appeals` via a **new sequential migration in
`scripts/migrations/sql/`** (next free number — latest on disk is `435`, so `436_…`; the runner
only scans that dir, top-level `scripts/migrations/` is silently ignored):

```sql
ALTER TABLE sitecam_appeals
  ADD COLUMN IF NOT EXISTS vlm_recommendation   text     -- 'approve' | 'deny' | 'uncertain'
      CHECK (vlm_recommendation IN ('approve','deny','uncertain')),
  ADD COLUMN IF NOT EXISTS vlm_confidence       real,    -- 0..1
  ADD COLUMN IF NOT EXISTS vlm_reasoning        text,    -- free-text "why"
  ADD COLUMN IF NOT EXISTS vlm_checks           jsonb,   -- per-check detail (see 5.3)
  ADD COLUMN IF NOT EXISTS vlm_serial_read      text,    -- serial mode: serial read off the photo
  ADD COLUMN IF NOT EXISTS vlm_model            text,    -- model id + prompt version (audit)
  ADD COLUMN IF NOT EXISTS vlm_evaluated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS vlm_attempts         smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vlm_skip_reason      text,    -- e.g. 'no_photo','vlm_unavailable','unsupported_step'
  ADD COLUMN IF NOT EXISTS human_agreed_with_vlm boolean; -- set at decision time (HITL signal)

CREATE INDEX IF NOT EXISTS sitecam_appeals_vlm_pending
  ON sitecam_appeals(status) WHERE status = 'pending' AND vlm_evaluated_at IS NULL;
```
- **Advisory-only in shadow mode:** these columns never change `status`. Go-live flips that.
- `vlm_attempts` + `vlm_skip_reason` mirror auto-feedback's cap/park pattern so a permanently
  unscoreable appeal (e.g. corrupt image) isn't retried forever.
- **[OPEN 5.2a]** Columns on `sitecam_appeals` vs a sibling `sitecam_appeal_evaluations` table
  (keeps history if we re-score). Recommend **columns now** (single latest recommendation),
  promote to a table only if we need multiple evaluations per appeal.

### 5.3 Appeals VLM evaluator — what it checks that others don't
One service, two modes; both return `{ recommendation, confidence, reasoning, checks }`.

**Photo-appeal mode** — inputs: step criteria (`STEP_CRITERIA`/`CIVIL_STEP_CRITERIA`), the appealed
photo, the technician's `appeal_text`, and pHash-ranked gallery examples. The VLM performs three
checks the per-step gate does **not**:
1. **Reason↔photo consistency** — does the image actually support the tech's written claim? Flags
   fabricated / irrelevant / copy-paste reasons ("photo shows the ONT" when it doesn't).
2. **Context-aware re-judge** — apply the step's *intent*, allowing legitimate edge cases the strict
   gate over-rejected (glare, angle, partial occlusion) **when the required evidence is still
   present**. Not a blanket leniency — it must cite the specific evidence.
3. **Overturn justification** — explicitly state why it upholds or overturns the original fail, in
   terms a reviewer (and later the tech) can read.

`vlm_checks` jsonb captures each sub-check verdict + evidence string, so shadow-mode analysis can
see *why*, not just the final call.

**Serial-appeal mode** — inputs: `serial_scanned`, `serial_expected`, the photo. Steps:
1. Read the serial from the photo — **`enhancedBarcodeService` first** (Data Matrix/Code128), VLM OCR fallback → `vlm_serial_read`.
2. Compare `vlm_serial_read` against `serial_scanned` (did the tech scan what's on the device?) and
   `serial_expected` (is the expected value even right — e.g. device swap / wrong SOW record?).
3. Recommend: approve if the photo's serial legibly matches the scanned value and the mismatch is
   explainable; deny if the photo shows a different/illegible serial; `uncertain` if unreadable.

**Shared infra:** `VLM_CHAT_ENDPOINT`, `VLM_CATEGORIZATION_MODEL`, `optimizeForVlm`, `stripThinkTags`,
JSON extraction, and **fail-open→`uncertain`+skip_reason** (never silently "approve" on outage —
unlike the tech-facing gate, an unavailable appeals VLM should record `uncertain`, not a pass).

- **[OPEN 5.3a]** Prompt authoring: new `appealStepCriteria.ts` (appeal-specific prompt builder that
  wraps the existing criteria + reason text) vs extending `buildMessageContent` with an
  `appealContext` option. Recommend a **new builder** to keep the strict gate prompt untouched
  (respects the "don't change step-membership criteria" rule — `STEP_CRITERIA` stays authoritative).

### 5.4 Shadow mode & go-live flag
- **Shadow (Phase 1):** cron writes `vlm_*` only. `status` untouched. Reviewers see the advisory.
- **Go-live (later phase):** `system_flags.appeals_vlm_autodecide` (default `false`, exactly like
  `auto_feedback_enabled`). When `true`, a second cron auto-applies recommendations above a
  confidence threshold and records `decided_via='vlm'`.
- **[OPEN 5.4a] Go-live semantics** — when we do flip it, which direction auto-acts first?
  Recommend **approve-only** initially (auto-approving a valid appeal is low-risk and unblocks the
  tech; wrongly auto-denying a genuine appeal is the worst outcome, so denials stay human).
  Alternatives: deny-only (reduce reviewer load), or both-with-threshold. **Decide at go-live, not now.**
- **[OPEN 5.4b]** Add `'vlm'` to the `decided_via` CHECK constraint now (forward-compat) or in the
  go-live migration. Recommend **now** (cheap, avoids a later ALTER).

### 5.5 Reviewer UI (advisory)
Extend `/activate/sitecam-appeals` only:
- Per appeal: a badge — `AI: Approve 0.86` / `AI: Deny 0.72` / `AI: Uncertain` — plus an expandable
  panel showing `vlm_reasoning` and `vlm_checks`, and (serial mode) `vlm_serial_read` vs scanned/expected.
- **No auto-action in shadow mode.** The existing approve/deny buttons are unchanged; the human
  decision additionally writes `human_agreed_with_vlm` for the feedback loop.
- Optional: a filter/sort by "AI disagreed" so reviewers can eyeball where the VLM and humans diverge.

### 5.6 HITL feedback loop (the "one feedback loop")
- On every human decision, compute `human_agreed_with_vlm` (`decision == vlm_recommendation`).
- On **disagreement** (and optionally strong agreements), write a correction example into the
  few-shot store (reuse/extend `qa_correction_examples` machinery) tagged for:
  - the **upstream step gallery** (so the primary gate stops making the same wrong rejection), and
  - the **appeals VLM** (so it learns the reviewer's calibration on hard cases).
- This is what makes detection-improvement a *loop*: appeals are, by definition, the borderline
  cases the primary VLM got wrong or was unsure about — human verdicts on them are the highest-value
  training signal we have.
- **[OPEN 5.6a]** Reuse `qa_correction_examples` directly vs a dedicated `sitecam_appeal_examples`
  table. Recommend **reuse with a `source='appeal'` tag** if the schema allows; confirm during planning.

### 5.7 Detection-improvement measures (beyond the loop)
Concrete levers, consistent with existing VLM learnings (gallery pHash backfill, relevance examples,
resolution):
1. **Feed appeal outcomes into the gallery** (5.6) — highest leverage.
2. **Resolution parity** — evaluate appeal photos with the larger `optimizeForVlm` budget (the small
   features that decide edge cases only survive at higher resolution).
3. **Relevance-ranked examples** for appeals too (pHash nearest approved/rejected, not newest).
4. **Track upstream false-fail rate** — % of appeals the human approves = a direct measure of primary-gate
   over-rejection; watch it trend down as the loop feeds back.
5. **Residual model limit is real** — some novel hard photos will still false-fail; the loop reduces
   but does not eliminate this. Don't over-promise auto-decisioning on the long tail.

### 5.8 Error handling, security, performance
- **Auth:** cron requires bearer `CRON_SECRET` (same guard as auto-qa/auto-feedback). Reviewer
  endpoints stay `withRole('manager')`. No secret values in code/docs — reference env vars only.
  (Note: a prior `CRON_SECRET` leak is tracked separately for rotation — do not reintroduce it here.)
- **Fail-open policy:** appeals VLM failing open records `uncertain` + `vlm_skip_reason`, never a
  silent approve.
- **Body/size:** photos are multi-MB base64 already in-row; no new upload path. Cron reads from DB,
  `optimizeForVlm` downscales before the VLM call (avoids the 32k-context 400s seen in validate).
- **Throughput:** batch limit per tick (start ~10, like auto-feedback); `vlm_attempts` cap parks
  unscoreable rows.
- **Idempotency:** only pick rows where `vlm_evaluated_at IS NULL` (partial index in 5.2).

### 5.9 Testing strategy
- **Unit:** evaluator decision logic (photo + serial modes) with mocked VLM responses — pass/deny/uncertain,
  reason-inconsistency detection, serial match/mismatch/illegible. Follow existing
  `pages/api/sitecam/__tests__` + `tests/api/sitecam` patterns. **No DGTS** — real assertions, no tautologies.
- **Integration:** cron picks eligible rows, writes `vlm_*`, respects the idempotency index and attempt cap.
- **Shadow-safety test:** assert the cron **never** mutates `status` while `appeals_vlm_autodecide` is off.
- **Regression:** a small labelled set of real past appeals (human verdict known) to measure VLM
  agreement — this doubles as the shadow-mode success metric (see §6). Consider wiring into `vlm-bench`.
- Gate everything through `npm run ci:quick` before each PR.

---

## 6. Success criteria for the shadow phase
Before we even consider flipping `appeals_vlm_autodecide`:
- Every new appeal gets a recommendation within one cron interval (coverage ≈ 100%, minus `uncertain`).
- Measured **agreement rate** vs human decisions on ≥ N real appeals (target to be set with Hein).
- Reviewers report the reasoning/`vlm_checks` are useful (qualitative).
- Upstream false-fail proxy (appeal-approval rate) is being tracked and trends down as the loop feeds back.

---

## 7. Development roadmap (phased PRs)
Each phase is an independent PR, CI-gated, awaiting Hein's approval before merge (no auto-merge/deploy).

| Phase | PR scope | Ships |
|-------|----------|-------|
| **P1 — Schema + service (shadow core)** | Migration (5.2), `appealsVlmService` (photo + serial modes, 5.3), unit tests | Advisory columns + evaluator, no wiring |
| **P2 — Cron** | `/api/cron/appeals-vlm` (bearer token, batch, idempotency, attempt cap), integration + shadow-safety tests | Automated scoring, still advisory |
| **P3 — Reviewer UI** | Advisory badge + panel + "AI disagreed" filter in `/activate/sitecam-appeals`; write `human_agreed_with_vlm` on decision | Humans see recommendations |
| **P4 — HITL feedback loop** | Disagreement → few-shot example (shared with step gallery); appeal-approval-rate metric | Detection loop closed |
| **P5 — Go-live switch (later)** | `appeals_vlm_autodecide` flag + auto-decide cron (approve-only first, confidence threshold), `decided_via='vlm'` | Optional auto-decisioning |
| **P6 — Bench/monitoring (optional)** | Wire appeals agreement into `vlm-bench`; drift/coverage dashboards | Ongoing accuracy tracking |

Cron registration (systemd/cron on Velocity) is an ops step attached to P2; follow the existing
`cron-auto-qa` scheduling convention.

---

## 8. Open questions to resolve before/during planning
- **[OPEN 5.2a]** Columns on `sitecam_appeals` vs sibling evaluations table. *(Recommend columns now.)*
- **[OPEN 5.3a]** New appeal prompt builder vs extend `buildMessageContent`. *(Recommend new builder.)*
- **[OPEN 5.4a]** Go-live direction — approve-only / deny-only / both. *(Recommend approve-only; decide at go-live.)*
- **[OPEN 5.4b]** Add `'vlm'` to `decided_via` now vs at go-live. *(Recommend now.)*
- **[OPEN 5.6a]** Reuse `qa_correction_examples` (tagged) vs dedicated table. *(Confirm schema fit in planning.)*
- **[OPEN 6a]** Target agreement rate + minimum sample size for trusting go-live (needs Hein).
- **[OPEN 7a]** Cron interval + batch size (start 5–10 min / batch 10, tune after observing volume).

---

## 9. Handoff notes
- Feature is **shadow-mode only** until §6 criteria are met and Hein approves go-live.
- Reuse, don't fork: VLM plumbing from `/api/sitecam/validate`; flag pattern from `auto-feedback`;
  cron auth from `auto-qa`; few-shot from `qa_correction_examples`.
- Hard rules that bite here: migrations **must** live in `scripts/migrations/sql/`; keep
  `STEP_CRITERIA` authoritative (don't change step-membership to make appeals pass); never commit
  secrets; all changes via PR; stop at "PR opened" and wait for Hein.
- **Next action on approval:** invoke `writing-plans` to expand Phase 1 (schema + service) into a
  detailed, test-first implementation plan.
