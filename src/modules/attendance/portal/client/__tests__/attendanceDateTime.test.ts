import { afterEach, describe, expect, it } from 'vitest';

import { localSastDateTimeToIso } from '../attendanceDateTime';

const originalTimezone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimezone;
});

describe('localSastDateTimeToIso', () => {
  it('interprets datetime-local values as SAST independent of device timezone', () => {
    process.env.TZ = 'America/New_York';

    expect(localSastDateTimeToIso('2026-08-03T17:00')).toBe(
      '2026-08-03T15:00:00.000Z'
    );
  });
});
