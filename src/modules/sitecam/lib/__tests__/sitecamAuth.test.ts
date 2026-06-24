import { describe, it, expect } from 'vitest';
import { isSiteCamAuthorised } from '../sitecamAuth';

describe('isSiteCamAuthorised', () => {
  // SiteCam is intentionally open to every authenticated portal user — including
  // pending self-registered field technicians, who capture installation photos
  // from their first sign-in. Restricting it again is a revert of the commits
  // that opened it (#2042 + the pending-access follow-up).
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

  it('authorises pending portal registrations (field techs capture on first sign-in)', () => {
    expect(isSiteCamAuthorised('technician', null, 'pending')).toBe(true);
    expect(isSiteCamAuthorised('viewer', 'system', 'pending')).toBe(true);
  });
});
