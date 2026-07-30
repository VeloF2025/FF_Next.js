import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import type {
  DeliveryActor,
  PonMilestone,
  ZoneDeliveryView,
} from '@/modules/construction-qa/zone-delivery/types/zoneDelivery.types';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const PON_ID = '47000000-0000-4000-8000-000000000001';
const SECOND_PON_ID = '47000000-0000-4000-8000-000000000011';
const THIRD_PON_ID = '47000000-0000-4000-8000-000000000012';
const SNAG_ID = '47000000-0000-4000-8000-000000000002';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const key = { projectId: PROJECT_ID, zoneNo: 1 };
const now = () => new Date().toISOString();
const actor = (permission: string): DeliveryActor => ({
  userId: USER_ID,
  email: 'tester@test.local',
  permission: `construction-qa.zone-delivery.${permission}`,
});
describe('PON delivery milestone lifecycle', () => {
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
  async function approveReviews(
    ponNo: number,
    discipline: 'civil' | 'optical',
    statuses = ['approved'],
  ): Promise<void> {
    for (const [index, status] of statuses.entries()) {
      await pool.query(`
        INSERT INTO construction_qa_reviews (
          project_id, discipline, feature_type, feature_id,
          zone_no, pon_no, workflow_status
        ) VALUES ($1, $2, 'pole', $3, 1, $4, $5)
      `, [PROJECT_ID, discipline, `${discipline}-${ponNo}-${index}`, ponNo, status]);
    }
  }
  async function approveScope(): Promise<ZoneDeliveryView> {
    return service.updateScope({
      ...key,
      expectedRowVersion: 0,
      effectiveAt: now(),
      source: 'scope-register',
      pons: [{ ponStageId: PON_ID, scopeStatus: 'included' }],
    }, actor('scope-manage'));
  }
  async function confirm(
    view: ZoneDeliveryView,
    milestone: PonMilestone,
    permission: string,
    reason?: string,
  ): Promise<ZoneDeliveryView> {
    const pon = view.pons.find(({ ponStageId }) => ponStageId === PON_ID)!;
    return service.confirmPonMilestone({
      ...key,
      ponStageId: PON_ID,
      milestone,
      action: 'confirm',
      expectedRowVersion: pon.rowVersion,
      effectiveAt: now(),
      source: 'lifecycle-test',
      reason,
    }, actor(permission));
  }
  it('approves included scope and requires audited reasons for exclusions and changes', async () => {
    const approved = await service.updateScope({
      ...key,
      expectedRowVersion: 0,
      effectiveAt: now(),
      source: 'scope-register',
      pons: [
        { ponStageId: PON_ID, scopeStatus: 'included' },
        { ponStageId: SECOND_PON_ID, scopeStatus: 'excluded', reason: 'Not built' },
        { ponStageId: THIRD_PON_ID, scopeStatus: 'cancelled', reason: 'Removed' },
      ],
    }, actor('scope-manage'));
    expect(approved.pons.map(({ ponNo, scopeStatus }) => [ponNo, scopeStatus])).toEqual([
      [1, 'included'], [2, 'excluded'], [3, 'cancelled'],
    ]);
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
  it('rejects wrong permissions, incomplete QA scope, sequence skips, and missing test packs', async () => {
    let view = await approveScope();
    await approveReviews(1, 'civil', ['approved', 'rejected']);
    await expect(confirm(view, 'civil_complete', 'testing-confirm'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(confirm(view, 'civil_complete', 'construction-confirm'))
      .rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    await pool.query(`
      UPDATE construction_qa_reviews SET workflow_status = 'approved'
      WHERE project_id = $1
    `, [PROJECT_ID]);
    await approveReviews(1, 'optical');
    await expect(confirm(view, 'optical_complete', 'construction-confirm'))
      .rejects.toMatchObject({ code: 'PREREQUISITE_BLOCKED' });
    view = await confirm(view, 'civil_complete', 'construction-confirm');
    view = await confirm(view, 'optical_complete', 'construction-confirm');
    await expect(confirm(view, 'port_submitted', 'operations-confirm'))
      .rejects.toMatchObject({ code: 'PREREQUISITE_BLOCKED' });
    await expect(confirm(view, 'testing_passed', 'testing-confirm'))
      .rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    expect((await service.getZone(key)).handedOverAt).toBeNull();
  });
  it('uses exact row versions and audits backdating and corrections with old and new evidence', async () => {
    let view = await approveScope();
    await expect(approveScope()).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await approveReviews(1, 'civil');
    await expect(service.confirmPonMilestone({
      ...key, ponStageId: PON_ID, milestone: 'civil_complete', action: 'confirm',
      expectedRowVersion: 0, effectiveAt: now(), source: 'stale-client',
    }, actor('construction-confirm'))).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const backdated = new Date(Date.now() - 10 * 60_000).toISOString();
    const ponVersion = view.pons[0]!.rowVersion;
    await expect(service.confirmPonMilestone({
      ...key,
      ponStageId: PON_ID,
      milestone: 'civil_complete',
      action: 'confirm',
      expectedRowVersion: ponVersion,
      effectiveAt: backdated,
      source: 'historic-pack',
    }, actor('construction-confirm'))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    view = await service.confirmPonMilestone({
      ...key,
      ponStageId: PON_ID,
      milestone: 'civil_complete',
      action: 'confirm',
      expectedRowVersion: ponVersion,
      effectiveAt: backdated,
      source: 'historic-pack',
      reason: 'Verified historical completion',
    }, actor('construction-confirm'));
    await expect(confirm(view, 'civil_complete', 'construction-confirm'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const corrected = await confirm(
      view,
      'civil_complete',
      'construction-confirm',
      'Corrected effective date',
    );
    expect(corrected.pons[0]!.milestones.civil_complete?.effectiveAt).not.toBe(backdated);
    const activity = await service.getActivity(key);
    expect(activity.at(-1)).toMatchObject({
      action: 'civil_complete_confirmed',
      reason: 'Corrected effective date',
      previousValue: { effectiveAt: backdated, actorUserId: USER_ID },
    });
    expect(activity.at(-1)?.newValue).toMatchObject({ actorUserId: USER_ID });
  });
  it('pins testing to the active same-PON test pack and supersedes documents immutably', async () => {
    let view = await approveScope();
    await Promise.all([approveReviews(1, 'civil'), approveReviews(1, 'optical')]);
    view = await service.registerDocument({
      ...key,
      ponStageId: PON_ID,
      documentType: 'test_pack',
      documentSource: 'vf_storage',
      sourceRef: 'packs/one.pdf',
      filename: 'one.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      checksumSha256: 'a'.repeat(64),
      expectedRowVersion: view.rowVersion,
      effectiveAt: now(),
      source: 'document-test',
    }, actor('documents-manage'));
    const firstId = view.documents[0]!.id;
    view = await confirm(view, 'civil_complete', 'construction-confirm');
    view = await confirm(view, 'optical_complete', 'construction-confirm');
    view = await confirm(view, 'testing_passed', 'testing-confirm');
    await expect(service.registerDocument({
      ...key,
      ponStageId: PON_ID,
      documentType: 'test_pack',
      documentSource: 'vf_storage',
      sourceRef: 'packs/two.pdf',
      filename: 'two.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 11,
      checksumSha256: 'b'.repeat(64),
      expectedRowVersion: view.rowVersion,
      effectiveAt: now(),
      source: 'document-test',
    }, actor('documents-manage'))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    view = await service.registerDocument({
      ...key,
      ponStageId: PON_ID,
      documentType: 'test_pack',
      documentSource: 'vf_storage',
      sourceRef: 'packs/two.pdf',
      filename: 'two.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 11,
      checksumSha256: 'b'.repeat(64),
      expectedRowVersion: view.rowVersion,
      effectiveAt: now(),
      source: 'document-test',
      reason: 'Corrected test pack',
    }, actor('documents-manage'));
    expect(view.documents.map(({ id, active }) => [id, active])).toEqual([
      [firstId, false], [expect.any(String), true],
    ]);
    const { rows } = await pool.query<{ testing_test_pack_document_id: string }>(`
      SELECT testing_test_pack_document_id FROM pon_delivery_state
      WHERE pon_stage_id = $1
    `, [PON_ID]);
    expect(rows[0]!.testing_test_pack_document_id).toBe(firstId);
  });
  it('reopens an affected gate, clears downstream evidence, and requires closure plus reconfirmation', async () => {
    let view = await approveScope();
    await Promise.all([approveReviews(1, 'civil'), approveReviews(1, 'optical')]);
    view = await service.registerDocument({
      ...key, ponStageId: PON_ID, documentType: 'test_pack',
      documentSource: 'vf_storage', sourceRef: 'pack.pdf', filename: 'pack.pdf',
      mimeType: 'application/pdf', sizeBytes: 1, checksumSha256: 'c'.repeat(64),
      expectedRowVersion: view.rowVersion, effectiveAt: now(), source: 'reopen-test',
    }, actor('documents-manage'));
    for (const [milestone, permission] of [
      ['civil_complete', 'construction-confirm'],
      ['optical_complete', 'construction-confirm'],
      ['testing_passed', 'testing-confirm'],
      ['port_submitted', 'operations-confirm'],
      ['port_approved', 'operations-confirm'],
      ['technically_live', 'operations-confirm'],
    ] as const) view = await confirm(view, milestone, permission);
    const eligibleAt = view.eligibleForZoneQaAt;
    const ponVersion = view.pons[0]!.rowVersion;
    view = await service.confirmPonMilestone({
      ...key, ponStageId: PON_ID, milestone: 'testing_passed',
      action: 'reopen', snagId: SNAG_ID, affectedGate: 'testing_passed',
      expectedRowVersion: ponVersion, effectiveAt: now(), source: 'defect',
      reason: 'Failed retest',
    }, actor('testing-confirm'));
    expect(Object.keys(view.pons[0]!.milestones)).toEqual(['civil_complete', 'optical_complete']);
    expect(view.eligibleForZoneQaAt).toBe(eligibleAt);
    await pool.query(`UPDATE snags SET status = 'closed' WHERE id = $1`, [SNAG_ID]);
    await service.recalculateForSnag(SNAG_ID, actor('operations-confirm'));
    expect((await service.getZone(key)).pons[0]!.milestones.testing_passed).toBeUndefined();
    view = await confirm(view, 'testing_passed', 'testing-confirm');
    expect(view.pons[0]!.milestones.testing_passed).toBeDefined();
    const { rows } = await pool.query<{ requires_reconfirmation: boolean }>(`
      SELECT requires_reconfirmation FROM zone_delivery_snag_links WHERE snag_id = $1
    `, [SNAG_ID]);
    expect(rows[0]!.requires_reconfirmation).toBe(false);
  });
});
