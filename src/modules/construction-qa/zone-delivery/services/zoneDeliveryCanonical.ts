import type { PoolClient } from 'pg';
import type { ZoneKey } from '../types/zoneDelivery.types';
import { deliveryError } from './zoneDeliveryErrors';

export async function assertCanonicalZone(
  client: PoolClient,
  key: ZoneKey,
): Promise<void> {
  const { rowCount } = await client.query(`
    SELECT 1
    FROM pon_stage_tracking
    WHERE project_id = $1 AND zone_no = $2
    LIMIT 1
  `, [key.projectId, key.zoneNo]);
  if (!rowCount) {
    deliveryError('ZONE_NOT_FOUND', 'Zone has no canonical PON tracking rows');
  }
}
