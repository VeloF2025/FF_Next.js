import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import type { DeliveryActor, ZoneDeliveryView } from '@/modules/construction-qa/zone-delivery/types/zoneDelivery.types';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const PON_ID = '47000000-0000-4000-8000-000000000001';
const SNAG_ID = '47000000-0000-4000-8000-000000000002';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const key = { projectId: PROJECT_ID, zoneNo: 1 };
const now = () => new Date().toISOString();
const actor = (permission: string): DeliveryActor => ({
  userId: USER_ID,
  email: 'tester@test.local',
  permission: `construction-qa.zone-delivery.${permission}`,
});
describe('zone QA and automatic handover lifecycle', () => {
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
      DELETE FROM pon_stage_tracking
      WHERE project_id = $1 AND zone_no = 1 AND id <> $2
    `, [PROJECT_ID, PON_ID]);
    await pool.query(`UPDATE snags SET status = 'open' WHERE id = $1`, [SNAG_ID]);
    for (const discipline of ['civil', 'optical']) {
      await pool.query(`
        INSERT INTO construction_qa_reviews (
          project_id, discipline, feature_type, feature_id,
          zone_no, pon_no, workflow_status
        ) VALUES ($1, $2, 'pole', $2 || '-1', 1, 1, 'approved')
      `, [PROJECT_ID, discipline]);
    }
  });
  afterAll(async () => { await pool.end(); });
  async function waitForLock(fragment: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rowCount } = await pool.query(`
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query LIKE $1 LIMIT 1
      `, [`%${fragment}%`]); if (rowCount) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${fragment} lock`); }
  async function setupLivePon(initial?: ZoneDeliveryView): Promise<ZoneDeliveryView> {
    let view = initial ?? await service.updateScope({
      ...key, pons: [{ ponStageId: PON_ID, scopeStatus: 'included' }],
      expectedRowVersion: 0, effectiveAt: now(), source: 'handover-test',
    }, actor('scope-manage'));
    view = await service.registerDocument({
      ...key, ponStageId: PON_ID, documentType: 'test_pack',
      documentSource: 'vf_storage', sourceRef: 'pack.pdf', filename: 'pack.pdf',
      mimeType: 'application/pdf', sizeBytes: 5, checksumSha256: '1'.repeat(64),
      expectedRowVersion: view.rowVersion, effectiveAt: now(), source: 'handover-test',
    }, actor('documents-manage'));
    for (const [milestone, permission] of [
      ['civil_complete', 'construction-confirm'],
      ['optical_complete', 'construction-confirm'],
      ['testing_passed', 'testing-confirm'],
      ['port_submitted', 'operations-confirm'],
      ['port_approved', 'operations-confirm'],
      ['technically_live', 'operations-confirm'],
    ] as const) {
      const pon = view.pons[0]!;
      view = await service.confirmPonMilestone({
        ...key, ponStageId: PON_ID, milestone, action: 'confirm',
        expectedRowVersion: pon.rowVersion, effectiveAt: now(), source: 'handover-test',
      }, actor(permission));
    }
    return view;
  }
  async function registerZoneDocument(view: ZoneDeliveryView, documentType: 'fac' | 'cac',
    checksum: string): Promise<ZoneDeliveryView> {
    return service.registerDocument({
      ...key, documentType, documentSource: 'vf_storage',
      sourceRef: `${documentType}.pdf`, filename: `${documentType}.pdf`,
      mimeType: 'application/pdf', sizeBytes: 6, checksumSha256: checksum,
      expectedRowVersion: view.rowVersion, effectiveAt: now(), source: 'handover-test',
    }, actor('documents-manage'));
  }
  async function recordQa(view: ZoneDeliveryView, discipline: 'civil' | 'optical',
    status: 'in_progress' | 'passed' | 'failed', snagIds: string[] = [],
    reason?: string): Promise<ZoneDeliveryView> {
    return service.recordZoneQa({
      ...key, discipline, status, notes: `${discipline} ${status}`, snagIds,
      expectedRowVersion: view.rowVersion, effectiveAt: now(), source: 'handover-test',
      ...(reason ? { reason } : {}),
    }, actor('zone-qa-approve'));
  }
  it('keeps civil and optical QA independent and links failed-QA snags', async () => {
    let view = await service.updateScope({
      ...key, pons: [{ ponStageId: PON_ID, scopeStatus: 'included' }],
      expectedRowVersion: 0, effectiveAt: now(), source: 'qa-test',
    }, actor('scope-manage'));
    await expect(recordQa(view, 'civil', 'passed'))
      .rejects.toMatchObject({ code: 'PREREQUISITE_BLOCKED' });
    view = await setupLivePon(view);
    view = await recordQa(view, 'civil', 'failed', [SNAG_ID]);
    expect(view.civilQa.status).toBe('failed');
    expect(view.opticalQa.status).toBe('not_started');
    view = await recordQa(view, 'optical', 'passed');
    expect(view.civilQa.status).toBe('failed');
    expect(view.opticalQa.status).toBe('passed');
    await expect(recordQa(view, 'civil', 'passed'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    view = await recordQa(view, 'civil', 'passed', [], 'Civil repairs verified');
    expect(view.civilQa.status).toBe('passed');
    const { rows } = await pool.query<{
      handover_blocking: boolean;
      qa_discipline: string | null;
    }>(`
      SELECT handover_blocking, qa_discipline
      FROM zone_delivery_snag_links WHERE snag_id = $1
    `, [SNAG_ID]);
    expect(rows[0]!.handover_blocking).toBe(true);
    expect(rows[0]!.qa_discipline).toBe('civil');
    expect(view.snags).toEqual([
      expect.objectContaining({
        snagId: SNAG_ID,
        status: 'open',
        qaDiscipline: 'civil',
        handoverBlocking: true,
      }),
    ]);
  });
  it('does not confirm construction while canonical QA is concurrently rejected', async () => {
    const view = await service.updateScope({
      ...key, pons: [{ ponStageId: PON_ID, scopeStatus: 'included' }],
      expectedRowVersion: 0, effectiveAt: now(), source: 'qa-race',
    }, actor('scope-manage'));
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(`
      UPDATE construction_qa_reviews SET workflow_status = 'rejected'
      WHERE project_id = $1 AND zone_no = 1 AND pon_no = 1 AND discipline = 'civil'
    `, [PROJECT_ID]);
    const pending = service.confirmPonMilestone({
      ...key, ponStageId: PON_ID, milestone: 'civil_complete', action: 'confirm',
      expectedRowVersion: view.pons[0]!.rowVersion, effectiveAt: now(), source: 'qa-race',
    }, actor('construction-confirm')).then(() => null, error => error as { code: string });
    await waitForLock('construction_qa_reviews');
    await blocker.query('COMMIT');
    blocker.release();
    expect(await pending).toMatchObject({ code: 'EVIDENCE_REQUIRED' });
  });
  it('hands over exactly once under concurrent recalculation with a complete evidence snapshot', async () => {
    let view = await setupLivePon();
    const pinnedPack = view.documents.find(document => document.documentType === 'test_pack')!;
    view = await service.registerDocument({
      ...key, ponStageId: PON_ID, documentType: 'test_pack', documentSource: 'vf_storage',
      sourceRef: 'replacement.pdf', filename: 'replacement.pdf', mimeType: 'application/pdf',
      sizeBytes: 7, checksumSha256: 'a'.repeat(64), expectedRowVersion: view.rowVersion,
      effectiveAt: now(), source: 'handover-test', reason: 'Superseded after testing',
    }, actor('documents-manage'));
    view = await recordQa(view, 'civil', 'failed', [SNAG_ID]);
    view = await recordQa(view, 'civil', 'passed', [], 'Civil snag corrected');
    view = await recordQa(view, 'optical', 'passed');
    view = await registerZoneDocument(view, 'fac', '2'.repeat(64));
    view = await registerZoneDocument(view, 'cac', '3'.repeat(64));
    expect(view.handedOverAt).toBeNull();
    await pool.query(`UPDATE snags SET status = 'closed' WHERE id = $1`, [SNAG_ID]);
    await Promise.all([
      service.recalculateForSnag(SNAG_ID, actor('operations-confirm')),
      service.recalculateForSnag(SNAG_ID, actor('operations-confirm')),
    ]);
    const handedOver = await service.getZone(key);
    expect(handedOver.handedOverAt).not.toBeNull();
    const { rows } = await pool.query<{
      handover_snapshot: {
        scope: Array<Record<string, unknown>>;
        milestones: Array<Record<string, unknown>>;
        zoneQa: Record<string, unknown>;
        documents: Array<Record<string, unknown>>;
        snags: Array<Record<string, unknown>>;
      };
    }>(`
      SELECT handover_snapshot FROM zone_delivery_state
      WHERE project_id = $1 AND zone_no = 1
    `, [PROJECT_ID]);
    const snapshot = rows[0]!.handover_snapshot;
    expect(snapshot.scope).toEqual([{
      ponStageId: PON_ID, ponNo: 1, scopeStatus: 'included', scopeReason: null,
    }]);
    expect(snapshot.milestones).toEqual([expect.objectContaining({
      ponStageId: PON_ID,
      ponNo: 1,
      civil_complete: expect.objectContaining({ actorUserId: USER_ID }),
      testing_passed: expect.objectContaining({
        testPackDocument: expect.objectContaining({
          id: pinnedPack.id, sourceRef: 'pack.pdf', checksumSha256: '1'.repeat(64),
        }),
      }),
      technically_live: expect.objectContaining({ actorUserId: USER_ID }),
    })]);
    expect(snapshot.zoneQa).toEqual({
      civil: expect.objectContaining({ status: 'passed', approverUserId: USER_ID }),
      optical: expect.objectContaining({ status: 'passed', approverUserId: USER_ID }),
    });
    expect(snapshot.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ documentType: 'test_pack', checksumSha256: 'a'.repeat(64) }),
      expect.objectContaining({ documentType: 'fac', checksumSha256: '2'.repeat(64) }),
      expect.objectContaining({ documentType: 'cac', checksumSha256: '3'.repeat(64) }),
    ]));
    expect(snapshot.snags).toEqual([expect.objectContaining({
      snagId: SNAG_ID,
      status: 'closed',
      qaDiscipline: 'civil',
      handoverBlocking: true,
    })]);
    const activities = await service.getActivity(key);
    expect(activities.filter(({ action }) => action === 'zone_handed_over')).toHaveLength(1);
  });
  it('does not hand over while a linked canonical snag is concurrently reopened', async () => {
    let view = await setupLivePon();
    view = await recordQa(view, 'civil', 'failed', [SNAG_ID]);
    view = await recordQa(view, 'civil', 'passed', [], 'Civil snag corrected');
    view = await recordQa(view, 'optical', 'passed');
    view = await registerZoneDocument(view, 'fac', '8'.repeat(64));
    await registerZoneDocument(view, 'cac', '9'.repeat(64));
    await pool.query(`UPDATE snags SET status = 'closed' WHERE id = $1`, [SNAG_ID]);
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(`UPDATE snags SET status = 'open' WHERE id = $1`, [SNAG_ID]);
    const pending = service.recalculateForSnag(SNAG_ID, actor('operations-confirm'));
    await waitForLock('zone_delivery_snag_links');
    await blocker.query('COMMIT');
    blocker.release();
    await pending;
    expect((await service.getZone(key)).handedOverAt).toBeNull();
  });
  it('accepts only non-blocking maintenance linkage after handover without reversing dates', async () => {
    let view = await setupLivePon();
    view = await recordQa(view, 'civil', 'failed', [SNAG_ID]);
    view = await recordQa(view, 'civil', 'passed', [], 'Civil snag corrected');
    view = await recordQa(view, 'optical', 'passed');
    view = await registerZoneDocument(view, 'fac', '4'.repeat(64));
    view = await registerZoneDocument(view, 'cac', '5'.repeat(64));
    expect(view.handedOverAt).toBeNull();
    await pool.query(`UPDATE snags SET status = 'closed' WHERE id = $1`, [SNAG_ID]);
    await service.recalculateForSnag(SNAG_ID, actor('operations-confirm'));
    view = await service.getZone(key);
    const handedOverAt = view.handedOverAt;
    expect(handedOverAt).not.toBeNull();
    await pool.query(`UPDATE snags SET status = 'open' WHERE id = $1`, [SNAG_ID]);
    await expect(recordQa(view, 'civil', 'in_progress'))
      .rejects.toMatchObject({ code: 'HANDOVER_LOCKED' });
    const pon = view.pons[0]!;
    const linked = await service.confirmPonMilestone({
      ...key, ponStageId: PON_ID, milestone: 'technically_live',
      action: 'link_maintenance', snagId: SNAG_ID, affectedGate: 'technically_live',
      expectedRowVersion: pon.rowVersion, effectiveAt: now(), source: 'maintenance',
    }, actor('operations-confirm'));
    expect(linked.handedOverAt).toBe(handedOverAt);
    expect(linked.pons[0]!.milestones.technically_live?.effectiveAt)
      .toBe(pon.milestones.technically_live?.effectiveAt);
    const { rows } = await pool.query<{
      handover_blocking: boolean;
      requires_reconfirmation: boolean;
    }>(`
      SELECT handover_blocking, requires_reconfirmation
      FROM zone_delivery_snag_links WHERE snag_id = $1
    `, [SNAG_ID]);
    expect(rows[0]).toEqual({
      handover_blocking: false,
      requires_reconfirmation: false,
    });
  });
  it('returns calculated register rows, filters, summary, and ordered activity', async () => {
    let view = await setupLivePon();
    view = await recordQa(view, 'civil', 'passed');
    view = await recordQa(view, 'optical', 'passed');
    view = await registerZoneDocument(view, 'fac', '6'.repeat(64));
    await registerZoneDocument(view, 'cac', '7'.repeat(64));
    const result = await service.getRegister({
      projectId: PROJECT_ID,
      status: 'handed_over',
      handover: 'complete',
      search: 'Test Project A',
    });
    expect(result.rows).toEqual([expect.objectContaining({
      projectId: PROJECT_ID,
      zoneNo: 1,
      projectName: 'Test Project A',
      status: 'handed_over',
      includedPons: 1,
      livePons: 1,
      blockerCount: 0,
    })]);
    expect(result.summary).toEqual({
      zones: 1, includedPons: 1, livePons: 1, readyForQa: 0, handedOver: 1,
    });
    const activities = await service.getActivity(key);
    expect(activities.at(-1)?.action).toBe('zone_handed_over');
    expect(Date.parse(activities[0]!.recordedAt))
      .toBeLessThanOrEqual(Date.parse(activities.at(-1)!.recordedAt));
  });
});
