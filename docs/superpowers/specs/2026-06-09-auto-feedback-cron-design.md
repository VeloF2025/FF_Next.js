# Auto-Feedback Cron — Design Spec

**Date:** 2026-06-09  
**Status:** Approved  
**Scope:** Auto-send QA feedback to individual technicians via WhatsApp private message after a 30-minute window, for new DRs only (today onward), with a pausable kill switch.

---

## Overview

The auto-QA pipeline analyses DRs and parks them at `pending_hitl` for human review. This feature adds a timed auto-send layer: if a human operator hasn't sent feedback within 30 minutes of auto-QA completing, the system sends the auto-generated feedback message privately to the technician who submitted the DR.

HITL is preserved — operators can still review and re-send at any time. The auto-send can be paused instantly via a DB flag, falling the system back to full HITL mode.

---

## Requirements

- Send to **private tech only** (`destination: 'private'`) — no group sends.
- Only DRs processed **from 2026-06-09 onward** — no backlog.
- **30-minute window** after `auto_qa_processed_at` before auto-send fires.
- Message content: **auto-generated from QA results** (same as the operator would send manually).
- If `wa_sender_jid` is null: **flag the DR** with `auto_feedback_skip_reason = 'no_wa_sender_jid'` and leave it at `pending_hitl` for a human to handle.
- After auto-send: mark DR as **completed** (`feedback_sent = true`, `human_review_status = 'completed'`). Operators can still re-send via the existing "Send Feedback" button.
- **Kill switch:** setting `system_flags.auto_feedback_enabled = 'false'` pauses auto-send instantly. Auto-QA analysis continues unaffected.

---

## Architecture

### 1. Database Migration

**`dr_photo_unified_reviews` — two new columns:**

```sql
ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN auto_feedback_sent_at TIMESTAMPTZ,
  ADD COLUMN auto_feedback_skip_reason TEXT;
```

- `auto_feedback_sent_at`: timestamp when auto-send fired. `NULL` = not yet sent.
- `auto_feedback_skip_reason`: reason auto-send was skipped (e.g. `'no_wa_sender_jid'`). `NULL` = no skip.

**New `system_flags` table:**

```sql
CREATE TABLE system_flags (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_flags (key, value) VALUES ('auto_feedback_enabled', 'true');
```

To pause auto-send (takes effect on next cron tick, no deploy required):
```sql
UPDATE system_flags SET value = 'false', updated_at = NOW()
WHERE key = 'auto_feedback_enabled';
```

To resume:
```sql
UPDATE system_flags SET value = 'true', updated_at = NOW()
WHERE key = 'auto_feedback_enabled';
```

---

### 2. Shared Feed Service Extraction

**File:** `src/modules/activate/services/feedbackSendService.ts`

The WhatsApp send logic and message generation currently inlined in `pages/api/activate/send-feedback.ts` are extracted into this service. Both the existing endpoint and the new cron import from it.

**Exports:**
- `generateFeedbackMessage(dropNumber: string): Promise<string>` — auto-generates the QA feedback message from `auto_qa_results`, `qa_decision`, step coverage, etc.
- `sendPrivateToTech(techJid: string, message: string): Promise<{ messageId?: string }>` — sends a WhatsApp private message to the given JID.
- `markFeedbackSent(dropNumber: string, message: string, opts: { autoSent: boolean, sentMessageId?: string }): Promise<void>` — updates `dr_photo_unified_reviews` with sent status.

No behaviour changes to the existing `send-feedback.ts` endpoint — it delegates to this service.

---

### 3. Cron Endpoint — `pages/api/cron/auto-feedback.ts`

**Auth:** Bearer `CRON_SECRET` (identical to `auto-qa.ts`).  
**Methods:** GET, POST.

**Processing loop (up to 10 DRs per tick):**

```
1. Read system_flags WHERE key = 'auto_feedback_enabled'
   → if value = 'false': return { paused: true, processed: 0 }

2. Query eligible DRs:
   WHERE human_review_status = 'pending_hitl'
     AND feedback_sent = false
     AND auto_feedback_sent_at IS NULL
     AND auto_feedback_skip_reason IS NULL
     AND auto_qa_processed_at <= NOW() - INTERVAL '30 minutes'
     AND auto_qa_processed_at >= '2026-06-09 00:00:00+02'
   ORDER BY auto_qa_processed_at ASC
   LIMIT 10

3. For each DR:
   a. wa_sender_jid IS NOT NULL:
      - generateFeedbackMessage(dropNumber)
      - sendPrivateToTech(wa_sender_jid, message)
      - markFeedbackSent(dropNumber, message, { autoSent: true })
      - SET auto_feedback_sent_at = NOW()

   b. wa_sender_jid IS NULL:
      - SET auto_feedback_skip_reason = 'no_wa_sender_jid'
      - Leave human_review_status = 'pending_hitl'

4. Return { processed, sent, skipped, paused: false }
```

**Error handling:** if a single DR's send fails, log the error and continue to the next DR. Don't abort the batch.

---

### 4. QA Centre UI — Badge additions only

Two conditional badges added to the existing review card (no structural changes):

| Condition | Badge | Colour |
|---|---|---|
| `auto_feedback_sent_at IS NOT NULL` | "Auto-sent" | Grey |
| `auto_feedback_skip_reason = 'no_wa_sender_jid'` | "No tech JID" | Amber |

The "Send Feedback" button remains active on auto-sent DRs so operators can re-send with any corrections. The `autoGenerate: true` flag in the existing endpoint already bypasses the `feedback_sent` guard for re-sends.

---

### 5. Systemd Timer

**Script:** `scripts/activate/setup-auto-feedback-cron.sh`

Mirrors `setup-auto-qa-cron.sh` exactly. Creates:
- `fibreflow-auto-feedback-[env].service` — calls `POST /api/cron/auto-feedback`
- `fibreflow-auto-feedback-[env].timer` — fires every 5 minutes

Same `CRON_SECRET` as the existing auto-QA timer.

**Setup command (run once per environment):**
```bash
bash scripts/activate/setup-auto-feedback-cron.sh production
bash scripts/activate/setup-auto-feedback-cron.sh dev
```

---

## Data Flow

```
DR arrives via WhatsApp
       ↓
auto-QA cron processes → human_review_status = 'pending_hitl'
       ↓
  < 30 minutes >
  Human operator sends manually → completed  (HITL path)
       OR
  30 minutes pass, no human send
       ↓
auto-feedback cron fires
       ├── flag enabled + wa_sender_jid present → send private → completed
       └── flag disabled OR no wa_sender_jid → skip / flag → stays pending_hitl
```

---

## Out of Scope

- Sending to the WhatsApp group (private tech only).
- Processing DRs with `auto_qa_processed_at < 2026-06-09` (backlog handled separately, later).
- Admin UI toggle for the kill switch (SQL query or Claude instruction is sufficient for now).
- Notification to operators when auto-send fires (log-only for now).
