import { describe, expect, it } from 'vitest';
import { calculateZoneDelivery } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryCalculator';
import type { ZoneDeliveryView } from '@/modules/construction-qa/zone-delivery/types/zoneDelivery.types';
import {
  activeZone,
  activity,
  handedOverActivity,
  handedOverZone,
  registerResult,
  zoneQaZone,
} from '../e2e/zone-delivery-fixtures';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/i;

function calculateFixture(zone: ZoneDeliveryView) {
  return calculateZoneDelivery({
    scopeApproved: zone.scopeApproved,
    pons: zone.pons,
    civilQa: zone.civilQa.status,
    opticalQa: zone.opticalQa.status,
    hasFac: zone.documents.some(document => document.active && document.documentType === 'fac'),
    hasCac: zone.documents.some(document => document.active && document.documentType === 'cac'),
    openBlockingSnags: zone.snags.filter(snag =>
      snag.requiresReconfirmation || (snag.handoverBlocking && snag.status !== 'closed')).length,
    handedOverAt: zone.handedOverAt,
  });
}

describe('Zone Delivery browser fixtures', () => {
  it('uses production-shaped identifiers, checksums and response fields', () => {
    for (const zone of [activeZone, zoneQaZone, handedOverZone]) {
      expect(zone.scopeApproved).toBeTypeOf('boolean');
      expect(zone.snags).toBeInstanceOf(Array);
      const ids = [zone.projectId, ...zone.pons.map(pon => pon.ponStageId),
        ...zone.documents.map(document => document.id),
        ...zone.snags.map(snag => snag.snagId)];
      expect(ids.every(id => uuid.test(id))).toBe(true);
      expect(zone.pons.every(pon =>
        pon.scopeReason === null || typeof pon.scopeReason === 'string')).toBe(true);
      expect(zone.pons.every(pon => Object.keys(pon.actions).length === 6)).toBe(true);
      expect(zone.documents.every(document =>
        document.sourceRef.length > 0 && sha256.test(document.checksumSha256))).toBe(true);
    }
    expect([...activity, ...handedOverActivity].every(item => uuid.test(item.id))).toBe(true);
  });

  it('matches the real lifecycle calculator and register summary', () => {
    for (const zone of [activeZone, zoneQaZone, handedOverZone]) {
      const calculated = calculateFixture(zone);
      expect(zone.status).toBe(calculated.status);
      expect(zone.blockers).toEqual(calculated.blockers);
    }
    expect(registerResult.summary).toMatchObject({
      zones: registerResult.rows.length,
      includedPons: registerResult.rows.reduce(
        (sum, row) => sum + (row.includedPons ?? 0),
        0,
      ),
      livePons: registerResult.rows.reduce((sum, row) => sum + (row.livePons ?? 0), 0),
      handedOver: registerResult.rows.filter(row => row.handedOverAt).length,
    });
  });

  it('uses only real production activity action names', () => {
    expect(activity.map(item => item.action)).toEqual(['port_approved_reopened']);
    expect(handedOverActivity.map(item => item.action)).toEqual(['maintenance_linked']);
  });
});
