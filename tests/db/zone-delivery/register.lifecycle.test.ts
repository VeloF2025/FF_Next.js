import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import type { DeliveryActor } from '@/modules/construction-qa/zone-delivery/types/zoneDelivery.types';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const key = { projectId: PROJECT_ID, zoneNo: 1 };
const now = () => new Date().toISOString();
const actor = (permission: string): DeliveryActor => ({
  userId: USER_ID,
  email: 'tester@test.local',
  permission: `construction-qa.zone-delivery.${permission}`,
});

describe('zone delivery register lifecycle', () => {
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
  });

  afterAll(async () => {
    await pool.end();
  });

  it('allows only one concurrent expected-version-zero zone projection create', async () => {
    const document = {
      ...key, documentType: 'fac' as const, documentSource: 'vf_storage' as const,
      filename: 'fac.pdf', mimeType: 'application/pdf', sizeBytes: 1,
      expectedRowVersion: 0, effectiveAt: now(), source: 'concurrent-create',
    };
    const results = await Promise.allSettled([
      service.registerDocument({
        ...document, sourceRef: 'fac-a.pdf', checksumSha256: 'a'.repeat(64),
      }, actor('documents-manage')),
      service.registerDocument({
        ...document, sourceRef: 'fac-b.pdf', checksumSha256: 'b'.repeat(64),
      }, actor('documents-manage')),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected'))
      .toMatchObject({ reason: { code: 'VERSION_CONFLICT' } });
  });
});
