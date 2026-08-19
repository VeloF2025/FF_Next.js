/**
 * Coverage for the two sync-path changes that ship with the 2026-08-19 SOW-gate
 * fix. Both run against the database shared by dev AND production, and neither
 * had a test.
 *
 * 1. syncMissingFromQaPhotoReviews no longer requires the DR to be in `drops`.
 *    That gate is why DR3022005, DR3022046, DR3022070, DR3022071 and DR3022079
 *    — fifteen minus ten of Themb'elihle's 2026-08-19 activations — never got a
 *    unified row at all.
 *
 * 2. repairProjectFromQaPhotoReviews is new, and is a near-copy of migration
 *    503's UPDATE. tests/migrations/503_*.test.ts proves that statement's
 *    semantics against a real Postgres — only-fills-NULL, latest submission
 *    wins, idempotent. This file pins the service's copy to that same statement
 *    so the proof carries over and the two cannot drift apart silently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: { query: (...args: unknown[]) => queryMock(...args) },
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/modules/activate/services/photoFetchService', () => ({
  fetchPhotosWithRetry: vi.fn(),
}));

/**
 * The throttle is module-level state (`lastSyncTime`), so a second call inside
 * the same module instance returns early and emits no SQL. Each test therefore
 * imports a fresh instance rather than sharing one.
 */
async function runSync(): Promise<void> {
  vi.resetModules();
  const mod = await import('@/modules/activate/services/drops/dropSyncService');
  await mod.syncMissingFromQaPhotoReviews();
}

const MIGRATION_503 = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/503_backfill_unified_reviews_from_whatsapp.sql'),
  'utf8'
);

/** Collapses whitespace so formatting differences don't count as drift. */
function normalise(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The statement the migration file actually executes, minus its comment header. */
function migrationStatement(): string {
  const start = MIGRATION_503.indexOf('UPDATE dr_photo_unified_reviews');
  expect(start, 'migration 503 has no UPDATE statement').toBeGreaterThan(-1);
  return normalise(MIGRATION_503.slice(start));
}

function emitted(): string[] {
  return queryMock.mock.calls.map((c) => String(c[0]));
}

function statementContaining(fragment: string): string {
  const matches = emitted().filter((s) => s.includes(fragment));
  expect(matches, `no statement containing "${fragment}"`).toHaveLength(1);
  return matches[0] as string;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('drop sync service', () => {
  it('inserts a missing DR without requiring it to be in the SOW import', async () => {
    await runSync();
    const insert = statementContaining('INSERT INTO dr_photo_unified_reviews');

    // The bug: this gate meant a DR the SOW import had missed never got a row,
    // so no amount of fixing the read queries could surface its submission.
    expect(insert).not.toMatch(/qa\.drop_number IN \(SELECT drop_number FROM drops\)/);
    // The submission is still the evidence — this is not an unconditional insert.
    expect(insert).toContain('FROM qa_photo_reviews qa');
    expect(insert).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM dr_photo_unified_reviews u/);
    // Concurrent writers race this insert; the conflict clause must survive.
    expect(insert).toContain('ON CONFLICT (drop_number) DO NOTHING');
  });

  it('repairs project with the statement migration 503 was proven with', async () => {
    await runSync();
    const repair = normalise(statementContaining('UPDATE dr_photo_unified_reviews'));

    // The service adds one clause the migration has no use for: a 30-day window,
    // so the recurring pass does not re-scan the whole table every 5 minutes.
    // Removing it must leave exactly migration 503's statement — that is what
    // makes the migration's Postgres-backed proof (only-fills-NULL, latest
    // submission wins, idempotent) apply to this copy too.
    const withoutWindow = repair
      .replace(/ AND u\.created_at > NOW\(\) - INTERVAL '30 days'/, '')
      .replace(/;?$/, ';');

    expect(withoutWindow).toBe(migrationStatement());
  });

  it('bounds the repair to a 30-day window', async () => {
    await runSync();
    const repair = statementContaining('UPDATE dr_photo_unified_reviews');

    // Without this the 5-minute pass scans every row in the table forever.
    expect(repair).toMatch(/u\.created_at > NOW\(\) - INTERVAL '30 days'/);
  });
});
