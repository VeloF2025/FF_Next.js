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
const SECOND_PON_ID = '47000000-0000-4000-8000-000000000041';
const SNAG_ID = '47000000-0000-4000-8000-000000000002';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const key = { projectId: PROJECT_ID, zoneNo: 1 };
const now = () => new Date().toISOString();
const actor = (permission: string): DeliveryActor => ({
  userId: USER_ID,
  email: 'tester@test.local',
  permission: `construction-qa.zone-delivery.${permission}`,
});
const milestones: Array<[PonMilestone, string]> = [
  ['civil_complete', 'construction-confirm'],
  ['optical_complete', 'construction-confirm'],
  ['testing_passed', 'testing-confirm'],
  ['port_submitted', 'operations-confirm'],
  ['port_approved', 'operations-confirm'],
  ['technically_live', 'operations-confirm'],
];

describe('Zone QA invalidation lifecycle', () => {
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
    await addApprovedQa(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function addApprovedQa(ponNo: number): Promise<void> {
    for (const discipline of ['civil', 'optical']) {
      await pool.query(`
        INSERT INTO construction_qa_reviews (
          project_id, discipline, feature_type, feature_id,
          zone_no, pon_no, workflow_status
        ) VALUES ($1, $2, 'pole', $2 || '-' || $3::text, 1, $3::integer, 'approved')
      `, [PROJECT_ID, discipline, ponNo]);
    }
  }

  async function registerPack(
    view: ZoneDeliveryView,
    ponStageId: string,
    suffix: string,
  ): Promise<ZoneDeliveryView> {
    return service.registerDocument({
      ...key,
      ponStageId,
      documentType: 'test_pack',
      documentSource: 'vf_storage',
      sourceRef: `pack-${suffix}.pdf`,
      filename: `pack-${suffix}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 5,
      checksumSha256: suffix.repeat(64),
      expectedRowVersion: view.rowVersion,
      effectiveAt: now(),
      source: 'invalidation-test',
    }, actor('documents-manage'));
  }

  async function confirmAll(
    view: ZoneDeliveryView,
    ponStageId: string,
  ): Promise<ZoneDeliveryView> {
    let current = view;
    for (const [milestone, permission] of milestones) {
      const pon = current.pons.find(item => item.ponStageId === ponStageId)!;
      current = await service.confirmPonMilestone({
        ...key,
        ponStageId,
        milestone,
        action: 'confirm',
        expectedRowVersion: pon.rowVersion,
        effectiveAt: now(),
        source: 'invalidation-test',
      }, actor(permission));
    }
    return current;
  }

  async function liveApprovedZone(): Promise<ZoneDeliveryView> {
    let view = await service.updateScope({
      ...key,
      pons: [{ ponStageId: PON_ID, scopeStatus: 'included' }],
      expectedRowVersion: 0,
      effectiveAt: now(),
      source: 'invalidation-test',
    }, actor('scope-manage'));
    view = await registerPack(view, PON_ID, 'a');
    view = await confirmAll(view, PON_ID);
    for (const discipline of ['civil', 'optical'] as const) {
      view = await service.recordZoneQa({
        ...key,
        discipline,
        status: 'passed',
        notes: `${discipline} approved`,
        snagIds: [],
        expectedRowVersion: view.rowVersion,
        effectiveAt: now(),
        source: 'invalidation-test',
      }, actor('zone-qa-approve'));
    }
    return view;
  }

  async function registerCertificate(
    view: ZoneDeliveryView,
    documentType: 'fac' | 'cac',
    checksum: string,
  ): Promise<ZoneDeliveryView> {
    return service.registerDocument({
      ...key,
      documentType,
      documentSource: 'vf_storage',
      sourceRef: `${documentType}.pdf`,
      filename: `${documentType}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 5,
      checksumSha256: checksum.repeat(64),
      expectedRowVersion: view.rowVersion,
      effectiveAt: now(),
      source: 'invalidation-test',
    }, actor('documents-manage'));
  }

  it('invalidates both QA decisions when approved scope gains a canonical PON', async () => {
    let view = await liveApprovedZone();
    const priorEligibility = view.eligibleForZoneQaAt;
    const priorVersion = view.rowVersion;
    await pool.query(`
      INSERT INTO pon_stage_tracking (id, project_id, zone_no, pon_no)
      VALUES ($1, $2, 1, 2)
    `, [SECOND_PON_ID, PROJECT_ID]);
    await addApprovedQa(2);

    view = await service.updateScope({
      ...key,
      pons: [
        { ponStageId: PON_ID, scopeStatus: 'included' },
        { ponStageId: SECOND_PON_ID, scopeStatus: 'included' },
      ],
      expectedRowVersion: view.rowVersion,
      effectiveAt: now(),
      source: 'scope-expansion',
      reason: 'Add commissioned PON 2',
    }, actor('scope-manage'));
    expect(priorEligibility).not.toBeNull();
    expect(view.rowVersion).toBeGreaterThan(priorVersion);
    expect(view).toMatchObject({
      civilQa: {
        status: 'not_started',
        notes: '',
        effectiveAt: null,
        approverEmail: null,
      },
      opticalQa: {
        status: 'not_started',
        notes: '',
        effectiveAt: null,
        approverEmail: null,
      },
      eligibleForZoneQaAt: null,
    });
    const actions = (await service.getActivity(key)).map(item => item.action);
    expect(actions).toEqual(expect.arrayContaining([
      'civil_zone_qa_invalidated',
      'optical_zone_qa_invalidated',
      'zone_qa_eligibility_invalidated',
      'zone_scope_updated',
    ]));

    view = await registerCertificate(view, 'fac', 'b');
    view = await registerCertificate(view, 'cac', 'c');
    expect(view.handedOverAt).toBeNull();
    view = await registerPack(view, SECOND_PON_ID, 'd');
    view = await confirmAll(view, SECOND_PON_ID);
    expect(view.eligibleForZoneQaAt).not.toBeNull();
    expect(view.eligibleForZoneQaAt).not.toBe(priorEligibility);
    expect(view.handedOverAt).toBeNull();
    view = await service.recordZoneQa({
      ...key, discipline: 'civil', status: 'passed', notes: 'Fresh civil QA', snagIds: [],
      expectedRowVersion: view.rowVersion, effectiveAt: now(), source: 'fresh-zone-qa',
    }, actor('zone-qa-approve'));
    expect(view.handedOverAt).toBeNull();
    view = await service.recordZoneQa({
      ...key, discipline: 'optical', status: 'passed', notes: 'Fresh optical QA', snagIds: [],
      expectedRowVersion: view.rowVersion, effectiveAt: now(), source: 'fresh-zone-qa',
    }, actor('zone-qa-approve'));
    expect(view.handedOverAt).not.toBeNull();
  });

  it('invalidates both QA decisions and eligibility when a milestone reopens', async () => {
    const approved = await liveApprovedZone();
    const pon = approved.pons[0]!;
    const reopened = await service.confirmPonMilestone({
      ...key,
      ponStageId: PON_ID,
      milestone: 'testing_passed',
      action: 'reopen',
      snagId: SNAG_ID,
      affectedGate: 'testing_passed',
      expectedRowVersion: pon.rowVersion,
      effectiveAt: now(),
      source: 'failed-retest',
      reason: 'Failed supervised retest',
    }, actor('testing-confirm'));
    expect(reopened.rowVersion).toBeGreaterThan(approved.rowVersion);
    expect(reopened).toMatchObject({
      civilQa: {
        status: 'not_started',
        effectiveAt: null,
        approverEmail: null,
      },
      opticalQa: {
        status: 'not_started',
        effectiveAt: null,
        approverEmail: null,
      },
      eligibleForZoneQaAt: null,
    });
    expect((await service.getActivity(key)).map(item => item.action)).toEqual(
      expect.arrayContaining([
        'civil_zone_qa_invalidated',
        'optical_zone_qa_invalidated',
        'zone_qa_eligibility_invalidated',
      ]),
    );
  });
});
