import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isReserved } = require('../../../../public/sw-app-guard.js');

describe('sw-app isReserved (scope arbitration)', () => {
  it.each(['/my', '/my/attendance', '/stock/portal', '/field-stock/x', '/fleet/check-in', '/sw-my.js', '/manifest-my.json'])(
    'reserves %s for the owning SW', (p) => expect(isReserved(p)).toBe(true)
  );
  it.each(['/', '/projects', '/works-qa/poles', '/snag/resolve/abc', '/manifest.json', '/api/foo'])(
    'does NOT reserve %s', (p) => expect(isReserved(p)).toBe(false)
  );
});
