# VLM Photo-Validation Accuracy — Research & Improvement Plan

**Date:** 2026-06-18
**Status:** Draft for review (Zander) — no code changes yet
**Trigger:** SiteCam false-rejecting valid Step-4 photos; broader request to make step-photo validation more accurate end-to-end.

---

## 0. The single most important finding (proven live this session)

A genuinely valid Step-4 "Cable Entry Inside" photo (cable entering a wall hole) was rejected by SiteCam. Running that exact photo against the live VLM (`Qwen3-VL-30B-A3B-Instruct-AWQ`, :8100):

| Prompt | Result (3 runs) |
|---|---|
| Step-4 criteria, **no gallery example** | **FAIL** ×3 — *"shows a cable entering a wall corner but no clear fiber drop cable is visible"* |
| Same photo, **one approved example attached** | **PASS** ×3 |

**Conclusion:** the model sees the cable but won't accept a borderline photo on its own judgement. It needs a good in-context example to anchor the decision. Therefore **the quality of the few-shot examples reaching the prompt is the dominant accuracy lever** — not the criteria wording, and not (mainly) the model. This matches 2025 SOTA for VLM visual inspection (see §3).

This reframes everything below: we are not "fixing a prompt", we are **making sure the right examples reach the model, at enough resolution, measured against ground truth.**

---

## 1. How validation works today (condensed map)

Full map with file:line refs is in the session notes; the essentials:

- **Three independent verdict paths**, each with its own criteria:
  1. **SiteCam live capture** — `pages/api/sitecam/validate.ts` → `runVlmCheck` → `buildMessageContent(step, photo, gallery, {crossStepClassification:true})`. Resizes the photo to **1024×768**. Fail-**open**.
  2. **Auto-QA (WhatsApp)** — `stepQualityValidationService.ts` → same `buildMessageContent` but **no cross-step flag** and **does NOT resize the new photo**. Fail-**open**.
  3. **QA wizard (Phase-2)** — `vlmQaValidationService.ts`, totally separate `STEP_QA_CRITERIA` (steps 1–10 only), scored 0–100. Fail-**closed**.
- **Plus categorization** (`categorizationPrompt.ts`) — "what step is this photo?", batches of 6, **full-resolution**, fail-closed to Step 0.
- **Few-shot sources:** static reference PNGs (`qaReferencePhotos.ts`, only steps 1,2,5,8,9) + gallery examples (`vlmGallery.ts`, `vlm_visual_photo_examples`, newest-6 per label). Curated via `photo-gallery/save-decisions.ts` (manager-only).
- **Knobs:** temp 0.1 everywhere; `max_tokens` 1200 (verdict); gallery 6+6 per step; resize 1024×768 (SiteCam/gallery) / none (auto-QA new photo, categorization); single attempt, no retry/voting.

---

## 2. Why accuracy is lost today (root causes)

Ordered by estimated impact.

1. **Few-shot examples are selected by recency, not relevance** (`vlmGallery.ts:31` `ORDER BY saved_at DESC LIMIT 6`). The model gets "the 6 most recently curated" photos for a step, which may look nothing like the photo being judged. SOTA inspection models use a **selection algorithm** to pick the most similar exemplars. This is the #1 fixable lever given §0.

2. **Over-aggressive downscaling destroys small details** (`validate.ts:114` → 1024×768). Steps whose pass/fail hinges on a *small* feature (a hole, a thin cable, 4 tiny LEDs, a power-meter reading, green splice flickers) lose exactly the pixels that decide the verdict. Research: Qwen-VL family does **better encoding the whole image at native resolution** than downscaled/tiled. We downscale for a 32k-context reason that mostly comes from attaching 12 example images — fix the example budget and we can raise the judged photo's resolution.

3. **No representative examples for several steps.** Static refs missing for steps **3, 4, 7, 10** (`qaReferencePhotos.ts:35-64`); if the gallery is also thin for those steps, they run **zero-shot** — exactly the condition that failed in §0. (Open question: actual per-step gallery counts — see §5.)

4. **Seven divergent definitions of the same steps** (`STEP_CRITERIA`, `QA_PHOTO_CRITERIA`, `categorizationPrompt`, `STEP_QA_CRITERIA`, `STEP_LABELS`, `sitecamSteps`, `unifiedVlmService`). Concrete harm: **categorization says an indoor bare pole is Step 5, but `STEP_CRITERIA[5]` then auto-fails a bare pole** — a photo can be classified as a step and then rejected by that same step's rule. (This session also found the Step-3 eave and Step-4 hole criteria each contradicted the categorization definition.)

5. **Auto-QA never resizes the new photo** (`stepQualityValidationService.ts`) while attaching 6+6 gallery images — the most likely path to hit the documented 32k-context HTTP-400, which **fails open and silently keeps the prior PASS.** Silent.

6. **Inconsistent failure semantics:** SiteCam/auto-QA fail-open (VLM outage → everything passes); QA-wizard/categorization fail-closed (outage → everything fails/discards). A VLM blip produces opposite, invisible outcomes.

7. **Civils is a second-class citizen** (`civilStepCriteria.ts`): forces a single canned `failReason`, no `FAIL_REASON_INSTRUCTION`, no cross-step/anti-hallucination guard.

8. **We cannot measure accuracy.** The only harnesses (`scripts/sitecam/vlm-gallery-check.ts`, `vlm-crossstep-check.ts`) test the very photos that are injected as examples (self-confirming). There is **no held-out labelled set**, so today every "improvement" is faith-based.

---

## 3. Research-backed levers (what actually moves the needle)

- **In-context example selection > everything.** "Vision-Language In-Context Learning Driven Few-Shot Visual Inspection" (arXiv 2502.09057, Feb 2025) hits MCC 0.804 / F1 0.950 *one-shot* on MVTec AD by pairing a few good/bad images with explanatory criteria **and a selection algorithm for which examples to show.** We already have the images + criteria; we're missing the *selection*.
- **Native high resolution for the judged image.** Qwen-VL improves on small-detail tasks when the whole image is encoded without downscaling; multi-patch tiling can even hurt (arXiv 2512.11167, 2510.09822). Implication: send the photo-under-judgement at higher/native resolution; keep *examples* small.
- **Self-consistency / voting** for borderline cases: sample N times and majority-vote → 5–25% accuracy gains on reasoning, similar on visual classification. Cheap to add for the photos near the decision boundary.
- **Explanatory criteria per example** (not just a global rule) — label each negative with *why* it failed (we partially do this for static refs, not gallery).

---

## 4. Proposed roadmap (prioritized, tied to our files)

### P0 — quick, high-leverage, low-risk
- **P0.1 Raise the judged photo's resolution.** Decouple the judged image from the example budget: send the new photo at ~1280–1536 (or native, capped) while keeping gallery examples at 1024×768 or smaller. Files: `validate.ts:114`, and **add the missing resize in auto-QA** `stepQualityValidationService.ts` (fixes root cause #5 too). Verify the 32k budget with the harness.
- **P0.2 Curate examples for the thin steps.** Use the existing gallery UI to add several strong positives **and** instructive negatives for steps **3, 4, 7, 10** (and verify 11, 12). This alone would likely have fixed the Step-4 case. Needs the per-step counts from §5 first.
- **P0.3 Add a borderline vote.** When the VLM's verdict is "fail" on a step that has examples, re-sample 2–3× (slightly higher temp) and majority-vote before failing the technician. Scoped to SiteCam live capture first.

### P1 — structural
- **P1.1 Relevance-based example selection.** Replace `ORDER BY saved_at DESC` with similarity retrieval: embed gallery photos (and the incoming photo) and pick the nearest positives/negatives. Start simple (perceptual hash / CLIP-style embedding stored alongside each `vlm_visual_photo_examples` row); fall back to recency when no embedding. Biggest accuracy upside per §3.
- **P1.2 Single source of truth for step definitions.** Collapse the 7 definitions to one canonical per-step record (label + categorization hint + quality requirements + fail guidance), consumed by SiteCam, auto-QA, categorization, and QA-wizard. Eliminates "classified as X then failed by X" contradictions (root cause #4).
- **P1.3 Bring civils up to parity** (`civilStepCriteria.ts`): use `FAIL_REASON_INSTRUCTION` + cross-step + anti-hallucination guard.

### P2 — measurement & longer term
- **P2.1 Held-out labelled eval set (the keystone).** Assemble N photos per step with human-confirmed pass/fail that are **excluded from the example pool**, and a harness that reports precision/recall per step. Without this we can't prove any change helps. This is what makes the whole effort engineering instead of guessing.
- **P2.2 Confidence + targeted HITL.** Surface model confidence; route only genuinely-borderline photos to the human appeal flow (which already exists) instead of failing them outright.
- **P2.3 Reconcile fail-open vs fail-closed** across the three paths into one deliberate policy.
- **P2.4 (only if P0–P1 plateau) Fine-tune / LoRA** the VLM on our curated corpus. Expensive; do last, and only once the eval set (P2.1) exists to justify it.

---

## 5. Immediate open question (needed before P0.2)

Per-step counts of `vlm_visual_photo_examples` (`job_type='activation'`, by `label`). If steps like 3/4/7/10 have few/zero positives, that confirms root cause #3 and makes **P0.2 (curate examples)** the first thing to do. Query:

```sql
SELECT job_type, step_number, label, count(*)
FROM vlm_visual_photo_examples
GROUP BY 1,2,3 ORDER BY 1,2,3;
```

(Run on Velocity: `docker exec supabase-db psql -U fibreflow_user -d fibreflow` with the DB password from `.claude/credentials.local.md`.)

---

## 6. Recommendation

Start with **P0.1 (resolution) + P5 count → P0.2 (curate thin steps) + P2.1 (eval set)**. Resolution and example coverage are the two things the live evidence points at directly; the eval set is what lets us trust everything after. Defer the model/fine-tuning conversation until we've measured the gains from better examples and resolution — research says those alone are usually enough.
