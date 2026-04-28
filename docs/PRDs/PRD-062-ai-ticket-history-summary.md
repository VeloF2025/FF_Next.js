# PRD-062 — AI ticket history summary on creation

**Status:** Draft → Phase 1 in progress
**Owner:** Hein
**Created:** 2026-04-28 SAST
**Trigger:** Engineering observation that field teams open tickets cold — they have to manually piece together the DR's lifecycle from 6+ different modules before they know how to act. Goal: every ticket gets an AI-generated lifecycle summary attached automatically at creation time.

---

## Problem

A FibreFlow ticket today links back to a DR or ONT but carries almost no narrative. Whoever picks the ticket up has to:

- Open Activate to see WhatsApp install submissions and OES activation state
- Open the OLT report tab to see fix attempts / blockers
- Open 1Map to check property statuses across all `prop_id`s for the DR
- Open Procurement / Field Stock to confirm what was issued
- Cross-reference past tickets, snags, and serial-change history

That is 5–10 minutes of manual stitching per ticket, repeated every time a ticket is touched. The information already exists in the database — it just isn't surfaced.

## Goal

When any ticket is created, automatically attach a 4–8 line AI-generated narrative to the ticket describing the DR's lifecycle so far: install date, activation status, serial history, blockers, prior tickets, current 1Map status. Visible immediately in the standard NOC ticket comment timeline.

## Non-goals

- Not a chat interface — one-shot summary at creation time, not interactive Q&A.
- Not real-time — async, fire-and-forget. Ticket creation latency must not change.
- Not for tickets without a DR/ONT (manual NOC tickets without a DR are skipped).
- Not a replacement for the timeline view — complements it; the timeline still shows the raw events.

## Success criteria

- ≥95% of newly-created tickets that carry a `dr_number` have an `ai_summary` comment attached within 30 s of creation.
- Ticket-creation API p95 latency unchanged (within ±50 ms of pre-launch baseline).
- Hallucination rate <2% on a manual sample of 50 summaries (no fabricated dates / serials / DRs / phone numbers).
- Field team feedback: "the summary tells me what I need without opening other tabs" on ≥3 of the 5 disciplines.

## Architecture

### Single hook point

```
src/modules/noc/services/ticketService.ts → createTicket()
```

Every ticket-creation flow in the codebase (PP data, OLT mismatch, snags, manual NOC, the offline-devices serial-mismatch path) routes through `createTicket()`. The summarizer hook lives there, fire-and-forget, after the ticket inserts and just before the function returns.

```ts
const ticket = await insertAndAssignTeam(payload);
// ...existing timeline log...

if (ticket.dr_number) {
  void summarizeAndAttachDrHistory(ticket.id, ticket.dr_number, ticket.ont_serial)
    .catch((err) => logger.warn('drHistorySummary failed', { ticketId: ticket.id, err }));
}

return ticket;
```

### Data gathering

New service `src/modules/noc/services/drHistoryService.ts`:

- `gatherDrFacts(drNumber, ontSerial?): Promise<DrFacts>` runs N bounded parallel SELECTs:
  - `daily_reports` — most recent 5 WhatsApp DR submissions (date, photo count, contractor, status)
  - `oes_activations` — current OES row (date, team, serial, status)
  - `serial_change_history` — last 10 serial changes (old/new, source, actor, date)
  - `olt_mismatch_records` — current row + last 3 fix attempts (status, fix_result)
  - `onemap_properties` — every `prop_id` for this DR with its `status`
  - `maintenance_tickets` — open tickets on same DR or ONT (last 5, exclude the new one)
  - `offline_devices` — current row if exists (offline_since, ack history)
  - `drops` — pole, address (truncated), project, sow source
  - `civil_qa` — civil approval state if present
- Returns a strongly-typed `DrFacts` object. Total payload bounded to ~3 KB.

### Summarization

`summarizeWithQwen(facts: DrFacts): Promise<string>`:

- POST to `${VLM_API_URL}/v1/chat/completions` (OpenAI-compatible).
  - **Endpoint:** `http://100.96.203.105:8100` (Qwen3-VL-30B-A3B, already running on Velocity for QA categorization). Reuses existing `VLM_API_URL` env var; no new infra.
- System prompt:
  ```
  You are a fibre operations summarizer for FibreFlow. Output 4–8 markdown
  bullet points in past tense, SAST timezone. Use ONLY facts in the JSON
  payload. Never invent data. If a stream is empty, omit it. Cite dates as
  YYYY-MM-DD HH:mm. Never include phone numbers or street addresses verbatim
  — refer to "the address on file" if needed.
  ```
- User content: `JSON.stringify(facts)`
- Parameters: `temperature: 0.1`, `max_tokens: 400`, `model: env.VLM_MODEL`
- Timeout: 20 s (Qwen3-VL on AWQ 30B with text-only input typically returns <8 s).

### Storage

Existing `maintenance_activities` table (the canonical NOC ticket-timeline store). The `activity_type` column is free-text — no CHECK constraint — so adding `'ai_summary'` requires no migration. Activity row:

```
{
  ticket_id,
  activity_type: 'ai_summary',
  description: <markdown narrative>,
  field_changes: { facts: DrFacts, model, latency_ms },  // raw audit payload
  created_by_name: 'AI History',
  source: 'system',
  external_timestamp: NOW(),
}
```

The raw `facts` JSON is stored in `field_changes` (jsonb) so any reviewer can audit "did the model invent this?" in one click.

### UI (Phase 2)

NOC ticket detail page renders `activity_type='ai_summary'` rows at the top of the timeline with:

- Bot icon + "AI History" header
- A small "view source facts" disclosure that shows `field_changes.facts` for verification
- A "regenerate" button (manager+) that re-runs the summarizer

### Failure modes

| Failure | Behavior |
|---|---|
| Qwen3 endpoint unreachable / 5xx | Log warn, no comment posted, ticket created normally. |
| Qwen3 returns empty / under 30 chars | Skip, don't post empty comments. |
| Qwen3 returns garbage that fails sanity regex (no markdown bullets) | Skip, log warn with raw output. |
| Mac Mini saturated / queue full | First request fails → no comment. Phase 3 backfill picks it up. |
| DR has no history (orphan) | Gather returns empty across all streams → skip summarization entirely. |
| Ticket has no `dr_number` | Skip — manual NOC tickets without a DR don't qualify. |

None of these block ticket creation.

## Phasing

### Phase 1 — tracer bullet (this PRD's first PR)

- `drHistoryService.ts` with `gatherDrFacts` + `summarizeWithQwen`
- Hook in `ticketService.ts → createTicket()` behind a feature flag
  `FF_AI_TICKET_SUMMARY=1`
- Comment posted via existing `ticket_comments` infrastructure
- No UI changes — comments already render in the standard timeline
- Validate against ~10 real OLT-mismatch tickets, tune the prompt

### Phase 2 — UI polish

- Custom rendering of `ai_summary` comments at top of NOC ticket detail
- "View source facts" disclosure
- "Regenerate" button (manager+)

### Phase 3 — backfill + monitoring

- One-shot worker script: sweep tickets created in the last 90 days that lack an `ai_summary` comment, summarize them in batches of 10 with a 2 s delay, write results
- Bugsink alert: if `drHistorySummary failed` warn-rate exceeds 5/hour, ping the channel

## Risks

| Risk | Mitigation |
|---|---|
| **Hallucination** — model invents a DR / serial / date | Strict prompt + temperature 0.1 + raw facts stored alongside the comment for instant audit. The comment header reads "AI summary — verify against source facts before acting". |
| **GPU contention** with VLM photo categorization (the same Velocity GPU serves both) | Phase 1 is one summary per ticket creation, single concurrent request ceiling, 20 s timeout. If GPU saturation is observed, move text summaries to a separate Mac Mini text-only Ollama instance (memory: `velo chat: qwen3:8b on Mac Mini`). |
| **PII leakage** — addresses / phone numbers in summary | System prompt explicitly instructs to refer to "the address on file" rather than verbatim. We also pre-sanitize address fields in `gatherDrFacts` to coordinates + project name only. |
| **Cost surprise** | Local model = zero token cost. Only resource is GPU time on infrastructure already running 24/7. |
| **Bug in hook breaks ticket creation** | `void` + `.catch()` ensures the summarizer is fully isolated from the createTicket promise chain. Tested by deliberately throwing in the summarizer in dev. |

## Decisions captured

- **Single hook in `createTicket()`** — not per-callsite. Every flow benefits automatically.
- **`ticket_comments` table** — not a new column. Zero schema-impact path; comment is visible via the existing UI immediately.
- **Velocity Qwen3-VL-30B at `:8100`** — not Mac Mini Ollama. Already running, OpenAI-compatible, generous context. Mac Mini is the fallback if GPU contention shows up.
- **Fire-and-forget** — never blocks the API response. Worst-case the comment shows up 30 s after ticket creation.
- **Feature flag** — Phase 1 ships behind `FF_AI_TICKET_SUMMARY=1`. Enabled in dev first, validated, then prod.

## Verification plan

1. Deploy Phase 1 to dev with flag on
2. Create one OLT-mismatch ticket on a known DR (e.g. `DR1751144` from the recently routed batch)
3. Wait 30 s, refresh the NOC ticket detail page
4. Confirm the `ai_summary` comment exists, narrative reads naturally, every fact in the bullets is also present in the source `metadata.facts`
5. Repeat with a PP-data ticket, a snag, a manual NOC ticket
6. Spot-check 5 more tickets across different projects
7. Promote to production
