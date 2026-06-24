import { describe, it, expect } from 'vitest';
import { isSiteCamAuthorised } from '../sitecamAuth';

describe('isSiteCamAuthorised', () => {
  // SiteCam is intentionally open to every active authenticated portal user so
  // managers and other staff can run on-the-ground testing without a role
  // change. Restricting it again is a revert of the commit that opened it.
  it('authorises field staff (technician/supervisor)', () => {
    expect(isSiteCamAuthorised('technician', null)).toBe(true);
    expect(isSiteCamAuthorised('supervisor', null)).toBe(true);
  });

  it('authorises privileged auth roles (super_admin/system)', () => {
    expect(isSiteCamAuthorised(null, 'super_admin')).toBe(true);
    expect(isSiteCamAuthorised('viewer', 'system')).toBe(true);
  });

  it('authorises every other role (open access)', () => {
    expect(isSiteCamAuthorised('viewer', null)).toBe(true);
    expect(isSiteCamAuthorised('office', 'manager')).toBe(true);
    expect(isSiteCamAuthorised('admin', 'manager')).toBe(true);
  });

  it('authorises active sessions with no role information', () => {
    expect(isSiteCamAuthorised(null, null, 'active')).toBe(true);
    expect(isSiteCamAuthorised(undefined, undefined, 'active')).toBe(true);
  });

  it('does not authorise pending portal registrations', () => {
    expect(isSiteCamAuthorised('technician', null, 'pending')).toBe(false);
    expect(isSiteCamAuthorised('viewer', 'system', 'pending')).toBe(false);
  });
});
