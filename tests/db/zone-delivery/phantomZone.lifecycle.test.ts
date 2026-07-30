import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

describe('canonical zone ownership', () => {
  let pool: Pool;
  let service: ReturnType<typeof createZoneDeliveryService>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
    service = createZoneDeliveryService(pool);
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE zone_delivery_activity, zone_delivery_snag_links,
        pon_delivery_state, zone_delivery_documents, zone_delivery_state
        RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects a zone projection without a canonical PON at the database boundary', async () => {
    await expect(pool.query(`
      INSERT INTO zone_delivery_state (project_id, zone_no)
      VALUES ($1, 999)
    `, [PROJECT_ID])).rejects.toThrow(/canonical PON/i);
  });

  it('returns stable ZONE_NOT_FOUND for a non-canonical zone read', async () => {
    await expect(service.getZone({
      projectId: PROJECT_ID,
      zoneNo: 999,
    })).rejects.toMatchObject({
      code: 'ZONE_NOT_FOUND',
      status: 404,
    });
  });
});
