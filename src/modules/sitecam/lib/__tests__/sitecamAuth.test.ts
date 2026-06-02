import { describe, it, expect } from 'vitest';
import { isSiteCamAuthorised } from '../sitecamAuth';

describe('isSiteCamAuthorised', () => {
  it('allows technicians and supervisors by staff role', () => {
    expect(isSiteCamAuthorised('technician', null)).toBe(true);
    expect(isSiteCamAuthorised('supervisor', null)).toBe(true);
  });

  it('allows super_admin / system regardless of staff role', () => {
    expect(isSiteCamAuthorised(null, 'super_admin')).toBe(true);
    expect(isSiteCamAuthorised('viewer', 'system')).toBe(true);
  });

  it('denies other roles', () => {
    expect(isSiteCamAuthorised('viewer', null)).toBe(false);
    expect(isSiteCamAuthorised('office', 'manager')).toBe(false);
  });

  it('treats null/undefined role as unauthorised', () => {
    expect(isSiteCamAuthorised(null, null)).toBe(false);
    expect(isSiteCamAuthorised(undefined, undefined)).toBe(false);
  });
});
