import { describe, it, expect } from 'vitest';
import { QFIELD_KEY_DENYLIST } from '../qfieldKeyGuard';

describe('qfield photo-proxy key guard', () => {
  it('accepts iOS duplicate-suffix filenames with parentheses and spaces', () => {
    const key =
      'projects/b32184d6-1776-4b89-8afd-2907dfca86d4/files/DCIM/civil-audit-poles-phase-1_20260811195641643.03.54 (1).jpeg/v20260811183135-0f65d502';
    expect(QFIELD_KEY_DENYLIST.test(key)).toBe(false);
  });

  it('still rejects shell metacharacters', () => {
    for (const bad of ['a;b', 'a`b', 'a$b', 'a|b', 'a&b', 'a\\b', 'a{b', 'a[b', 'a!b', 'a#b']) {
      expect(QFIELD_KEY_DENYLIST.test(bad)).toBe(true);
    }
  });
});
