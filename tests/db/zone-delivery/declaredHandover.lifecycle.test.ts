import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Pool } from 'pg';
import {
  PROJECT_ID,
  actor,
  createZoneHandoverHarness,
  key,
} from './zoneHandoverTestSupport';

/**
 * Declared (operator-chosen) zone handover, against real Postgres.
 *
 * These paths cannot be covered by the mocked unit suite: both the
 * handed_over_at immutability trigger (migration 470, narrowed by 485) and the
 * absence of a zone_delivery_state row are database facts that a mocked write
 * repository hides completely.
 */
describe('declared zone handover lifecycle', () => {
  let pool: Pool;
  let harness: ReturnType<typeof createZoneHandoverHarness>;
  let service: ReturnType<typeof createZoneHandoverHarness>['service'];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
    // schema.test.ts rolls migration 470 back and forward again, which restores
    // its original unconditional immutability function and silently undoes 485
    // for whatever runs afterwards. Re-applying here (CREATE OR REPLACE, so
    // idempotent) keeps this suite independent of file ordering.
    await pool.query(await fs.readFile(path.join(
      process.cwd(),
      'scripts/migrations/sql/485_zone_delivery_handover_correction.sql',
    ), 'utf8'));
    harness = createZoneHandoverHarness(pool);
    service = harness.service;
  });
  beforeEach(() => harness.reset());
  afterAll(async () => { await pool.end(); });

  const zoneQaActor = () => actor('zone-qa-approve');
  const documentActor = () => actor('documents-manage');

  /** Register the FAC and CAC that declaring a handover requires. */
  async function registerHandoverDocuments(): Promise<number> {
    let rowVersion = 0;
    for (const [index, documentType] of (['fac', 'cac'] as const).entries()) {
      const view = await service.registerDocument({
        ...key,
        documentType,
        documentSource: 'vf_storage',
        sourceRef: `zone/${documentType}.pdf`,
        filename: `${documentType}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        checksumSha256: String(index + 4).repeat(64),
        effectiveAt: new Date().toISOString(),
        source: 'test',
        expectedRowVersion: rowVersion,
      }, documentActor());
      rowVersion = view.rowVersion;
    }
    return rowVersion;
  }

  it('declares a handover on a zone that has no delivery-state row yet', async () => {
    // The legacy population this command exists for: never scope-approved, so
    // zone_delivery_state has no row at all and getZone reports rowVersion 0.
    const before = await pool.query(
      'SELECT 1 FROM zone_delivery_state WHERE project_id = $1 AND zone_no = $2',
      [PROJECT_ID, key.zoneNo],
    );
    expect(before.rowCount).toBe(0);

    const rowVersion = await registerHandoverDocuments();

    const view = await service.declareZoneHandover({
      ...key,
      effectiveAt: '2026-05-08T00:00:00.000Z',
      source: 'works-qa',
      reason: 'Lawley zone handed over before FibreFlow tracked the site',
      expectedRowVersion: rowVersion,
    }, zoneQaActor());

    expect(view.handedOverAt).toBe('2026-05-08T00:00:00.000Z');
  });

  it('corrects a declared handover date — the real trigger permits it', async () => {
    // Migration 470 makes handed_over_at immutable; 485 narrows that to
    // "unless ff.zone_handover_correction is set". Without 485 this throws
    // 'handed_over_at is immutable once recorded' from Postgres.
    const rowVersion = await registerHandoverDocuments();

    const first = await service.declareZoneHandover({
      ...key,
      effectiveAt: '2026-08-01T00:00:00.000Z',
      source: 'works-qa',
      reason: 'initial capture',
      expectedRowVersion: rowVersion,
    }, zoneQaActor());
    expect(first.handedOverAt).toBe('2026-08-01T00:00:00.000Z');

    const corrected = await service.declareZoneHandover({
      ...key,
      effectiveAt: '2026-05-08T00:00:00.000Z',
      source: 'works-qa',
      reason: 'FAC date was captured wrong',
      expectedRowVersion: first.rowVersion,
    }, zoneQaActor());

    expect(corrected.handedOverAt).toBe('2026-05-08T00:00:00.000Z');
  });

  it('leaves handed_over_at immutable for every path that does not opt in', async () => {
    // The 485 gate must not become a blanket relaxation: an ad-hoc UPDATE, a
    // backfill or a future migration must still be refused.
    const rowVersion = await registerHandoverDocuments();
    await service.declareZoneHandover({
      ...key,
      effectiveAt: '2026-08-01T00:00:00.000Z',
      source: 'works-qa',
      reason: 'initial capture',
      expectedRowVersion: rowVersion,
    }, zoneQaActor());

    await expect(pool.query(
      `UPDATE zone_delivery_state
         SET handed_over_at = '2026-01-01T00:00:00Z', handover_snapshot = '{}'::jsonb
       WHERE project_id = $1 AND zone_no = $2`,
      [PROJECT_ID, key.zoneNo],
    )).rejects.toThrow(/immutable once recorded/);
  });

  it('refuses to declare without both an active FAC and CAC', async () => {
    await expect(service.declareZoneHandover({
      ...key,
      effectiveAt: new Date().toISOString(),
      source: 'works-qa',
      expectedRowVersion: 0,
    }, zoneQaActor())).rejects.toThrow(/requires an active/i);
  });

  it('refuses a stale row version', async () => {
    const rowVersion = await registerHandoverDocuments();
    await expect(service.declareZoneHandover({
      ...key,
      effectiveAt: new Date().toISOString(),
      source: 'works-qa',
      expectedRowVersion: rowVersion + 7,
    }, zoneQaActor())).rejects.toThrow(/reload and retry/i);
  });
});
