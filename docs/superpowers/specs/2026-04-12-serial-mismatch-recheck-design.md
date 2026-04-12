# Serial Mismatch Auto-Recheck System — Design Spec

**Date:** 2026-04-12  
**Status:** Approved  
**Author:** Hein (brainstormed with Claude)

---

## Overview

When the WA monitor sends a QA feedback message that contains a serial mismatch (UPS or ONT), the system currently logs a warning and stops. This spec adds:

1. An automatic second-pass VLM re-analysis triggered after the mismatch feedback is sent
2. A manual "Re-analyse Serial" button in the QA drop detail modal
3. A follow-up WhatsApp message sent to the same group with the recheck outcome
4. VLM learning integration — all mismatch photos logged as training candidates; confirmed corrections logged as negative examples

---

## Architecture & Data Flow

```
wa-monitor-send-feedback (existing)
  ├── detects mismatch in feedback payload
  └── fire-and-forget → POST /api/activate/recheck-serial-mismatch

QA Drop Detail Modal (new button)
  └── manual → POST /api/activate/recheck-serial-mismatch

/api/activate/recheck-serial-mismatch
  ├── 1. Fetch drop photos + 1Map serials + first-pass VLM results
  ├── 2. Run VLM second pass (targeted prompt on mismatching serial only)
  ├── 3. Apply threshold decision
  ├── 4. Log to VLM learning
  ├── 5. Send WA follow-up message to same group
  └── 6. Write result to serial_recheck_log table
```

---

## New API: `/api/activate/recheck-serial-mismatch`

### Request
```typescript
POST /api/activate/recheck-serial-mismatch
{
  dropNumber: string;
  source: 'auto' | 'manual';
  userId?: string; // for manual triggers
}
```

### Response
```typescript
{
  outcome: 'correction' | 'verify' | 'unclear';
  serialType: 'ups' | 'ont' | 'both';
  secondPassSerial: string | null;
  confidence: number | null;
  waMessageSent: boolean;
  learningLogged: boolean;
}
```

### Decision Threshold
| Condition | Outcome |
|-----------|---------|
| confidence > 0.85 AND second pass matches 1Map serial | `correction` |
| confidence 0.65–0.85, OR second pass still mismatches 1Map | `verify` |
| confidence < 0.65 OR VLM extraction fails | `unclear` |

### VLM Second Pass Prompt
Targeted prompt for the mismatching serial — explicitly instructs VLM to:
- Read ONLY the serial printed below the barcode
- Do NOT pad with zeros
- Rotate the image mentally if the sticker is at an angle
- Report confidence honestly

---

## New Database Table: `serial_recheck_log`

```sql
CREATE TABLE serial_recheck_log (
  id                      SERIAL PRIMARY KEY,
  drop_number             TEXT NOT NULL,
  triggered_by            TEXT NOT NULL CHECK (triggered_by IN ('auto', 'manual')),
  rechecker_user_id       TEXT,
  recheck_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  serial_type             TEXT NOT NULL CHECK (serial_type IN ('ups', 'ont', 'both')),
  first_pass_serial       TEXT,
  second_pass_serial      TEXT,
  second_pass_confidence  NUMERIC(4,3),
  outcome                 TEXT NOT NULL CHECK (outcome IN ('correction', 'verify', 'unclear')),
  onemap_serial           TEXT,
  wa_message_sent         BOOLEAN NOT NULL DEFAULT FALSE,
  wa_message_at           TIMESTAMPTZ
);

CREATE INDEX ON serial_recheck_log (drop_number);
CREATE INDEX ON serial_recheck_log (recheck_at DESC);
```

---

## Auto-Trigger (send-feedback modification)

In `pages/api/wa-monitor-send-feedback.ts`, after successfully sending feedback that contains a mismatch:

```typescript
// Fire-and-forget — do not await, does not affect send-feedback response
if (hasMismatch) {
  fetch('/api/activate/recheck-serial-mismatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dropNumber, source: 'auto' }),
  }).catch(() => {}); // silent — logged inside recheck endpoint
}
```

No change to the send-feedback response shape or timing.

---

## WA Follow-up Message Formats

All messages are sent to the same group as the original QA feedback.

### Outcome A — Correction (confidence > 0.85, matches 1Map)
```
🔍 Second Look — DR474849

We re-analysed the UPS serial photo.
✅ 1Map serial confirmed: GU18W12V2511020289
❌ Our first read was incorrect: GUJ8W12V12511020289

No action needed — 1Map is correct.
```

### Outcome B — Please verify (confidence 0.65–0.85, or still mismatches)
```
🔍 Second Look — DR474849

We re-analysed the UPS serial photo (72% confidence).
⚠️ Please verify the serial on the physical box vs 1Map.

📦 1Map: GU18W12V2511020289
📸 We read: GUJ8W12V12511020289
```

### Outcome C — Unclear (confidence < 0.65 or VLM failure)
```
🔍 Second Look — DR474849

⚠️ We couldn't read the UPS serial clearly.
Please verify the physical box serial against 1Map.

📦 1Map: GU18W12V2511020289
```

**Multi-serial mismatches:** If both UPS and ONT mismatch, the second pass runs on both and one combined message covers all mismatching serials.

---

## VLM Learning Integration

All mismatch recheck events feed learning data:

| Outcome | Learning Action |
|---------|----------------|
| Correction (A) | Log as **negative example** — "photo X was misread as Y, correct answer is Z" — injected into future few-shot prompts for `activate/wa_serial_recheck` |
| Please verify (B) | Log as **training candidate** — visible in VLM learning dashboard for human triage |
| Unclear (C) | Log as **training candidate** — flagged as low-quality photo needing prompt improvement |

### Learning Record Fields
```typescript
{
  module: 'activate',
  analysisType: 'wa_serial_recheck',
  photoUrl: string,
  dropNumber: string,
  firstPassSerial: string,
  secondPassSerial: string | null,
  onemapSerial: string,
  confidence: number | null,
  outcome: 'correction' | 'verify' | 'unclear',
  humanVerified: false,
}
```

### VLM Learning Dashboard Addition
New filter tab: **Serial Rechecks** — shows all mismatch recheck candidates awaiting human confirmation. Reviewers can:
- Mark as confirmed-correct (promotes to canonical example)
- Discard (removes from training set)

---

## Manual Button — QA Drop Detail Modal

- **Label:** `Re-analyse Serial`
- **Visibility:** Only shown when the drop has at least one serial mismatch
- **Disabled when:** A recheck was already performed in the last 24 hours (shows last result with timestamp)
- **Force re-run:** Available via a secondary `Re-run` link even within the 24h window

### UI States
| State | Display |
|-------|---------|
| Idle, no prior recheck | `Re-analyse Serial` button |
| Loading | Spinner, button disabled |
| Result — Correction | Green card: "1Map serial confirmed. Correction sent to group." |
| Result — Verify | Amber card: "Couldn't confirm. Verify message sent to group." |
| Result — Unclear | Red card: "Photo unclear. Verify message sent to group." |
| Already rechecked today | Grey card with last result + timestamp + `Re-run` link |

---

## Files Affected

| File | Change |
|------|--------|
| `pages/api/activate/recheck-serial-mismatch.ts` | **New** — core recheck logic |
| `pages/api/wa-monitor-send-feedback.ts` | **Modify** — add fire-and-forget recheck trigger |
| `src/modules/activate/services/waPhotoExtraction.ts` | **Modify** — expose second-pass targeted prompt |
| `src/modules/qa-learning/services/correctionService.ts` | **Modify** — add recheck learning record type |
| `src/modules/wa-monitor/components/DropDetailModal.tsx` | **Modify** — add Re-analyse Serial button + result card |
| Database migration | **New** — `serial_recheck_log` table |

---

## Out of Scope

- Changing the existing send-feedback message format
- Auto-correcting 1Map data (read-only)
- Retry logic if WA send fails (logged, no retry — fire-and-forget)
