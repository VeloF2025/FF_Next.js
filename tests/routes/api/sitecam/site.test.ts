import { describe, test, expect } from 'vitest';
import { dropNumberCandidates, toDrSiteId, toSiteGeo } from '@/pages/api/sitecam/site/[id]';

describe('site API helpers', () => {
  test('dropNumberCandidates returns both forms', () => {
    expect(dropNumberCandidates('DR1234')).toEqual(['DR1234', '1234']);
    expect(dropNumberCandidates('1234')).toEqual(['DR1234', '1234']);
    expect(dropNumberCandidates('DR-1234')).toEqual(['DR1234', '1234']);
  });

  test('toDrSiteId prefixes bare digits', () => {
    expect(toDrSiteId('50')).toBe('DR50');
    expect(toDrSiteId('DR50')).toBe('DR50');
  });

  test('toSiteGeo coerces strings to numbers', () => {
    expect(toSiteGeo({ latitude: '1.23', longitude: '4.56', pon_no: '7', zone_no: '8' }))
      .toEqual({ plannedLat: 1.23, plannedLon: 4.56, pon: 7, zone: 8 });
  });
});
