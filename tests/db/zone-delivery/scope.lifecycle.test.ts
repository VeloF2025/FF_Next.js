import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import type { DeliveryActor } from '@/modules/construction-qa/zone-delivery/types/zoneDelivery.types';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const PON_ID = '47000000-0000-4000-8000-000000000001';
const SECOND_PON_ID = '47000000-0000-4000-8000-000000000011';
const THIRD_PON_ID = '47000000-0000-4000-8000-000000000012';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222223';
const key = { projectId: PROJECT_ID, zoneNo: 1 };
const now = () => new Date().toISOString();
const actor = (permission: string): DeliveryActor => ({
  userId: USER_ID,
  email: 'tester@test.local',
  permission: `construction-qa.zone-delivery.${permission}`,
});

describe('PON delivery scope lifecycle', () => {
  let pool: Pool;
  let service: ReturnType<typeof createZoneDeliveryService>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
    service = createZoneDeliveryService(pool);
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE zone_delivery_activity, zone_delivery_snag_links,
        pon_delivery_state, zone_delivery_documents, zone_delivery_state,
        construction_qa_reviews RESTART IDENTITY CASCADE
    `);
    await pool.query(`
      INSERT INTO pon_stage_tracking (id, project_id, zone_no, pon_no)
      VALUES ($1, $3, 1, 2), ($2, $3, 1, 3)
      ON CONFLICT (id) DO NOTHING
    `, [SECOND_PON_ID, THIRD_PON_ID, PROJECT_ID]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('approves included scope and requires audited reasons for exclusions and changes', async () => {
    const scope = [
      { ponStageId: PON_ID, scopeStatus: 'included' as const },
      { ponStageId: SECOND_PON_ID, scopeStatus: 'excluded' as const, reason: 'Not built' },
      { ponStageId: THIRD_PON_ID, scopeStatus: 'cancelled' as const, reason: 'Removed' },
    ];
    const approved = await service.updateScope({
      ...key,
      expectedRowVersion: 0,
      effectiveAt: now(),
      source: 'scope-register',
      pons: scope,
    }, actor('scope-manage'));
    expect(approved.pons.map(({ ponNo, scopeStatus }) => [ponNo, scopeStatus])).toEqual([
      [1, 'included'], [2, 'excluded'], [3, 'cancelled'],
    ]);
    const approval = await pool.query(`SELECT scope_approved_at, scope_approved_by, row_version
      FROM zone_delivery_state WHERE project_id = $1 AND zone_no = 1`, [PROJECT_ID]);
    const activityCount = (await service.getActivity(key)).length;
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, 'other@test.local')`, [OTHER_USER_ID]);
    const resubmitted = await service.updateScope({
      ...key, pons: scope, expectedRowVersion: approved.rowVersion,
      effectiveAt: now(), source: 'scope-register',
    }, { ...actor('scope-manage'), userId: OTHER_USER_ID, email: 'other@test.local' });
    expect(resubmitted.rowVersion).toBe(approved.rowVersion);
    expect((await pool.query(`SELECT scope_approved_at, scope_approved_by, row_version
      FROM zone_delivery_state WHERE project_id = $1 AND zone_no = 1`, [PROJECT_ID]))
      .rows[0]).toEqual(approval.rows[0]);
    expect(await service.getActivity(key)).toHaveLength(activityCount);
    await expect(service.updateScope({
      ...key,
      expectedRowVersion: approved.rowVersion,
      effectiveAt: now(),
      source: 'scope-register',
      pons: [{ ponStageId: SECOND_PON_ID, scopeStatus: 'included' }],
    }, actor('scope-manage'))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const changed = await service.updateScope({
      ...key,
      expectedRowVersion: approved.rowVersion,
      effectiveAt: now(),
      source: 'scope-register',
      reason: 'Authorized scope correction',
      pons: [{ ponStageId: SECOND_PON_ID, scopeStatus: 'included' }],
    }, actor('scope-manage'));
    expect(changed.pons.find(({ ponNo }) => ponNo === 2)?.scopeStatus).toBe('included');
    expect((await service.getActivity(key)).at(-1)).toMatchObject({
      action: 'scope_updated',
      reason: 'Authorized scope correction',
      previousValue: { scopeStatus: 'excluded', scopeReason: 'Not built' },
      newValue: { scopeStatus: 'included', scopeReason: null },
    });
  });
});
