/**
 * Regression guard: /api/activate/ensure-data must resolve `project` when it
 * creates a skeleton unified row.
 *
 * This route is called when the QA wizard opens a DR with no row in
 * dr_photo_unified_reviews. It used to insert drop_number + timestamps only,
 * leaving `project` NULL. getProjectStats groups on COALESCE(project,'Unknown'),
 * so every such row surfaced in the Activate per-project table under a literal
 * "Unknown" project — a value that is itself in that query's EXCLUDED_PROJECTS
 * list. Measured on the live DB 2026-08-01: 37 NULL-project rows, 11 of them
 * resolvable via drops.
 *
 * `drops` is the source of truth for a DR's project (oesUnifiedRecordsService
 * resolves it the same way), so the insert reads it there first.
 *
 * `drops` is not exhaustive, though — it is the SOW import, and a DR the import
 * never loaded has no row in it at all. On 2026-08-19 five of Themb'elihle's
 * fifteen WhatsApp activations (DR3022005, DR3022046, DR3022070, DR3022071,
 * DR3022079) were exactly that, so they landed here with a NULL project and
 * vanished from the per-project table. qa_photo_reviews records the project the
 * field team submitted under, so the insert falls back to it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

// vi.hoisted: vi.mock factories are lifted above module-level consts, so the
// mock object has to be created in the hoisted scope to be referenceable there.
const { mockDb } = vi.hoisted(() => ({ mockDb: { query: vi.fn() } }));

vi.mock('@/lib/db', () => ({ db: mockDb, default: mockDb }));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: unknown) => handler,
  withRole: () => (handler: unknown) => handler,
  getSession: vi.fn(() => ({ user: { id: 'user-test', role: 'admin' } })),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/modules/activate/services/activityLogService', () => ({
  logPhotosSynced: vi.fn(),
}));

import handler from '@/pages/api/activate/ensure-data';

const DROP = 'DR470538';

/** Drives the handler down the "no unified row yet" branch. */
function stubQueriesForNewRecord() {
  mockDb.query.mockImplementation((sql: string) => {
    if (sql.includes('FROM dr_photo_unified_reviews')) return { rows: [] }; // no existing row
    if (sql.includes('FROM qa_photo_reviews')) return { rows: [{ drop_number: DROP }] };
    if (sql.includes('FROM oes_activations')) return { rows: [{ drop_number: DROP }] };
    return { rows: [] };
  });
}

function insertStatement(): string | undefined {
  return mockDb.query.mock.calls
    .map((c) => String(c[0]))
    .find((s) => s.includes('INSERT INTO dr_photo_unified_reviews'));
}

beforeEach(() => {
  mockDb.query.mockReset();
  // OneMap fetch is irrelevant here and must not hit the network.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
});

describe('ensure-data skeleton insert', () => {
  it('resolves project from drops instead of inserting NULL', async () => {
    stubQueriesForNewRecord();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: { dropNumber: DROP },
    });

    await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);

    const insert = insertStatement();
    expect(insert, 'no INSERT into dr_photo_unified_reviews was issued').toBeDefined();

    // The bug: the column was omitted entirely, so it defaulted to NULL.
    expect(insert).toContain('project');
    expect(insert).toMatch(/FROM\s+drops/);
    expect(insert).toMatch(/JOIN\s+projects/);
  });

  it('falls back to the submission when the DR is not in the SOW import', async () => {
    stubQueriesForNewRecord();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: { dropNumber: DROP },
    });

    await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);

    const insert = insertStatement() as string;

    // Without this arm the five 2026-08-19 Themb'elihle DRs insert NULL and
    // group under 'Unknown' — a bucket EXCLUDED_PROJECTS then discards.
    expect(insert).toMatch(/FROM\s+qa_photo_reviews/);
    // COALESCE, not a replacement: `drops` stays the first answer when it has one.
    expect(insert).toMatch(/COALESCE\(/);
    expect(insert.indexOf('FROM drops')).toBeLessThan(insert.indexOf('FROM qa_photo_reviews'));
  });

  it('keeps the insert single-valued — drops is not unique on drop_number alone', async () => {
    stubQueriesForNewRecord();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: { dropNumber: DROP },
    });

    await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);

    const insert = insertStatement() as string;

    // `drops` is UNIQUE on (project_id, drop_number) and qa_photo_reviews holds
    // one row per submission, so a resubmitted DR has several. A bare join could
    // match more than one row; both subqueries must be bounded.
    expect(insert.match(/LIMIT 1/g)).toHaveLength(2);
    // Deterministic, not merely single-valued — an unordered LIMIT 1 picks by plan.
    expect(insert.match(/ORDER BY/g)).toHaveLength(2);
    // ON CONFLICT must survive — concurrent inserts race with dr-acknowledgment.
    expect(insert).toContain('ON CONFLICT (drop_number) DO NOTHING');
  });
});
