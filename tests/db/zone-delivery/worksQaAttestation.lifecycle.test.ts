import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Pool } from 'pg';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import { submitPonByNumber } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryPonSubmit';
import { PROJECT_ID, actor, now } from './zoneHandoverTestSupport';

/**
 * The Works QA attestation path, against real Postgres.
 *
 * Zone 9 exists in Works QA and nowhere else — no pon_stage_tracking row, no
 * delivery state, no approved scope. Every assertion here failed before this
 * change, and none of them can fail in the unit suite, which mocks the
 * repository and therefore cannot see that the rows are missing.
 */
describe('Works QA attestation lifecycle', () => {
  let pool: Pool;
  let service: ReturnType<typeof createZoneDeliveryService>;
  const zone9 = { projectId: PROJECT_ID, zoneNo: 9 };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
    // schema.test.ts rolls 470 back and forward, restoring its unconditional
    // immutability function; re-applying 485 keeps this suite order-independent.
    await pool.query(await fs.readFile(path.join(
      process.cwd(),
      'scripts/migrations/sql/485_zone_delivery_handover_correction.sql',
    ), 'utf8'));
    service = createZoneDeliveryService(pool);
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE zone_delivery_activity, zone_delivery_snag_links,
        pon_delivery_state, zone_delivery_documents, zone_delivery_state
      RESTART IDENTITY CASCADE
    `);
    await pool.query(
      `DELETE FROM pon_stage_tracking WHERE project_id = $1 AND zone_no = 9`,
      [PROJECT_ID],
    );
  });

  afterAll(async () => { await pool.end(); });

  const canonicalRows = async () => {
    const { rows } = await pool.query<{ pon_no: number; sync_source: string }>(
      `SELECT pon_no, sync_source FROM pon_stage_tracking
       WHERE project_id = $1 AND zone_no = 9 ORDER BY pon_no`,
      [PROJECT_ID],
    );
    return rows;
  };

  const submitPon = (ponNo: number, effectiveAt = now(), reason?: string) =>
    submitPonByNumber(pool, service, {
      ...zone9,
      ponNo,
      effectiveAt,
      source: 'works-qa-toolbar',
      ...(reason ? { reason } : {}),
    }, actor('operations-confirm'));

  it('records a submission on a zone with no canonical rows and no approved scope', async () => {
    expect(await canonicalRows()).toHaveLength(0);

    const view = await submitPon(91);

    // Both writers are covered: pon_stage_tracking came from the Works QA PON
    // list, pon_delivery_state from the row that list implies.
    expect(await canonicalRows()).toEqual([
      { pon_no: 91, sync_source: 'works-qa' },
      { pon_no: 92, sync_source: 'works-qa' },
      { pon_no: 93, sync_source: 'works-qa' },
    ]);
    const submitted = view.pons.find(pon => pon.ponNo === 91);
    expect(submitted?.milestones.port_submitted).toBeDefined();
    // The zone still has no approved scope; the attestation did not invent one.
    const { rows } = await pool.query(
      `SELECT scope_approved_at FROM zone_delivery_state WHERE project_id = $1 AND zone_no = 9`,
      [PROJECT_ID],
    );
    expect(rows[0]?.scope_approved_at ?? null).toBeNull();
  });

  it('takes the PON list from both Works QA sources without duplicating the overlap', async () => {
    // PON 92 appears in sow_poles and pole_qa_photos; 91 only in the first, 93
    // only in the second. A UNION ALL here would violate the unique key.
    await submitPon(91);
    expect((await canonicalRows()).map(row => row.pon_no)).toEqual([91, 92, 93]);
  });

  it('leaves a 1Map row alone rather than restamping it as works-qa', async () => {
    await pool.query(`
      INSERT INTO pon_stage_tracking (project_id, zone_no, pon_no, sync_source)
      VALUES ($1, 9, 92, '1map')
    `, [PROJECT_ID]);

    await submitPon(91);

    expect(await canonicalRows()).toEqual([
      { pon_no: 91, sync_source: 'works-qa' },
      { pon_no: 92, sync_source: '1map' },
      { pon_no: 93, sync_source: 'works-qa' },
    ]);
  });

  it('is idempotent — a second submission corrects rather than duplicates', async () => {
    await submitPon(91);
    const before = await canonicalRows();

    // Re-recording an existing milestone is a correction, so it needs a reason.
    await submitPon(91, now(), 'corrected after checking SharePoint');

    expect(await canonicalRows()).toEqual(before);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS submissions FROM zone_delivery_activity
       WHERE action = 'port_submitted_confirmed'`,
    );
    expect(rows[0].submissions).toBe(2);
  });

  it('still refuses a gated milestone on the same unapproved scope', async () => {
    // The exemption is for port_submitted only. If this ever passes, the scope
    // guard has been removed rather than narrowed.
    await submitPon(91);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM pon_stage_tracking WHERE project_id = $1 AND zone_no = 9 AND pon_no = 91`,
      [PROJECT_ID],
    );
    const { rows: state } = await pool.query<{ row_version: number }>(
      `SELECT row_version FROM pon_delivery_state WHERE pon_stage_id = $1`,
      [rows[0]!.id],
    );

    await expect(service.confirmPonMilestone({
      ...zone9,
      ponStageId: rows[0]!.id,
      milestone: 'civil_complete',
      action: 'confirm',
      expectedRowVersion: state[0]!.row_version,
      effectiveAt: now(),
      source: 'works-qa-toolbar',
    }, actor('construction-confirm'))).rejects.toThrow(/scope/i);
  });

  it('declares a handover on a zone Works QA knows and the delivery tables do not', async () => {
    let rowVersion = 0;
    for (const [index, documentType] of (['fac', 'cac'] as const).entries()) {
      const view = await service.registerDocument({
        ...zone9,
        documentType,
        documentSource: 'vf_storage',
        sourceRef: `zone9/${documentType}.pdf`,
        filename: `${documentType}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        checksumSha256: String(index + 6).repeat(64),
        effectiveAt: now(),
        source: 'works-qa-toolbar',
        expectedRowVersion: rowVersion,
      }, actor('documents-manage'));
      rowVersion = view.rowVersion;
    }

    const view = await service.declareZoneHandover({
      ...zone9,
      effectiveAt: '2026-05-08T10:00:00.000Z',
      source: 'works-qa-toolbar',
      reason: 'handed over before FibreFlow tracked the site',
      expectedRowVersion: rowVersion,
    }, actor('zone-qa-approve'));

    expect(view.handedOverAt).toBe('2026-05-08T10:00:00.000Z');
  });
});
