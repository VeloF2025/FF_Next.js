import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import type { DeliveryActor } from '@/modules/construction-qa/zone-delivery/types/zoneDelivery.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111113';
const PON_ID = '47000000-0000-4000-8000-000000000031';
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
    await pool.query(`
      INSERT INTO projects (id, project_name)
      VALUES ($1, 'Register Query Project')
      ON CONFLICT (id) DO NOTHING
    `, [PROJECT_ID]);
    await pool.query(`
      INSERT INTO pon_stage_tracking (id, project_id, zone_no, pon_no)
      VALUES ($1, $2, 1, 1)
      ON CONFLICT (id) DO NOTHING
    `, [PON_ID, PROJECT_ID]);
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

  it('uses a fixed query count and does not report scope counts before approval', async () => {
    await pool.query(`
      INSERT INTO pon_stage_tracking (id, project_id, zone_no, pon_no)
      VALUES
        ('47000000-0000-4000-8000-000000000032', $1, 2, 1),
        ('47000000-0000-4000-8000-000000000033', $1, 3, 1),
        ('47000000-0000-4000-8000-000000000034', $1, 4, 1)
      ON CONFLICT (id) DO NOTHING
    `, [PROJECT_ID]);
    await service.updateScope({
      ...key,
      pons: [{ ponStageId: PON_ID, scopeStatus: 'included' }],
      expectedRowVersion: 0,
      effectiveAt: now(),
      source: 'register-query-test',
    }, actor('scope-manage'));

    let queryCount = 0;
    const countingPool = {
      connect: async () => {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === 'query') {
              return (...args: Parameters<PoolClient['query']>) => {
                queryCount += 1;
                return target.query(...args);
              };
            }
            const value = target[property as keyof PoolClient];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    } as Pool;
    const countedService = createZoneDeliveryService(countingPool);

    const one = await countedService.getRegister({ projectId: PROJECT_ID, zoneNo: 1 });
    const oneCount = queryCount;
    queryCount = 0;
    const many = await countedService.getRegister({ projectId: PROJECT_ID });
    const manyCount = queryCount;

    expect(one.rows).toHaveLength(1);
    expect(many.rows).toHaveLength(4);
    expect(oneCount).toBe(4);
    expect(manyCount).toBe(oneCount);
    expect(many.rows.find(row => row.zoneNo === 2)).toMatchObject({
      scopeApproved: false,
      includedPons: null,
      livePons: null,
    });
    expect(many.summary.includedPons).toBe(1);
    expect(many.summary.livePons).toBe(0);
  });
});
