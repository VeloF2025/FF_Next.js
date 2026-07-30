import { describe, expect, it } from 'vitest';
import { safeDocumentUrl } from '../zoneDeliveryDocumentSecurity';

describe('safeDocumentUrl', () => {
  it.each([
    ['/storage/zone-delivery/fac.pdf', '/storage/zone-delivery/fac.pdf'],
    ['https://evidence.example/fac.pdf', 'https://evidence.example/fac.pdf'],
    ['http://evidence.example/fac.pdf', 'http://evidence.example/fac.pdf'],
  ])('allows %s', (sourceRef, expected) => {
    expect(safeDocumentUrl(sourceRef)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'exfo://results/job-42',
    '//evil.example/evidence',
    '/storage/../admin',
    'not a URL',
  ])('rejects unsafe source ref %s', sourceRef => {
    expect(safeDocumentUrl(sourceRef)).toBeNull();
  });
});
