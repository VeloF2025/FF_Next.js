import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool as repositoryPool } from '@/lib/db-pool';
import { recordOneMapConsent } from '@/modules/velocity-review/consentService';
import {
  claimNextExport,
  createExport,
  saveCandidateDecision,
  transitionExportState,
} from '@/modules/velocity-review/exportRepository';
import { createOrResumeRun } from '@/modules/velocity-review/runRepository';
import type { ExportState, PreparedCandidate } from '@/modules/velocity-review/types';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('Velocity review task-owned database URL is missing');

const db = new Pool({ connectionString: url, max: 1 });
const GRANTED_AT = new Date('2026-07-31T08:00:00.000Z');
const FINGERPRINT = 'a'.repeat(64);

function candidate(drNumber: string): PreparedCandidate {
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
  };
}

beforeAll(async () => {
  await db.query(`
    CREATE TABLE schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL
    )
  `);
  for (const filename of ['469_wa_subscriber_consent.sql', '472_velocity_review_export.sql']) {
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
    const duplicate = await createExport(run, first);

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
    const secondCandidate = candidate('DR-200');
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

    const firstClaim = await claimNextExport(new Date('2026-08-02T08:00:00.000Z'));
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
        SET state = $2, created_at = $3,
          next_attempt_at = CASE
            WHEN $2 = 'retryable_failure' THEN $4::timestamptz ELSE NULL
          END
        WHERE id = $1
      `, [first.export.id, state, new Date('2026-08-01T08:02:00.000Z'),
        new Date('2026-08-03T08:00:00.000Z')]);
      await expect(claimNextExport(new Date('2026-08-02T08:00:00.000Z'))).resolves.toBeNull();
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
    const secondClaim = await claimNextExport(new Date('2026-08-02T08:00:00.000Z'));
    expect(secondClaim?.id).toBe(second.export.id);
    expect(secondClaim?.attemptCount).toBe(1);
  });
});
