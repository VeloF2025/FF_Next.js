# Velocity Fibre GHL Review Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed 09:00 SAST FibreFlow job that discovers prior-day Velocity DRs, records OneMap signup/install consent, deduplicates `(DR, phone)` exports, upserts contacts into Velocity GHL, and lets native GHL workflows own every WhatsApp send and response branch.

**Architecture:** A focused `velocity-review` module reads the approved FibreFlow source union, turns each DR into one validated candidate, persists candidate/run/export ledgers, and drives a transient GHL tag handshake through the official Contacts API. GHL Smart Lists and workflows send the Velo template and route replies; FibreFlow never sends WhatsApp directly and never equates workflow acknowledgement with delivery.

**Tech Stack:** Next.js Pages Router API route, TypeScript, PostgreSQL via `@/lib/db-pool`, Vitest, Node `fetch`, Node `crypto`, Nodemailer through the existing SMTP configuration, Bash/flock scheduler wrapper, HighLevel Contacts API v3, native GHL workflows.

## Global Constraints

- Use npm only; do not regenerate `bun.lock`.
- All code changes stay on a non-`master` branch and go through a pull request.
- The shared PostgreSQL database serves dev and production; migration application is a separate approval-gated operation.
- Production deploys require Hein's explicit approval and must use `bash scripts/deploy-local.sh production` outside 08:00–17:00 SAST on weekdays.
- Customer WhatsApp sends remain disabled until the Velo template, all GHL branches, the supervised pilot, and the production go-live watermark have been verified.
- FibreFlow may upsert GHL contacts and add/remove workflow tags; it must never send a WhatsApp message itself.
- No Make, Zapier, browser-driven recurring import, or direct WhatsApp sender may be introduced.
- The permanent deduplication key is `(normalised DR number, normalised customer phone)`; a different DR on the same phone remains eligible.
- Only customer/subscriber numbers are eligible. Technician, sender, crew, and submitter numbers are forbidden.
- OneMap `home_signup_date` or `dr_photo_unified_reviews.step_10_signature = true` is required consent evidence; an existing `withdrawn` consent row always wins.
- GHL DND, per-channel WhatsApp opt-out, and STOP state must never be cleared or overwritten.
- Raw customer phone numbers must not appear in logs, summaries, exceptions, fixtures copied from production, or PR text.
- Every target timestamp is converted to `Africa/Johannesburg` before extracting its calendar date.
- A GHL workflow acknowledgement is not WhatsApp delivery evidence.

---

## File Structure

### FibreFlow module

- Create `src/modules/velocity-review/.claude.md` — canonical path-scoped safety and ownership rules.
- Generate `src/modules/velocity-review/AGENTS.md` — mirror of the canonical module instructions.
- Create `src/modules/velocity-review/types.ts` — shared domain types and state vocabularies.
- Create `src/modules/velocity-review/phone.ts` — SA-mobile validation and HMAC fingerprinting.
- Create `src/modules/velocity-review/candidateRepository.ts` — target-day source-union query only.
- Create `src/modules/velocity-review/candidateService.ts` — phone conflict resolution, name fallback, and consent-evidence selection.
- Create `src/modules/velocity-review/consentService.ts` — fail-closed OneMap consent persistence using `wa_subscriber_consent`.
- Create `src/modules/velocity-review/runRepository.ts` — control row, scheduler lock, run creation, and catch-up date selection.
- Create `src/modules/velocity-review/exportRepository.ts` — candidate/export persistence and conditional state transitions.
- Create `src/modules/velocity-review/retry.ts` — retry classification and bounded exponential backoff.
- Create `src/modules/velocity-review/ghlClient.ts` — official HighLevel contact/custom-field/tag operations.
- Create `src/modules/velocity-review/processor.ts` — one-export GHL handshake and full date-run orchestration.
- Create `src/modules/velocity-review/summary.ts` — redacted summary model and HTML/text rendering.
- Create `src/modules/velocity-review/summaryEmail.ts` — SMTP delivery to configured operational recipients.
- Create `src/modules/velocity-review/index.ts` — narrow public exports for the cron route.

### API, scheduler, migration, and runbook

- Create `pages/api/cron/velocity-review-export.ts` — fail-closed cron endpoint.
- Create `pages/api/cron/__tests__/velocity-review-export.test.ts` — method/auth/mode/response tests.
- Create `scripts/cron-velocity-review-export.sh` — flocked production-first 09:00 runner.
- Create `scripts/migrations/sql/472_velocity_review_export.sql` — consent-source extension and durable ledgers.
- Create `scripts/migrations/sql/preflight_472_velocity_review_export.sql` — read-only shared-DB checks.
- Create `scripts/migrations/sql/rollback_472_velocity_review_export.sql` — guarded rollback preserving consent history.
- Create `tests/migrations/472_velocity_review_export.test.ts` — scratch-schema migration integration test.
- Create `docs/runbooks/velocity-ghl-review-export.md` — GHL objects, environment, scheduler, dry-run, pilot, and rollback procedure.
- Modify `.env.example` — placeholders and descriptions for GHL/summary/fingerprint configuration.

### Focused tests

- Create `src/modules/velocity-review/__tests__/phone.test.ts`.
- Create `src/modules/velocity-review/__tests__/candidateService.test.ts`.
- Create `src/modules/velocity-review/__tests__/consentService.test.ts`.
- Create `src/modules/velocity-review/__tests__/runRepository.test.ts`.
- Create `src/modules/velocity-review/__tests__/exportRepository.test.ts`.
- Create `src/modules/velocity-review/__tests__/retry.test.ts`.
- Create `src/modules/velocity-review/__tests__/ghlClient.test.ts`.
- Create `src/modules/velocity-review/__tests__/processor.test.ts`.
- Create `src/modules/velocity-review/__tests__/summary.test.ts`.

---

### Task 1: Module contract, shared types, and phone safety

**Files:**

- Create: `src/modules/velocity-review/.claude.md`
- Generate: `src/modules/velocity-review/AGENTS.md`
- Create: `src/modules/velocity-review/types.ts`
- Create: `src/modules/velocity-review/phone.ts`
- Test: `src/modules/velocity-review/__tests__/phone.test.ts`

**Interfaces:**

- Produces: `CandidateSource`, `CandidateDbRow`, `PreparedCandidate`, `CandidateDecision`, `ConsentEvidence`, `ExportState`, `RunSummaryCounts`.
- Produces: `normalizeSaMobileMsisdn(raw): string | null`, returning bare `27XXXXXXXXX`.
- Produces: `toE164(msisdn): string`, returning `+27XXXXXXXXX`.
- Produces: `fingerprintMsisdn(msisdn, secret): string`, returning a 64-character lowercase HMAC-SHA256 hex digest.

- [ ] **Step 1: Write the failing phone tests**

```ts
import { describe, expect, it } from 'vitest';
import { fingerprintMsisdn, normalizeSaMobileMsisdn, toE164 } from '../phone';

describe('normalizeSaMobileMsisdn', () => {
  it.each([
    ['082 123 4567', '27821234567'],
    ['+27 82 123 4567', '27821234567'],
    ['27821234567', '27821234567'],
    ['82-123-4567', '27821234567'],
  ])('normalises %s', (raw, expected) => {
    expect(normalizeSaMobileMsisdn(raw)).toBe(expected);
  });

  it.each(['', '0111234567', '+27211234567', '12345', '278212345678'])('rejects %s', (raw) => {
    expect(normalizeSaMobileMsisdn(raw)).toBeNull();
  });

  it('never accepts a technician JID or group JID as a customer mobile', () => {
    expect(normalizeSaMobileMsisdn('120363000000@g.us')).toBeNull();
  });
});

it('formats E.164 and fingerprints deterministically without exposing the phone', () => {
  expect(toE164('27821234567')).toBe('+27821234567');
  const digest = fingerprintMsisdn('27821234567', 'test-only-secret');
  expect(digest).toMatch(/^[a-f0-9]{64}$/);
  expect(digest).not.toContain('27821234567');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/modules/velocity-review/__tests__/phone.test.ts`

Expected: FAIL because `../phone` does not exist.

- [ ] **Step 3: Define the shared types and implement phone helpers**

Use the existing `extractMsisdnFromContact()` parser, then add the stricter mobile-prefix gate locally:

```ts
import { createHmac } from 'node:crypto';
import { extractMsisdnFromContact } from '@/modules/communications/whatsapp/utils/phone';

export function normalizeSaMobileMsisdn(raw: string | null | undefined): string | null {
  const msisdn = extractMsisdnFromContact(raw);
  return msisdn && /^27[6-8][0-9]{8}$/.test(msisdn) ? msisdn : null;
}

export function toE164(msisdn: string): string {
  if (!/^27[6-8][0-9]{8}$/.test(msisdn)) throw new Error('invalid SA mobile MSISDN');
  return `+${msisdn}`;
}

export function fingerprintMsisdn(msisdn: string, secret: string): string {
  if (!secret) throw new Error('VELOCITY_REVIEW_PHONE_HMAC_SECRET is required');
  return createHmac('sha256', secret).update(msisdn).digest('hex');
}
```

In `types.ts`, define the exact stable vocabularies:

```ts
export const CANDIDATE_SOURCES = [
  'dr_submitted', 'drops_installed', 'stock_installed',
  'oes_activated', 'pp_activated', 'olt_mismatch_created',
] as const;
export type CandidateSource = typeof CANDIDATE_SOURCES[number];
export type PhoneSource = 'onemap' | 'subscriber_cache' | 'qcontact';
export type ConsentEvidenceSource = 'onemap_home_signup' | 'onemap_install_signature';
export type QuarantineReason =
  | 'no_safe_phone' | 'phone_conflict' | 'consent_missing' | 'consent_withdrawn';
export type ExportState =
  | 'ready' | 'upserting' | 'contact_upserted' | 'trigger_requested'
  | 'retryable_failure' | 'ambiguous' | 'ack_cleanup_pending'
  | 'completed' | 'permanent_failure';

export interface ConsentEvidence {
  source: ConsentEvidenceSource;
  grantedAt: Date;
}

export interface CandidateDbRow {
  dr_number: string;
  sources: CandidateSource[];
  onemap_phone: string | null;
  subscriber_phone: string | null;
  qcontact_phone: string | null;
  contact_name: string | null;
  contact_surname: string | null;
  home_signup_date: Date | string | null;
  signature_present: boolean;
  signature_evidence_at: Date | string | null;
}

export interface PreparedCandidate {
  drNumber: string;
  sources: CandidateSource[];
  msisdn: string;
  phoneE164: string;
  phoneFingerprint: string;
  phoneSource: PhoneSource;
  firstName: string;
  lastName: string | null;
  consentEvidence: ConsentEvidence;
}

export type CandidateDecision =
  | { status: 'ready'; candidate: PreparedCandidate }
  | { status: 'quarantined'; drNumber: string; reason: QuarantineReason };
```

- [ ] **Step 4: Add the module rules and generate the mirror**

The canonical `.claude.md` must state: no technician phones; OneMap signup/signature evidence only; withdrawals win; no direct WhatsApp send; no raw-phone logs; SAST date boundaries; GHL acknowledgement is not delivery.

Run: `npm run agents:mirror && npm run agents:check`

Expected: `src/modules/velocity-review/AGENTS.md` is created and the mirror check passes.

- [ ] **Step 5: Run the focused test**

Run: `npx vitest run src/modules/velocity-review/__tests__/phone.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/velocity-review
git commit -m "feat: define Velocity review safety contract"
```

---

### Task 2: Durable schema and OneMap consent vocabulary

**Files:**

- Create: `scripts/migrations/sql/472_velocity_review_export.sql`
- Create: `scripts/migrations/sql/preflight_472_velocity_review_export.sql`
- Create: `scripts/migrations/sql/rollback_472_velocity_review_export.sql`
- Create: `src/modules/velocity-review/__tests__/schemaSync.test.ts`
- Create: `tests/migrations/472_velocity_review_export.test.ts`

**Interfaces:**

- Produces tables: `velocity_review_control`, `velocity_review_runs`, `velocity_review_candidates`, `velocity_review_exports`.
- Extends `wa_subscriber_consent.source` with `onemap_home_signup` and `onemap_install_signature`.
- Enforces permanent dedupe with `UNIQUE (dr_number, phone_fingerprint)`.
- Enforces one contact-level GHL handshake per phone with a partial unique index over every non-terminal claimed state.
- Produces a disabled-by-default, DB-audited pilot mode with one target date and an enforced limit of 1–50 recipients.

- [ ] **Step 1: Write the SQL contract test first**

Create assertions that the forward SQL contains:

```ts
expect(forward).toContain("'onemap_home_signup'");
expect(forward).toContain("'onemap_install_signature'");
expect(forward).toMatch(/UNIQUE \(dr_number, phone_fingerprint\)/);
expect(forward).toMatch(/'retryable_failure'.*'ambiguous'.*'ack_cleanup_pending'/s);
expect(forward).toContain('automation_enabled BOOLEAN NOT NULL DEFAULT FALSE');
expect(forward).toContain('go_live_date DATE');
expect(forward).toContain('pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE');
expect(forward).toContain('pilot_target_date DATE');
expect(forward).toContain('pilot_limit INTEGER');
expect(forward).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_velocity_review_one_phone_inflight');
expect(forward).not.toMatch(/^\s*BEGIN;\s*$/m);
expect(preflight).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
expect(rollback).toContain("SET source = 'import'");
```

- [ ] **Step 2: Run the contract test and confirm it fails**

Run: `npx vitest run src/modules/velocity-review/__tests__/schemaSync.test.ts`

Expected: FAIL because migration files do not exist.

- [ ] **Step 3: Write migration 472**

The forward migration must be unwrapped because `scripts/run-pending-migrations.sh` supplies the transaction. Use these table contracts:

```sql
CREATE TABLE IF NOT EXISTS velocity_review_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  go_live_date DATE,
  pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  pilot_target_date DATE,
  pilot_limit INTEGER CHECK (pilot_limit IS NULL OR pilot_limit BETWEEN 1 AND 50),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT automation_enabled OR (go_live_date IS NOT NULL AND NOT pilot_enabled)),
  CHECK (NOT pilot_enabled OR
    (NOT automation_enabled AND pilot_target_date IS NOT NULL AND pilot_limit IS NOT NULL))
);
INSERT INTO velocity_review_control (singleton) VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS velocity_review_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','running','partial','complete','blocked')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (summary_status IN ('pending','sent','failed','skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS velocity_review_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES velocity_review_runs(id) ON DELETE RESTRICT,
  target_date DATE NOT NULL,
  dr_number TEXT NOT NULL,
  source_flags TEXT[] NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ready','quarantined')),
  quarantine_reason TEXT CHECK (quarantine_reason IS NULL OR quarantine_reason IN
    ('no_safe_phone','phone_conflict','consent_missing','consent_withdrawn')),
  phone_fingerprint TEXT CHECK (phone_fingerprint IS NULL OR phone_fingerprint ~ '^[a-f0-9]{64}$'),
  export_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_date, dr_number)
);

CREATE TABLE IF NOT EXISTS velocity_review_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_run_id UUID NOT NULL REFERENCES velocity_review_runs(id) ON DELETE RESTRICT,
  first_target_date DATE NOT NULL,
  dr_number TEXT NOT NULL,
  phone_e164 TEXT NOT NULL CHECK (phone_e164 ~ '^\\+27[6-8][0-9]{8}$'),
  phone_fingerprint TEXT NOT NULL CHECK (phone_fingerprint ~ '^[a-f0-9]{64}$'),
  phone_source TEXT NOT NULL CHECK (phone_source IN ('onemap','subscriber_cache','qcontact')),
  source_flags TEXT[] NOT NULL,
  export_key UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ghl_contact_id TEXT,
  state TEXT NOT NULL CHECK (state IN
    ('ready','upserting','contact_upserted','trigger_requested','retryable_failure',
     'ambiguous','ack_cleanup_pending','completed','permanent_failure')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  error_code TEXT,
  upserted_at TIMESTAMPTZ,
  trigger_requested_at TIMESTAMPTZ,
  workflow_acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dr_number, phone_fingerprint)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'velocity_review_candidates_export_fk'
      AND conrelid = 'velocity_review_candidates'::regclass
  ) THEN
    ALTER TABLE velocity_review_candidates
      ADD CONSTRAINT velocity_review_candidates_export_fk
      FOREIGN KEY (export_id) REFERENCES velocity_review_exports(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_velocity_review_one_phone_inflight
  ON velocity_review_exports(phone_fingerprint)
  WHERE state IN (
    'upserting', 'contact_upserted', 'trigger_requested', 'retryable_failure',
    'ambiguous', 'ack_cleanup_pending'
  );
```

Replace the existing `wa_subscriber_consent_source_chk` constraint with the old values plus the two OneMap evidence sources. Guard constraint creation by catalog lookup so the migration is rerunnable. End by inserting `472_velocity_review_export.sql` into `schema_migrations` with `ON CONFLICT DO NOTHING`.

- [ ] **Step 4: Write preflight and rollback**

Preflight must report: whether migration 469 exists, current consent-source values, duplicate `(target_date, dr_number)` candidates if tables already exist, and duplicate `(dr_number, phone_fingerprint)` exports if tables already exist. It must remain read-only.

Rollback order:

1. map `onemap_home_signup` and `onemap_install_signature` consent rows to `source='import'` without changing status or timestamps;
2. restore the migration-469 source constraint;
3. drop candidate FK, indexes, and Velocity review tables in dependency order;
4. delete only the migration-472 tracker row.

- [ ] **Step 5: Write the scratch-schema integration test**

Follow `tests/migrations/471_hs_training_certificate_upload.test.ts`: create an isolated schema, install minimal stand-in source tables and migration 469's consent table, execute migration 472 twice, assert all CHECKs/indexes, prove invalid pilot-control combinations fail, prove a duplicate DR/phone export fails, prove two claimed non-terminal rows for one phone fail (including retryable and ambiguous states), prove a completed first DR permits a different DR on the same phone, and clean up the scratch schema in `afterAll`.

- [ ] **Step 6: Run schema tests**

Run:

```bash
npx vitest run src/modules/velocity-review/__tests__/schemaSync.test.ts
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run tests/migrations/472_velocity_review_export.test.ts
```

Expected: both PASS. If `TEST_DATABASE_URL` is unavailable, start the documented test database before claiming this task complete.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrations/sql/472_velocity_review_export.sql \
  scripts/migrations/sql/preflight_472_velocity_review_export.sql \
  scripts/migrations/sql/rollback_472_velocity_review_export.sql \
  src/modules/velocity-review/__tests__/schemaSync.test.ts \
  tests/migrations/472_velocity_review_export.test.ts
git commit -m "feat: add Velocity review export ledger"
```

---

### Task 3: Prior-day candidate union and deterministic preparation

**Files:**

- Create: `src/modules/velocity-review/candidateRepository.ts`
- Create: `src/modules/velocity-review/candidateService.ts`
- Test: `src/modules/velocity-review/__tests__/candidateService.test.ts`

**Interfaces:**

- Consumes: `CandidateDbRow`, `CandidateDecision`, `PreparedCandidate` from Task 1.
- Produces: `listCandidateRows(targetDate: string): Promise<CandidateDbRow[]>`.
- Produces: `prepareCandidate(row: CandidateDbRow, fingerprintSecret: string): CandidateDecision`.

- [ ] **Step 1: Write failing preparation tests**

Cover these exact cases:

```ts
expect(prepareCandidate(row({ onemap_phone: '0821234567', home_signup_date: '2026-07-01' }), SECRET))
  .toMatchObject({ status: 'ready', candidate: { msisdn: '27821234567', phoneSource: 'onemap' } });

expect(prepareCandidate(row({ onemap_phone: null, subscriber_phone: '0831112222', home_signup_date: '2026-07-01' }), SECRET))
  .toMatchObject({ status: 'ready', candidate: { phoneSource: 'subscriber_cache' } });

expect(prepareCandidate(row({ onemap_phone: '0821234567', qcontact_phone: '0849998888', home_signup_date: '2026-07-01' }), SECRET))
  .toEqual({ status: 'quarantined', drNumber: 'DR-1', reason: 'phone_conflict' });

expect(prepareCandidate(row({ onemap_phone: '0821234567', home_signup_date: null, signature_present: true, signature_evidence_at: '2026-07-31T08:00:00Z' }), SECRET))
  .toMatchObject({ status: 'ready', candidate: { consentEvidence: { source: 'onemap_install_signature' } } });

expect(prepareCandidate(row({ onemap_phone: '0821234567', home_signup_date: null, signature_present: false }), SECRET))
  .toEqual({ status: 'quarantined', drNumber: 'DR-1', reason: 'consent_missing' });
```

Also assert name fallback `firstName === 'there'`, source flags remain distinct, and input phone values never appear in a thrown error.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run src/modules/velocity-review/__tests__/candidateService.test.ts`

Expected: FAIL because services do not exist.

- [ ] **Step 3: Implement the target-date SQL as one parameterised query**

`candidateRepository.ts` must use `query()` from `@/lib/db-pool` and a `$1::date` parameter. The query must contain these CTEs and exact SAST conversions:

```sql
WITH params AS (SELECT $1::date AS target_date),
source_rows AS (
  SELECT UPPER(BTRIM(r.drop_number)) AS dr_number, 'dr_submitted'::text AS source
  FROM dr_photo_unified_reviews r, params p
  WHERE r.drop_number IS NOT NULL AND r.submitted_date = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(d.drop_number)), 'drops_installed'
  FROM drops d, params p
  WHERE d.drop_number IS NOT NULL
    AND COALESCE((d.installed_at AT TIME ZONE 'Africa/Johannesburg')::date,
                 d.installation_date) = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(s.installed_at_drop_number)), 'stock_installed'
  FROM stock_serials s, params p
  WHERE s.installed_at_drop_number IS NOT NULL AND s.installed_date = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(o.drop_number)), 'oes_activated'
  FROM oes_activations o, params p
  WHERE o.drop_number IS NOT NULL
    AND COALESCE((o.activation_datetime AT TIME ZONE 'Africa/Johannesburg')::date,
                 o.activation_date) = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(pp.resolved_drop_number)), 'pp_activated'
  FROM oes_pp_data pp, params p
  WHERE pp.resolved_drop_number IS NOT NULL
    AND pp.resolution_status = 'activated'
    AND (COALESCE(pp.activated_at, pp.first_resolved_at, pp.resolved_at)
         AT TIME ZONE 'Africa/Johannesburg')::date = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(m.drop_number)), 'olt_mismatch_created'
  FROM olt_mismatch_records m, params p
  WHERE m.drop_number IS NOT NULL
    AND (m.created_at AT TIME ZONE 'Africa/Johannesburg')::date = p.target_date
),
candidates AS (
  SELECT dr_number, array_agg(DISTINCT source ORDER BY source) AS sources
  FROM source_rows WHERE dr_number <> '' GROUP BY dr_number
),
latest_onemap AS (
  SELECT DISTINCT ON (UPPER(BTRIM(op.drop_number)))
    UPPER(BTRIM(op.drop_number)) AS dr_number,
    op.contact_number AS onemap_phone,
    op.contact_name,
    op.contact_surname,
    op.home_signup_date
  FROM onemap_properties op
  JOIN candidates c ON c.dr_number = UPPER(BTRIM(op.drop_number))
  ORDER BY UPPER(BTRIM(op.drop_number)), op.updated_at DESC NULLS LAST,
           op.import_id DESC NULLS LAST, op.id DESC
),
reviews AS (
  SELECT UPPER(BTRIM(r.drop_number)) AS dr_number,
    (array_agg(NULLIF(BTRIM(r.subscriber_phone), '')
      ORDER BY r.submitted_date DESC NULLS LAST, r.updated_at DESC NULLS LAST)
      FILTER (WHERE NULLIF(BTRIM(r.subscriber_phone), '') IS NOT NULL))[1] AS subscriber_phone,
    (array_agg(NULLIF(BTRIM(r.qcontact_phone), '')
      ORDER BY r.submitted_date DESC NULLS LAST, r.updated_at DESC NULLS LAST)
      FILTER (WHERE NULLIF(BTRIM(r.qcontact_phone), '') IS NOT NULL))[1] AS qcontact_phone,
    BOOL_OR(COALESCE(r.step_10_signature, FALSE)) AS signature_present,
    MAX(COALESCE(
      r.whatsapp_submitted_at,
      r.photos_fetched_at,
      r.created_at,
      r.submitted_date::timestamp AT TIME ZONE 'Africa/Johannesburg'
    )) FILTER (WHERE r.step_10_signature IS TRUE) AS signature_evidence_at
  FROM dr_photo_unified_reviews r
  JOIN candidates c ON c.dr_number = UPPER(BTRIM(r.drop_number))
  GROUP BY UPPER(BTRIM(r.drop_number))
)
SELECT c.dr_number, c.sources,
  o.onemap_phone, rv.subscriber_phone, rv.qcontact_phone,
  o.contact_name, o.contact_surname, o.home_signup_date,
  COALESCE(rv.signature_present, FALSE) AS signature_present,
  rv.signature_evidence_at
FROM candidates c
LEFT JOIN latest_onemap o USING (dr_number)
LEFT JOIN reviews rv USING (dr_number)
ORDER BY c.dr_number;
```

- [ ] **Step 4: Implement deterministic preparation**

Normalise the three allowed phone fields, remove nulls, and compare distinct values before applying source priority. Select `home_signup_date` first as consent evidence; otherwise use a true signature with a non-null evidence timestamp. Never inspect `sender_phone` or any technician field.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/modules/velocity-review/__tests__/candidateService.test.ts`

Expected: PASS.

- [ ] **Step 6: Run a read-only parity script against the shared DB**

Use a temporary `tsx` command or `psql` invocation without creating a tracked file. For target `2026-07-31`, expect the known planning snapshot: 157 unique DRs, 149 valid unconflicted phones, 8 without safe phones, and all 149 valid phones carrying signup or signature evidence. Treat drift as an investigation, never update tests to force the old count.

- [ ] **Step 7: Commit**

```bash
git add src/modules/velocity-review/candidateRepository.ts \
  src/modules/velocity-review/candidateService.ts \
  src/modules/velocity-review/__tests__/candidateService.test.ts
git commit -m "feat: discover Velocity review candidates"
```

---

### Task 4: Consent writer, run control, and idempotent repositories

**Files:**

- Create: `src/modules/velocity-review/consentService.ts`
- Create: `src/modules/velocity-review/runRepository.ts`
- Create: `src/modules/velocity-review/exportRepository.ts`
- Test: `src/modules/velocity-review/__tests__/consentService.test.ts`
- Test: `src/modules/velocity-review/__tests__/runRepository.test.ts`
- Test: `src/modules/velocity-review/__tests__/exportRepository.test.ts`

**Interfaces:**

- Produces: `recordOneMapConsent(input): Promise<'granted' | 'withdrawn'>`.
- Produces: `withVelocityReviewLock(work): Promise<{ acquired: boolean; value?: T }>`.
- Produces: `loadVelocityReviewControl(): Promise<VelocityReviewControl>` with camel-case `automationEnabled`, `goLiveDate`, `pilotEnabled`, `pilotTargetDate`, and `pilotLimit` fields.
- Produces: `selectDueDates(control, completedDates, sastYesterday): DueDateSelection`.
- Produces: `createOrResumeRun(targetDate): Promise<VelocityReviewRun>`.
- Produces: `saveCandidateDecision(run, decision): Promise<void>`.
- Produces: `createExport(run, candidate): Promise<{ created: boolean; export: VelocityReviewExport }>`.
- Produces conditional transition functions whose SQL always includes `WHERE id = $1 AND state = $2`.

- [ ] **Step 1: Write failing consent and catch-up tests**

Consent tests must prove:

- no row inserts a grant with the exact OneMap evidence source/date;
- an existing grant remains granted;
- an existing `withdrawn` row is returned as withdrawn and is never modified;
- a manual/FNO grant source is not downgraded to a OneMap source;
- logs and errors contain no MSISDN.

Catch-up tests must prove:

```ts
expect(selectDueDates(
  {
    automationEnabled: true,
    goLiveDate: '2026-08-01',
    pilotEnabled: false,
    pilotTargetDate: null,
    pilotLimit: null,
  },
  new Set(['2026-08-01']),
  '2026-08-03',
)).toEqual({ status: 'ready', dates: ['2026-08-02', '2026-08-03'] });

expect(selectDueDates(
  {
    automationEnabled: true,
    goLiveDate: '2026-07-01',
    pilotEnabled: false,
    pilotTargetDate: null,
    pilotLimit: null,
  }, new Set(), '2026-08-03'
)).toEqual({ status: 'blocked', reason: 'gap_older_than_7_days' });

expect(selectDueDates(
  {
    automationEnabled: false,
    goLiveDate: null,
    pilotEnabled: true,
    pilotTargetDate: '2026-07-31',
    pilotLimit: 10,
  },
  new Set(),
  '2026-08-03',
)).toEqual({ status: 'pilot', dates: ['2026-07-31'], limit: 10 });
```

Repository tests must prove the same DR/phone returns the existing export, a different DR on that phone creates another ready export, and conditional state changes reject stale expected states.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx vitest run \
  src/modules/velocity-review/__tests__/consentService.test.ts \
  src/modules/velocity-review/__tests__/runRepository.test.ts \
  src/modules/velocity-review/__tests__/exportRepository.test.ts
```

Expected: FAIL because repositories do not exist.

- [ ] **Step 3: Implement consent persistence without re-granting withdrawals**

Use one parameterised upsert whose `DO UPDATE` branches preserve withdrawn rows and stronger manual/FNO sources:

```sql
INSERT INTO wa_subscriber_consent
  (msisdn, status, drop_number, source, granted_at, recorded_by, notes)
VALUES ($1, 'granted', $2, $3, $4, 'system:velocity-review',
        'Velocity review consent evidenced by OneMap signup/install process')
ON CONFLICT (msisdn) DO UPDATE SET
  drop_number = CASE WHEN wa_subscriber_consent.status = 'granted'
                     THEN EXCLUDED.drop_number ELSE wa_subscriber_consent.drop_number END,
  source = CASE
    WHEN wa_subscriber_consent.status <> 'granted' THEN wa_subscriber_consent.source
    WHEN wa_subscriber_consent.source IN ('fno_payload','ops_manual') THEN wa_subscriber_consent.source
    ELSE EXCLUDED.source
  END,
  granted_at = CASE WHEN wa_subscriber_consent.status = 'granted'
                    THEN LEAST(wa_subscriber_consent.granted_at, EXCLUDED.granted_at)
                    ELSE wa_subscriber_consent.granted_at END,
  updated_at = CASE WHEN wa_subscriber_consent.status = 'granted'
                    THEN NOW() ELSE wa_subscriber_consent.updated_at END
RETURNING status;
```

Call the existing `getConsentForMsisdn()` after the write and fail closed unless it returns `granted`.

- [ ] **Step 4: Implement scheduler lock and date selection**

`withVelocityReviewLock()` holds a dedicated pool connection, calls `pg_try_advisory_lock(hashtext('velocity-review-export'))`, and always calls `pg_advisory_unlock` plus `release()` in `finally`. `selectDueDates()` returns exactly the configured pilot date and limit when pilot mode is enabled. In autonomous mode it starts at the DB control row's `go_live_date`, excludes complete run dates, sorts oldest first, and blocks when the oldest missing date is more than seven days before SAST yesterday. Invalid or contradictory control combinations fail closed even if database constraints were bypassed.

- [ ] **Step 5: Implement candidate/export repositories**

Persist every candidate decision by `(target_date, dr_number)`. For a ready candidate, insert the permanent export with `ON CONFLICT (dr_number, phone_fingerprint) DO NOTHING`, then read the canonical row. Candidate rows link to that export even when the export is a previously completed duplicate.

The claim query may select `ready` and due `retryable_failure` rows, but must take only the oldest non-terminal export for a phone and must skip a phone held by another claimed non-terminal export. Use `FOR UPDATE SKIP LOCKED` inside a short transaction and increment `attempt_count` only when a claim succeeds. The partial unique index is the final guard: retryable, ambiguous, and acknowledgement-cleanup rows keep the phone locked until they are resolved or terminal.

- [ ] **Step 6: Run focused tests**

Run the three Vitest files from Step 2.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/velocity-review/consentService.ts \
  src/modules/velocity-review/runRepository.ts \
  src/modules/velocity-review/exportRepository.ts \
  src/modules/velocity-review/__tests__
git commit -m "feat: persist Velocity review consent and exports"
```

---

### Task 5: HighLevel API adapter and retry classification

**Files:**

- Create: `src/modules/velocity-review/retry.ts`
- Create: `src/modules/velocity-review/ghlClient.ts`
- Test: `src/modules/velocity-review/__tests__/retry.test.ts`
- Test: `src/modules/velocity-review/__tests__/ghlClient.test.ts`
- Modify: `.env.example`

**Interfaces:**

- Produces: `loadVelocityReviewGhlConfig(env): VelocityReviewGhlConfig`.
- Produces: `HighLevelClient` implementing `upsertContact`, `getContact`, `addTags`, and `removeTags`.
- Produces: `HighLevelRequestError` with `status`, `retryable`, and `ambiguousMutation`.
- Produces: `nextRetryAt(now, attempt, retryAfterSeconds?): Date | null`, returning null after attempt 5.

- [ ] **Step 1: Write failing HTTP contract tests**

Mock `global.fetch` and assert:

- base URL is `https://services.leadconnectorhq.com`;
- headers include bearer token, JSON content type, accept, and `Version: 2021-07-28`;
- `POST /contacts/upsert` contains `locationId`, phone, name fields, source, and custom fields but omits `tags`, `dnd`, and `dndSettings`;
- `POST /contacts/:id/tags` adds `velocity-review-ready`;
- `DELETE /contacts/:id/tags` removes acknowledgement tags;
- 429 is retryable and respects `Retry-After`;
- 500 is retryable;
- 400/401/422 are permanent;
- a network/timeout failure during tag addition has `ambiguousMutation=true`;
- response/error parsing never includes a phone or token in the thrown message.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx vitest run src/modules/velocity-review/__tests__/retry.test.ts \
  src/modules/velocity-review/__tests__/ghlClient.test.ts
```

Expected: FAIL because client files do not exist.

- [ ] **Step 3: Implement strict environment loading**

Required values:

```text
VELOCITY_GHL_PRIVATE_INTEGRATION_TOKEN
VELOCITY_GHL_LOCATION_ID
VELOCITY_GHL_FIELD_DR_NUMBER_ID
VELOCITY_GHL_FIELD_EVENT_DATE_ID
VELOCITY_GHL_FIELD_SOURCES_ID
VELOCITY_GHL_FIELD_EXPORT_KEY_ID
VELOCITY_REVIEW_PHONE_HMAC_SECRET
VELOCITY_REVIEW_SUMMARY_TO
```

The loader trims values, throws a secret-free configuration error listing only missing variable names, and is invoked only for non-dry-run GHL work.

- [ ] **Step 4: Implement the official Contacts API operations**

Use:

```text
POST   /contacts/upsert
GET    /contacts/:contactId
POST   /contacts/:contactId/tags
DELETE /contacts/:contactId/tags
```

Set `createNewIfDuplicateAllowed: false`. Add/remove tags through their dedicated endpoints because the upsert `tags` field overwrites all existing contact tags. Use `AbortSignal.timeout(15000)` and parse only bounded error text. Represent WhatsApp DND as blocked when global `dnd === true` or `dndSettings.WhatsApp.status` is `active` or `permanent`.

- [ ] **Step 5: Implement retry timing**

Use delays of 1, 2, 4, 8, and 16 minutes, capped by attempt 5, unless a longer valid `Retry-After` is supplied. Tag-add ambiguity is never assigned an automatic retry time.

- [ ] **Step 6: Add redacted placeholders to `.env.example`**

Document purpose and required GHL scopes (`contacts.read`, `contacts.write`) without any live location ID, token, custom-field ID, email address, or secret.

- [ ] **Step 7: Run focused tests**

Run the two Vitest files from Step 2.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/velocity-review/retry.ts \
  src/modules/velocity-review/ghlClient.ts \
  src/modules/velocity-review/__tests__/retry.test.ts \
  src/modules/velocity-review/__tests__/ghlClient.test.ts \
  .env.example
git commit -m "feat: add Velocity HighLevel contact adapter"
```

---

### Task 6: Export processor and transient-tag acknowledgement

**Files:**

- Create: `src/modules/velocity-review/processor.ts`
- Create: `src/modules/velocity-review/index.ts`
- Test: `src/modules/velocity-review/__tests__/processor.test.ts`

**Interfaces:**

- Consumes all Task 3–5 interfaces.
- Produces: `processOneExport(exportRow, deps): Promise<ExportProcessResult>`.
- Produces: `runVelocityReviewExport(input, deps?): Promise<VelocityReviewRunResult>`.
- `deps` includes `now`, `sleep`, repositories, consent service, GHL client, and summary sender so tests perform no network or real DB work.

- [ ] **Step 1: Write failing processor tests**

Pin these state-machine paths:

1. OneMap consent is recorded and read as granted before any GHL call.
2. A withdrawn consent ends in `permanent_failure/consent_withdrawn` and makes zero GHL calls.
3. Upsert preserves names and sends the four exact custom-field values.
4. GHL WhatsApp DND ends in `permanent_failure/ghl_whatsapp_dnd` before tag addition.
5. Existing transient tags for a different export key end in `ambiguous/stale_transient_tag`.
6. Adding `velocity-review-ready`, then observing matching export key + `velocity-review-enrolled` + ready tag absent, advances to acknowledgement and removes the enrolled tag.
7. A timed-out tag-add becomes ambiguous and is not retried.
8. A retryable upsert schedules bounded backoff.
9. Same-phone/different-DR exports are processed sequentially rather than collapsed.
10. Dry-run calls only candidate discovery/preparation and performs no DB or GHL mutations.
11. Pilot mode processes only its configured target date, creates at most `pilotLimit` exports in normalised DR order, and leaves every additional ready candidate unexported for reconciliation.
12. Retryable, ambiguous, and acknowledgement-cleanup states prevent a second DR on the same phone from being claimed.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run src/modules/velocity-review/__tests__/processor.test.ts`

Expected: FAIL because `processor.ts` does not exist.

- [ ] **Step 3: Implement one-export processing in the approved order**

```text
claim export -> record/read consent -> upsert contact -> read back contact
-> block on GHL DND -> verify phone + custom export key
-> reject stale ready/enrolled tags -> add velocity-review-ready
-> poll acknowledgement -> persist acknowledged timestamp
-> remove velocity-review-enrolled -> mark completed
```

Poll at 5-second intervals for at most 30 seconds using injected `sleep`. The acknowledgement condition requires all three facts: current `velocity_review_export_key` matches, `velocity-review-enrolled` is present, and `velocity-review-ready` is absent. A timeout is ambiguous, not retryable.

- [ ] **Step 4: Implement full-run orchestration**

Inside `withVelocityReviewLock()`:

1. load the DB control row;
2. return disabled without writes when automation and pilot mode are both off, unless `dryRun` is true;
3. calculate SAST yesterday and due dates;
4. block and summarise gaps older than seven days;
5. create/resume each date run oldest first;
6. discover and persist candidate decisions;
7. record OneMap consent and create/reuse permanent exports;
8. process claimable exports serially;
9. calculate terminal counts and mark each run complete or partial;
10. send one summary for the invocation.

Serial processing is deliberate for the initial release: it respects GHL rate limits and guarantees the transient contact tags are not raced. Do not add a concurrency package.

In pilot mode, sort ready decisions by normalised DR number, create/process at most the DB-configured `pilot_limit`, and leave remaining ready candidates with `export_id=NULL`. Mark that date run `partial` and report `pilot_deferred`; do not interpret the deferred rows as failures. Autonomous mode must ignore pilot fields when `pilot_enabled=false`.

- [ ] **Step 5: Run processor tests**

Run: `npx vitest run src/modules/velocity-review/__tests__/processor.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the module test set**

Run: `npx vitest run src/modules/velocity-review`

Expected: all Task 1–6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/velocity-review/processor.ts \
  src/modules/velocity-review/index.ts \
  src/modules/velocity-review/__tests__/processor.test.ts
git commit -m "feat: process Velocity GHL review exports"
```

---

### Task 7: Redacted summaries, cron endpoint, and real scheduler

**Files:**

- Create: `src/modules/velocity-review/summary.ts`
- Create: `src/modules/velocity-review/summaryEmail.ts`
- Test: `src/modules/velocity-review/__tests__/summary.test.ts`
- Create: `pages/api/cron/velocity-review-export.ts`
- Create: `pages/api/cron/__tests__/velocity-review-export.test.ts`
- Create: `scripts/cron-velocity-review-export.sh`

**Interfaces:**

- Produces: `buildRunSummary(result): { subject: string; text: string; html: string }`.
- Produces: `sendVelocityReviewSummary(summary): Promise<boolean>`.
- Cron request: `POST` with optional `{ dryRun: true, targetDate?: 'YYYY-MM-DD' }`.
- Live scheduled calls send an empty JSON body; a target-date override is accepted only with `dryRun: true`.

- [ ] **Step 1: Write failing summary and route tests**

Summary tests assert all approved counts and recipients' display names appear, while sample phones, GHL tokens, contact IDs, and raw GHL errors do not. Subject format:

```text
Velocity review export — YYYY-MM-DD — complete|partial|blocked|pilot|dry run
```

Route tests assert:

- non-POST returns 405;
- missing server `CRON_SECRET` returns fail-closed 503/500 without running;
- wrong `x-cron-secret` returns 401;
- `{ targetDate, dryRun: false }` returns 400;
- invalid dates return 400;
- dry-run delegates with no mutation mode;
- success returns counts, dates, and `workflowAcknowledged`, never phones;
- thrown service errors return 500 with a generic message.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx vitest run src/modules/velocity-review/__tests__/summary.test.ts \
  pages/api/cron/__tests__/velocity-review-export.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement summary rendering and SMTP delivery**

Parse `VELOCITY_REVIEW_SUMMARY_TO` as a comma-separated non-empty list. Build both HTML and plain text. Use `resolveSmtpTransportSecurity()` and the existing `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` configuration. SMTP failure updates `summary_status='failed'` but never changes a completed export back to incomplete.

- [ ] **Step 4: Implement the cron endpoint**

Follow the fail-closed `x-cron-secret` pattern in `pages/api/cron/group-nonactivation-report.ts`. Do not instantiate the GHL client for dry-run. Log only date/count/status fields through `createLogger('velocity-review:cron')`.

- [ ] **Step 5: Implement the flocked shell wrapper**

Model `scripts/cron-hs-audit-reminders.sh` with:

- `set -euo pipefail`;
- lock before probing;
- production port 3000 first, dev 3005 only as fallback;
- `CRON_SECRET` read from the selected deploy env file;
- `curl --connect-timeout 5 --max-time 1800`;
- response parsing that prints target dates plus discovered/imported/duplicate/quarantined/acknowledged/failure counts;
- no token, phone, or response-body dump on failure.

The deployment crontab entry is:

```cron
0 9 * * * /home/velo/fibreflow-dev/scripts/cron-velocity-review-export.sh >> /home/velo/logs/velocity-review-export.log 2>&1
```

- [ ] **Step 6: Run tests and shell validation**

Run:

```bash
npx vitest run src/modules/velocity-review/__tests__/summary.test.ts \
  pages/api/cron/__tests__/velocity-review-export.test.ts
bash -n scripts/cron-velocity-review-export.sh
```

Expected: PASS and no shell syntax errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/velocity-review/summary.ts \
  src/modules/velocity-review/summaryEmail.ts \
  src/modules/velocity-review/__tests__/summary.test.ts \
  pages/api/cron/velocity-review-export.ts \
  pages/api/cron/__tests__/velocity-review-export.test.ts \
  scripts/cron-velocity-review-export.sh
git commit -m "feat: schedule Velocity review exports"
```

---

### Task 8: Draft the native GHL workflow and operational runbook

**Files:**

- Create: `docs/runbooks/velocity-ghl-review-export.md`

**Interfaces:**

- Produces four GHL custom fields, six operational tags, three Smart Lists, one initial review workflow, and the tested post-resolution workflow.
- Produces Meta template `velocity_experience_check_v2` with the approved Velo copy and three quick replies.
- No recurring automation exists outside FibreFlow and GHL.

- [ ] **Step 1: Create the GHL custom fields in the Velocity location**

Create text/date fields with these stable names and record their generated IDs only in deployment environment configuration:

```text
velocity_dr_number
velocity_dr_event_date
velocity_dr_sources
velocity_review_export_key
```

Do not put IDs in the tracked runbook.

- [ ] **Step 2: Create the tags and Smart Lists**

Create exact tags:

```text
velocity-review-ready
velocity-review-enrolled
velocity-review-happy-connected
velocity-review-installation-issue
velocity-review-not-connected
velocity-review-suppress
```

Create Smart Lists filtered by happy, installation issue, and not connected. Smart Lists are views; no CSV import step is permitted.

- [ ] **Step 3: Submit the Velo-branded template**

Template name: `velocity_experience_check_v2`.

Body:

```text
Hi {{1}}, it's Velo from Velocity Fibre. Our team recently completed the fibre installation at your property. How did the installation go, and is your fibre connection working?
```

Quick replies, in order:

```text
Happy & connected
Installation issue
Not connected
```

Use `there` as FibreFlow's value for `{{1}}` when the first name is missing. Record Meta status and approval date in the runbook; do not publish the sending workflow while approval is pending.

- [ ] **Step 4: Build the initial workflow as Draft**

Workflow name: `Velocity - Installation Experience - Velo`.

Configuration:

1. trigger on tag added `velocity-review-ready`;
2. allow multiple entries;
3. add `velocity-review-enrolled`;
4. remove `velocity-review-ready`;
5. send `velocity_experience_check_v2`;
6. branch on the three quick replies;
7. happy: add happy tag, remove suppression/problem tags, send active `velocity_review_request_v1`;
8. installation issue: add suppression + installation issue tags, assign Chantall, notify Chantall immediately;
9. not connected: add suppression + not-connected tags, assign Chantall, notify Chantall immediately;
10. unmatched reply: no review request; leave for manual GHL triage.

- [ ] **Step 5: Validate the post-resolution workflow as Draft**

Open `Velocity - Review Ask - Post Resolution`. Confirm its trigger is `issue-resolved`, it sends the approved review request, and it does not run while suppression remains unresolved. Chantall remains the person who explicitly applies `issue-resolved`.

- [ ] **Step 6: Write the runbook**

Document:

- exact GHL object names and branch actions;
- required environment variable names, never values;
- read-only dry-run command;
- migration preflight and approval boundary;
- internal-contact test procedure for every branch;
- how to confirm `velocity-review-enrolled` acknowledgement separately from WhatsApp delivery;
- Chantall/Hein/Michael summary verification;
- go-live control SQL with placeholders;
- pilot control SQL that atomically sets `pilot_enabled=true`, `pilot_target_date`, and `pilot_limit` while autonomous mode remains disabled;
- scheduler installation and `crontab -l` readback;
- pause procedure: set `automation_enabled=false`, leave ledgers intact, and unpublish the GHL workflow;
- rollback procedure and why withdrawn consent rows are preserved.

- [ ] **Step 7: Verify tracked docs and agent mirrors**

Run:

```bash
npm run agents:check
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/runbooks/velocity-ghl-review-export.md
git commit -m "docs: add Velocity GHL review runbook"
```

---

### Task 9: End-to-end verification, PR, and disabled deployment

**Files:**

- Modify only files found defective by the verification below; do not expand scope.

**Interfaces:**

- Produces a reviewed PR whose code can be deployed with automation disabled.
- Does not apply the shared migration, publish GHL workflows, add the production cron entry, or send customer messages.

- [ ] **Step 1: Run all focused tests**

```bash
npx vitest run src/modules/velocity-review pages/api/cron/__tests__/velocity-review-export.test.ts
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run tests/migrations/472_velocity_review_export.test.ts
bash -n scripts/cron-velocity-review-export.sh
npm run agents:check
```

Expected: all PASS.

- [ ] **Step 2: Run repository gates**

```bash
npm run ci:quick
npm run antihall
```

Expected: quick CI exits 0. Record pre-existing non-blocking TypeScript warnings separately; changed files must remain zero-tolerance clean. Attempt `npm run antihall`; on the current upstream baseline it may report `MODULE_NOT_FOUND` for the referenced but untracked `scripts/antihall-validator.cjs`. Record that exact baseline honestly, do not claim antihall passed, and verify every newly referenced repository symbol with focused tests, TypeScript, and `rg`. Fixing the unrelated validator packaging defect is outside this feature's scope.

- [ ] **Step 3: Run the read-only production preflight**

```bash
PGPASSWORD="$PGPASSWORD" psql "$DATABASE_URL" \
  -f scripts/migrations/sql/preflight_472_velocity_review_export.sql
```

Expected: migration 469 present, no conflicting existing Velocity-review rows, and no writes. Paste only aggregate output into the approval evidence; redact connection details.

- [ ] **Step 4: Exercise the cron route in dry-run mode on dev**

```bash
curl -sS -X POST https://dev.fibreflow.app/api/cron/velocity-review-export \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"dryRun":true,"targetDate":"2026-07-31"}'
```

Expected: the response contains dates and aggregate counts only, performs no GHL/ledger writes, and is reconciled against the live source query.

- [ ] **Step 5: Perform an independent review and create the PR**

Use the repository's required independent review workflow. Address findings, rerun Step 1 and Step 2, then push with `gh` and open a PR. The PR must state explicitly:

- code and draft GHL configuration prepared;
- migration not applied;
- GHL workflows remain Draft;
- scheduler not installed;
- no customer contact occurred;
- production activation checklist remains outstanding.

- [ ] **Step 6: Deploy code to dev only after review approval**

Run the documented dev deploy script. Verify the dry-run endpoint against dev with automation disabled. Do not apply migration 472 to the shared DB without the separate migration approval, because dev and production share it.

- [ ] **Step 7: Commit any verification-only fixes**

```bash
git add <only-the-files-fixed-during-verification>
git commit -m "fix: address Velocity review verification findings"
```

Skip this commit when no fixes were needed.

---

### Task 10: Approval-gated pilot and autonomous activation

**Files:**

- No repository changes expected; record evidence in the PR or approved operations ticket, not in a file containing customer data.

**Interfaces:**

- Consumes the reviewed/merged code, approved migration, approved Meta template, and tested draft workflows.
- Produces one supervised pilot and, only after acceptance, the autonomous 09:00 SAST workflow.

- [ ] **Step 1: Obtain explicit approval for shared migration and production activation**

Approval must name migration 472, production deployment, publishing both GHL workflows, the supervised pilot size/date, the go-live watermark, and installation of the 09:00 cron entry.

- [ ] **Step 2: Apply migration 472 through the approved migration process**

Run preflight again immediately before apply. Apply through the repository migration runner, then read back tables, constraints, source vocabulary, and the disabled control row. Do not enable automation yet.

- [ ] **Step 3: Test with internal contacts**

Use internal test contacts only. Verify:

- upsert preserves existing names/tags/DND;
- ready tag causes enrolled acknowledgement;
- all three buttons route correctly;
- both problem branches assign and notify Chantall;
- `issue-resolved` triggers the post-resolution review workflow;
- non-button replies never receive an automatic review request;
- actual WhatsApp delivery is visible separately from workflow acknowledgement.

- [ ] **Step 4: Publish workflows and run the approved small pilot**

Set the approval-specific pilot date and limit in one audited transaction, substituting only the approved literal values:

```sql
UPDATE velocity_review_control
SET automation_enabled = FALSE,
    go_live_date = NULL,
    pilot_enabled = TRUE,
    pilot_target_date = DATE '<APPROVED-PILOT-DATE>',
    pilot_limit = <APPROVED-LIMIT-1-TO-50>,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING automation_enabled, go_live_date, pilot_enabled, pilot_target_date, pilot_limit;
```

Invoke the normal cron endpoint once and reconcile every pilot row: candidate, consent evidence, GHL contact, workflow acknowledgement, WhatsApp delivery, and branch outcome. Confirm the number of created exports is no greater than `pilot_limit` and the date run remains `partial` with the remainder reported as `pilot_deferred`. Stop on any duplicate, wrong recipient, DND breach, or assignment failure. After reconciliation, disable pilot mode in an audited update; do not change source code to alter the pilot population.

- [ ] **Step 5: Set the go-live watermark and enable automation**

After pilot acceptance, set `go_live_date` to the explicitly approved first operational date, set `automation_enabled=true`, and atomically clear `pilot_enabled`, `pilot_target_date`, and `pilot_limit`. Verify readback before installing the cron entry.

- [ ] **Step 6: Install and prove the scheduler**

Install the exact `0 9 * * *` entry from Task 7, run `crontab -l` as the scheduler user, then observe the next scheduled run. Verify the summary reaches Chantall, Hein, and Michael and that counts reconcile with GHL workflow acknowledgements.

- [ ] **Step 7: Monitor the first seven autonomous days**

Each day reconcile: due date, unique DRs, consent evidence, contacts upserted, duplicates suppressed, quarantines, GHL acknowledgements, actual deliveries, support branches, and failures. A gap older than seven days or any ambiguous tag mutation pauses automation for manual reconciliation.

---

## Definition of Done

- The merged FibreFlow code discovers every approved source event by SAST date.
- All valid recipients have persisted OneMap signup or signed-install consent evidence; withdrawals win.
- Permanent `(DR, phone)` deduplication survives reruns, retries, and catch-up.
- The same phone on a genuinely different DR can re-enter after the prior tag handshake.
- GHL contact upserts preserve DND and existing tags; FibreFlow never sends WhatsApp.
- Native GHL automation sends Velo's approved template and routes happy/issue/not-connected responses.
- Chantall receives problem assignments and notifications; `issue-resolved` drives post-resolution review.
- Missed days catch up oldest-first within seven days; older gaps fail closed.
- Summaries reach Chantall, Hein, and Michael without customer phone data.
- The scheduler is installed and observed firing at 09:00 SAST.
- Workflow acknowledgement, actual message delivery, and customer response are reported as distinct states.
