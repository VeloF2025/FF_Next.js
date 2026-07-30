import type { Pool } from 'pg';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import type {
  DeliveryActor,
  ZoneDeliveryView,
} from '@/modules/construction-qa/zone-delivery/types/zoneDelivery.types';

export const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
export const PON_ID = '47000000-0000-4000-8000-000000000001';
export const SNAG_ID = '47000000-0000-4000-8000-000000000002';
export const USER_ID = '22222222-2222-2222-2222-222222222222';
export const key = { projectId: PROJECT_ID, zoneNo: 1 };
export const now = () => new Date().toISOString();
export const actor = (permission: string): DeliveryActor => ({
  userId: USER_ID,
  email: 'tester@test.local',
  permission: `construction-qa.zone-delivery.${permission}`,
});

export function createZoneHandoverHarness(pool: Pool) {
  const service = createZoneDeliveryService(pool);

  async function reset(): Promise<void> {
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
  }

  async function waitForLock(fragment: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rowCount } = await pool.query(`
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query LIKE $1 LIMIT 1
      `, [`%${fragment}%`]);
      if (rowCount) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${fragment} lock`);
  }

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
      view = await service.confirmPonMilestone({
        ...key, ponStageId: PON_ID, milestone, action: 'confirm',
        expectedRowVersion: view.pons[0]!.rowVersion, effectiveAt: now(),
        source: 'handover-test',
      }, actor(permission));
    }
    return view;
  }

  function registerZoneDocument(
    view: ZoneDeliveryView,
    documentType: 'fac' | 'cac',
    checksum: string,
  ): Promise<ZoneDeliveryView> {
    return service.registerDocument({
      ...key, documentType, documentSource: 'vf_storage',
      sourceRef: `${documentType}.pdf`, filename: `${documentType}.pdf`,
      mimeType: 'application/pdf', sizeBytes: 6, checksumSha256: checksum,
      expectedRowVersion: view.rowVersion, effectiveAt: now(), source: 'handover-test',
    }, actor('documents-manage'));
  }

  function recordQa(
    view: ZoneDeliveryView,
    discipline: 'civil' | 'optical',
    status: 'in_progress' | 'passed' | 'failed',
    snagIds: string[] = [],
    reason?: string,
  ): Promise<ZoneDeliveryView> {
    return service.recordZoneQa({
      ...key, discipline, status, notes: `${discipline} ${status}`, snagIds,
      expectedRowVersion: view.rowVersion, effectiveAt: now(), source: 'handover-test',
      ...(reason ? { reason } : {}),
    }, actor('zone-qa-approve'));
  }

  return { recordQa, registerZoneDocument, reset, service, setupLivePon, waitForLock };
}
