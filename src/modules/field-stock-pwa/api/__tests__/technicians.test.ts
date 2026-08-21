/**
 * fetchTechnicians — the request the picker actually sends.
 *
 * The component test mocks this function, so nothing there can catch a
 * regression in the URL it builds. Requesting `role=technician` alone is
 * precisely the bug that made all ten casuals un-issuable, so the query string
 * needs a test of its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = vi.fn();
vi.mock('@/modules/field-stock-pwa/api/request', () => ({
  request: (...a: unknown[]) => request(...a),
}));

import { fetchTechnicians } from '../technicians';

const url = () => String(request.mock.calls[0][0]);

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue([]);
});

describe('fetchTechnicians', () => {
  it('asks for casuals as well as technicians', async () => {
    await fetchTechnicians();
    const q = new URLSearchParams(url().split('?')[1]);
    expect(q.get('roles')).toBe('technician,casual');
  });

  it('never sends the single-role param that excluded casuals', async () => {
    await fetchTechnicians();
    // The exact regression: `?role=technician`.
    expect(new URLSearchParams(url().split('?')[1]).get('role')).toBeNull();
  });

  it('passes the store so the server can resolve its site', async () => {
    await fetchTechnicians({ storeLocationId: 'loc-1' });
    expect(new URLSearchParams(url().split('?')[1]).get('storeLocationId')).toBe('loc-1');
  });

  it('omits the store when there is none, rather than sending an empty value', async () => {
    await fetchTechnicians({ storeLocationId: null });
    expect(new URLSearchParams(url().split('?')[1]).has('storeLocationId')).toBe(false);
  });

  it('carries the server site annotation onto the summary', async () => {
    request.mockResolvedValue([{
      id: 's1', first_name: 'Semenya', last_name: 'Mokoena', phone: null, email: null,
      role: 'casual', account_status: 'active', created_by_staff_id: null, created_at: '',
      site_project_id: 'p1', site_project_name: 'Thembisa POP 1',
      site_source: 'declared', site_match: 'match',
    }]);
    const [t] = await fetchTechnicians({ storeLocationId: 'loc-1' });
    expect(t.siteProjectName).toBe('Thembisa POP 1');
    expect(t.siteMatch).toBe('match');
    expect(t.siteSource).toBe('declared');
    expect(t.role).toBe('casual');
  });

  it('defaults a row with no site annotation to unmapped, never to elsewhere', async () => {
    // An older server, or a response missing the fields, must not cause the
    // picker to hide people.
    request.mockResolvedValue([{
      id: 's1', first_name: 'A', last_name: 'B', phone: null, email: null,
      role: 'technician', account_status: 'active', created_by_staff_id: null, created_at: '',
    }]);
    const [t] = await fetchTechnicians();
    expect(t.siteMatch).toBe('unmapped-store');
    expect(t.siteSource).toBe('none');
  });
});
