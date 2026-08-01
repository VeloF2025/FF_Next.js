import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool as repositoryPool } from '@/lib/db-pool';
import { getConsentForMsisdn } from '@/modules/communications/whatsapp/consent/consentRepo';
import { recordOneMapConsent } from '@/modules/velocity-review/consentService';
import {
  claimDueAcknowledgementCleanup,
  claimNextExport,
  createExport,
  saveCandidateDecision,
  transitionExportState,
} from '@/modules/velocity-review/exportRepository';
import { createOrResumeRun } from '@/modules/velocity-review/runRepository';
import type { ExportState, PreparedCandidate } from '@/modules/velocity-review/types';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('Velocity review task-owned database URL is missing');

const db = new Pool({ connectionString: url, max: 4 });
const GRANTED_AT = new Date('2026-07-31T08:00:00.000Z');
const FINGERPRINT = 'a'.repeat(64);
const CLAIM_GATE_KEY = 4_724_724;

function candidate(
  drNumber: string,
  overrides: Partial<PreparedCandidate> = {},
): PreparedCandidate {
  return {
    drNumber,
    sources: ['dr_submitted'],
    msisdn: '27821234567',
    phoneE164: '+27821234567',
    phoneFingerprint: FINGERPRINT,
    phoneSource: 'onemap',
    firstName: 'Test',
    lastName: 'Subscriber',
    consentEvidence: { source: 'onemap_home_signup', grantedAt: GRANTED_AT },
    ...overrides,
  };
}

async function waitForBlockedClaimUpdates(expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await db.query<{ blocked: number }>(`
      SELECT COUNT(*)::integer AS blocked
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query LIKE '%UPDATE velocity_review_exports%'
    `);
    if ((result.rows[0]?.blocked ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${expected} claim update(s) at the database gate`);
}

beforeAll(async () => {
  await db.query(`
    CREATE TABLE schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL
    )
  `);
  for (const filename of ['469_wa_subscriber_consent.sql', '474_velocity_review_export.sql']) {
    const migration = await readFile(
      path.join(process.cwd(), 'scripts/migrations/sql', filename),
      'utf8',
    );
    await db.query(migration);
  }
});

beforeEach(async () => {
  await db.query(`
    TRUNCATE velocity_review_candidates, velocity_review_exports,
      velocity_review_runs, wa_subscriber_consent RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  try {
    await repositoryPool.end();
  } finally {
    await db.end();
  }
});

describe('Velocity review repositories against task-owned PostgreSQL', () => {
  it('persists and reads back an absent-row OneMap grant without logging its phone', async () => {
    const msisdn = '27826667777';
    const drNumber = 'DR-ABSENT';
    const evidenceAt = new Date('2026-07-31T09:15:00.000Z');
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    ];

    try {
      const absent = await db.query(
        'SELECT 1 FROM wa_subscriber_consent WHERE msisdn = $1',
        [msisdn],
      );
      expect(absent.rowCount).toBe(0);

      const status = await recordOneMapConsent(candidate(drNumber, {
        msisdn,
        phoneE164: '+27826667777',
        consentEvidence: {
          source: 'onemap_install_signature',
          grantedAt: evidenceAt,
        },
      }));
      expect(status).toBe('granted');

      const persisted = await db.query<{
        status: string;
        drop_number: string;
        source: string;
        granted_at: Date;
      }>(`
        SELECT status, drop_number, source, granted_at
        FROM wa_subscriber_consent WHERE msisdn = $1
      `, [msisdn]);
      expect(persisted.rows).toEqual([{
        status: 'granted',
        drop_number: drNumber,
        source: 'onemap_install_signature',
        granted_at: evidenceAt,
      }]);

      const readback = await getConsentForMsisdn(msisdn);
      expect(readback).toMatchObject({
        status: 'granted',
        row: {
          status: 'granted',
          drop_number: drNumber,
          source: 'onemap_install_signature',
          granted_at: evidenceAt,
        },
      });
      const consoleOutput = consoleSpies
        .flatMap((spy) => spy.mock.calls.flat())
        .map(String)
        .join('\n');
      expect(consoleOutput).not.toContain(msisdn);
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });

  it('never changes withdrawals or downgrades manual and FNO grants', async () => {
    const withdrawnMsisdn = '27849998888';
    await db.query(`
      INSERT INTO wa_subscriber_consent
        (msisdn, status, drop_number, source, withdrawn_at, recorded_by, notes)
      VALUES ($1, 'withdrawn', 'DR-OLD', 'inbound_stop', $2, 'test', 'withdrawn')
    `, [withdrawnMsisdn, new Date('2026-07-30T08:00:00.000Z')]);
    const before = await db.query(`
      SELECT status, drop_number, source, granted_at, withdrawn_at, updated_at
      FROM wa_subscriber_consent WHERE msisdn = $1
    `, [withdrawnMsisdn]);

    await expect(recordOneMapConsent({
      ...candidate('DR-NEW'),
      msisdn: withdrawnMsisdn,
    })).resolves.toBe('withdrawn');
    const after = await db.query(`
      SELECT status, drop_number, source, granted_at, withdrawn_at, updated_at
      FROM wa_subscriber_consent WHERE msisdn = $1
    `, [withdrawnMsisdn]);
    expect(after.rows).toEqual(before.rows);

    for (const [msisdn, source] of [
      ['27831112222', 'ops_manual'],
      ['27835556666', 'fno_payload'],
    ] as const) {
      await db.query(`
        INSERT INTO wa_subscriber_consent
          (msisdn, status, drop_number, source, granted_at, recorded_by)
        VALUES ($1, 'granted', 'DR-OLD', $2, $3, 'test')
      `, [msisdn, source, GRANTED_AT]);
      await recordOneMapConsent({ ...candidate(`DR-${source}`), msisdn });
      const persisted = await db.query<{ source: string }>(
        'SELECT source FROM wa_subscriber_consent WHERE msisdn = $1',
        [msisdn],
      );
      expect(persisted.rows[0]?.source).toBe(source);
    }
  });

  it('reuses a canonical export but keeps a different DR on the same phone distinct', async () => {
    const run = await createOrResumeRun('2026-08-01');
    const first = candidate('DR-100');
    await saveCandidateDecision(run, { status: 'ready', candidate: first });
    const created = await createExport(run, first);
    const duplicate = await createExport(run, candidate('DR-100', {
      phoneFingerprint: 'b'.repeat(64),
    }));

    expect(created.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.export.id).toBe(created.export.id);

    const second = candidate('DR-200');
    await saveCandidateDecision(run, { status: 'ready', candidate: second });
    const distinct = await createExport(run, second);
    expect(distinct.created).toBe(true);
    expect(distinct.export.id).not.toBe(created.export.id);
    expect(distinct.export.state).toBe('ready');
  });

  it('claims oldest per phone and lets every held state block a second claim', async () => {
    const run = await createOrResumeRun('2026-08-01');
    const firstCandidate = candidate('DR-100');
    const secondCandidate = candidate('DR-200', { phoneFingerprint: 'b'.repeat(64) });
    await saveCandidateDecision(run, { status: 'ready', candidate: firstCandidate });
    await saveCandidateDecision(run, { status: 'ready', candidate: secondCandidate });
    const first = await createExport(run, firstCandidate);
    const second = await createExport(run, secondCandidate);
    await db.query(`
      UPDATE velocity_review_exports
      SET created_at = CASE WHEN id = $1 THEN $3::timestamptz ELSE $4::timestamptz END
      WHERE id IN ($1, $2)
    `, [first.export.id, second.export.id,
      new Date('2026-08-01T08:00:00.000Z'), new Date('2026-08-01T08:01:00.000Z')]);

    const eligibleIds = [first.export.id, second.export.id];
    const firstClaim = await claimNextExport(new Date('2026-08-02T08:00:00.000Z'), eligibleIds);
    expect(firstClaim?.id).toBe(first.export.id);
    expect(firstClaim?.attemptCount).toBe(1);
    await expect(transitionExportState(
      first.export.id,
      'ready',
      'completed',
    )).resolves.toBeNull();

    const heldStates: ExportState[] = [
      'upserting',
      'contact_upserted',
      'trigger_requested',
      'retryable_failure',
      'ambiguous',
      'ack_cleanup_pending',
    ];
    for (const state of heldStates) {
      await db.query(`
        UPDATE velocity_review_exports
        SET state = $2::text, created_at = $3,
          next_attempt_at = CASE
            WHEN $2::text = 'retryable_failure' THEN $4::timestamptz ELSE NULL
          END
        WHERE id = $1
      `, [first.export.id, state, new Date('2026-08-01T08:02:00.000Z'),
        new Date('2026-08-03T08:00:00.000Z')]);
      await expect(claimNextExport(new Date('2026-08-02T08:00:00.000Z'), eligibleIds)).resolves.toBeNull();
    }

    const attemptsBeforeRelease = await db.query<{ id: string; attempt_count: number }>(`
      SELECT id, attempt_count FROM velocity_review_exports
      WHERE id IN ($1, $2) ORDER BY id
    `, [first.export.id, second.export.id]);
    expect(new Map(attemptsBeforeRelease.rows.map((row) => [row.id, row.attempt_count]))).toEqual(
      new Map([[first.export.id, 1], [second.export.id, 0]]),
    );

    await db.query(
      "UPDATE velocity_review_exports SET state = 'completed' WHERE id = $1",
      [first.export.id],
    );
    const secondClaim = await claimNextExport(new Date('2026-08-02T08:00:00.000Z'), eligibleIds);
    expect(secondClaim?.id).toBe(second.export.id);
    expect(secondClaim?.attemptCount).toBe(1);
  });

  it('leaves an older out-of-scope export byte-for-byte unchanged', async () => {
    const run = await createOrResumeRun('2026-08-01');
    const outsideCandidate = candidate('DR-OUTSIDE');
    const insideCandidate = candidate('DR-INSIDE', { msisdn: '27831112222',
      phoneE164: '+27831112222', phoneFingerprint: 'b'.repeat(64) });
    for (const prepared of [outsideCandidate, insideCandidate]) {
      await saveCandidateDecision(run, { status: 'ready', candidate: prepared });
    }
    const outside = await createExport(run, outsideCandidate);
    const inside = await createExport(run, insideCandidate);
    await db.query('UPDATE velocity_review_exports SET created_at = $2 WHERE id = $1',
      [outside.export.id, new Date('2026-08-01T07:00:00Z')]);
    const before = await db.query('SELECT * FROM velocity_review_exports WHERE id = $1', [outside.export.id]);

    const claimed = await claimNextExport(new Date('2026-08-02T08:00:00Z'), [inside.export.id]);
    const after = await db.query('SELECT * FROM velocity_review_exports WHERE id = $1', [outside.export.id]);

    expect(claimed?.id).toBe(inside.export.id);
    expect(after.rows).toEqual(before.rows);
  });

  it('excludes not-due cleanup and claims due scoped cleanup only', async () => {
    const run = await createOrResumeRun('2026-08-01');
    const dueCandidate = candidate('DR-DUE');
    const laterCandidate = candidate('DR-LATER', { msisdn: '27831112222',
      phoneE164: '+27831112222', phoneFingerprint: 'b'.repeat(64) });
    for (const prepared of [dueCandidate, laterCandidate]) {
      await saveCandidateDecision(run, { status: 'ready', candidate: prepared });
    }
    const due = await createExport(run, dueCandidate);
    const later = await createExport(run, laterCandidate);
    const now = new Date('2026-08-02T08:00:00Z');
    const leaseUntil = new Date('2026-08-02T08:01:00Z');
    await db.query(`UPDATE velocity_review_exports SET state = 'ack_cleanup_pending',
      attempt_count = 1, next_attempt_at = CASE WHEN id = $1 THEN $3::timestamptz ELSE $4::timestamptz END
      WHERE id IN ($1, $2)`,
    [due.export.id, later.export.id, new Date('2026-08-02T07:59:00Z'), new Date('2026-08-02T08:01:00Z')]);

    const claimed = await claimDueAcknowledgementCleanup(
      now, [due.export.id, later.export.id], leaseUntil,
    );
    expect(claimed).toMatchObject({ id: due.export.id, state: 'ack_cleanup_pending',
      attemptCount: 2, nextAttemptAt: leaseUntil });
    await expect(claimDueAcknowledgementCleanup(
      new Date('2026-08-02T08:00:59Z'), [due.export.id], new Date('2026-08-02T08:01:59Z'),
    )).resolves.toBeNull();
    const restartAt = new Date('2026-08-02T08:01:01Z');
    const restartLease = new Date('2026-08-02T08:02:01Z');
    await expect(claimDueAcknowledgementCleanup(
      restartAt, [due.export.id], restartLease,
    )).resolves.toMatchObject({ id: due.export.id, attemptCount: 3, nextAttemptAt: restartLease });
    await expect(claimDueAcknowledgementCleanup(
      now, [later.export.id], new Date('2026-08-02T08:01:00Z'),
    )).resolves.toBeNull();
    const notDue = await db.query<{ state: ExportState; attempt_count: number; next_attempt_at: Date }>(
      'SELECT state, attempt_count, next_attempt_at FROM velocity_review_exports WHERE id = $1', [later.export.id]);
    expect(notDue.rows[0]).toEqual({ state: 'ack_cleanup_pending', attempt_count: 1,
      next_attempt_at: new Date('2026-08-02T08:01:00Z') });
  });

  it('serializes actual concurrent claims with row locks and held-phone exclusion', async () => {
    const run = await createOrResumeRun('2026-08-01');
    const phoneAOldest = candidate('DR-A-OLDEST');
    const phoneALater = candidate('DR-A-LATER');
    const phoneB = candidate('DR-B', {
      msisdn: '27831112222',
      phoneE164: '+27831112222',
      phoneFingerprint: 'b'.repeat(64),
    });
    for (const prepared of [phoneAOldest, phoneALater, phoneB]) {
      await saveCandidateDecision(run, { status: 'ready', candidate: prepared });
    }
    const oldestExport = await createExport(run, phoneAOldest);
    const laterExport = await createExport(run, phoneALater);
    const otherPhoneExport = await createExport(run, phoneB);
    const eligibleIds = [oldestExport.export.id, laterExport.export.id, otherPhoneExport.export.id];
    await db.query(`
      UPDATE velocity_review_exports SET created_at = CASE id
        WHEN $1 THEN $4::timestamptz
        WHEN $2 THEN $5::timestamptz
        ELSE $6::timestamptz
      END WHERE id IN ($1, $2, $3)
    `, [oldestExport.export.id, laterExport.export.id, otherPhoneExport.export.id,
      new Date('2026-08-01T08:00:00.000Z'), new Date('2026-08-01T08:01:00.000Z'),
      new Date('2026-08-01T08:02:00.000Z')]);

    const claims: Array<Promise<Awaited<ReturnType<typeof claimNextExport>>>> = [];
    let gateClient: PoolClient | null = null;
    try {
      await db.query(`
        CREATE FUNCTION velocity_review_claim_test_gate() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.state = 'upserting'
             AND OLD.state IN ('ready', 'retryable_failure') THEN
            PERFORM pg_advisory_xact_lock(${CLAIM_GATE_KEY});
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER velocity_review_claim_test_gate
        BEFORE UPDATE ON velocity_review_exports
        FOR EACH ROW EXECUTE FUNCTION velocity_review_claim_test_gate();
      `);
      gateClient = await db.connect();
      await gateClient.query('SELECT pg_advisory_lock($1)', [CLAIM_GATE_KEY]);

      claims.push(claimNextExport(new Date('2026-08-02T08:00:00.000Z'), eligibleIds));
      await waitForBlockedClaimUpdates(1);
      claims.push(claimNextExport(new Date('2026-08-02T08:00:00.000Z'), eligibleIds));
      await waitForBlockedClaimUpdates(2);

      await expect(
        claimNextExport(new Date('2026-08-02T08:00:00.000Z'), eligibleIds),
      ).resolves.toBeNull();
      await gateClient.query('SELECT pg_advisory_unlock($1)', [CLAIM_GATE_KEY]);
      const concurrentResults = await Promise.all(claims);

      expect(concurrentResults.map((row) => row?.id).sort()).toEqual([
        oldestExport.export.id,
        otherPhoneExport.export.id,
      ].sort());
      expect(new Set(concurrentResults.map((row) => row?.id)).size).toBe(2);
      expect(concurrentResults.every((row) => row?.attemptCount === 1)).toBe(true);

      const persisted = await db.query<{ id: string; state: ExportState; attempt_count: number }>(`
        SELECT id, state, attempt_count FROM velocity_review_exports
        WHERE id IN ($1, $2, $3)
      `, [oldestExport.export.id, laterExport.export.id, otherPhoneExport.export.id]);
      expect(new Map(persisted.rows.map((row) => [row.id, {
        state: row.state,
        attemptCount: row.attempt_count,
      }]))).toEqual(new Map([
        [oldestExport.export.id, { state: 'upserting', attemptCount: 1 }],
        [laterExport.export.id, { state: 'ready', attemptCount: 0 }],
        [otherPhoneExport.export.id, { state: 'upserting', attemptCount: 1 }],
      ]));
      await expect(
        claimNextExport(new Date('2026-08-02T08:00:00.000Z'), eligibleIds),
      ).resolves.toBeNull();
    } finally {
      if (gateClient) {
        await gateClient.query('SELECT pg_advisory_unlock($1)', [CLAIM_GATE_KEY])
          .catch(() => undefined);
        gateClient.release();
      }
      await Promise.allSettled(claims);
      await db.query(`
        DROP TRIGGER IF EXISTS velocity_review_claim_test_gate ON velocity_review_exports;
        DROP FUNCTION IF EXISTS velocity_review_claim_test_gate();
      `);
    }
  });
});
