import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SiteCamFailedQueue } from '../SiteCamFailedQueue';

const ESCALATION = {
  id: 'esc-1',
  job_type: 'activations',
  site_id: '9999990',
  step_number: 6,
  tech_name: 'Test Tech',
  fail_reasons: ['No green cable visible'],
  attempt_photos: [
    { attempt: 1, url: 'https://app.fibreflow.app/storage/a1.jpg', reasons: ['blurry'] },
    { attempt: 2, url: 'https://app.fibreflow.app/storage/a2.jpg', reasons: ['no ONT'] },
    { attempt: 3, url: 'https://app.fibreflow.app/storage/a3.jpg', reasons: ['no green cable'] },
  ],
  status: 'pending',
  created_at: '2026-06-11T08:00:00Z',
  resolved_by_name: null,
  resolved_at: null,
  resolution_note: null,
};

function mockFetchList(escalations: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { escalations } }),
  });
}

describe('SiteCamFailedQueue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists escalations with a link-styled site id', async () => {
    global.fetch = mockFetchList([ESCALATION]);
    render(<SiteCamFailedQueue />);
    const link = await screen.findByRole('button', { name: '9999990' });
    expect(link).toBeTruthy();
    expect(screen.getByText(/Step 6/)).toBeTruthy();
  });

  it('expands on site id click and shows all attempt photos', async () => {
    global.fetch = mockFetchList([ESCALATION]);
    render(<SiteCamFailedQueue />);
    fireEvent.click(await screen.findByRole('button', { name: '9999990' }));
    const imgs = await screen.findAllByRole('img');
    expect(imgs).toHaveLength(3);
    const matches = screen.getAllByText(/no green cable/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('requires a note to reject', async () => {
    global.fetch = mockFetchList([ESCALATION]);
    render(<SiteCamFailedQueue />);
    fireEvent.click(await screen.findByRole('button', { name: '9999990' }));
    const reject = await screen.findByRole('button', { name: /Reject/ });
    expect((reject as HTMLButtonElement).disabled).toBe(true);
  });

  it('posts to escalation-resolve on approve and reloads', async () => {
    const fetchMock = mockFetchList([ESCALATION]);
    global.fetch = fetchMock;
    render(<SiteCamFailedQueue />);
    fireEvent.click(await screen.findByRole('button', { name: '9999990' }));
    fireEvent.click(await screen.findByRole('button', { name: /Approve/ }));
    await waitFor(() => {
      const resolveCall = fetchMock.mock.calls.find(
        (c: unknown[]) => c[0] === '/api/sitecam/escalation-resolve',
      );
      expect(resolveCall).toBeTruthy();
      const init = resolveCall![1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ id: 'esc-1', resolution: 'approved' });
    });
  });
});
