import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: ReactNode }) => children,
}));

import HsCheckinPage from '../../../../pages/my/hs-checkin';

const BOOTSTRAP_BODY = {
  data: {
    projects: [{ id: 'proj-1', project_name: 'Lawley Phase 3' }],
    activities: [],
    medical_status: 'current',
    default_project_id: '',
    completed: false,
  },
};

function fetchMockFor(submitResponse: unknown) {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(submitResponse) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(BOOTSTRAP_BODY) });
  });
}

describe('/my/hs-checkin — office option', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts work_location office with no project when Office is chosen', async () => {
    const fetchMock = fetchMockFor({
      success: true,
      data: { checkin: { clearance: 'cleared' }, blocked_reasons: [] },
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<HsCheckinPage />);

    const select = await screen.findByLabelText('Where are you working today?');
    await user.selectOptions(select, 'Office');
    await user.click(screen.getByText('Yes, I am'));
    await user.click(screen.getByText('Submit check-in'));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(posted.work_location).toBe('office');
    expect(posted.project_id).toBeUndefined();
    expect(posted.ppe_complete).toBeUndefined();
    expect(posted.declared_activities).toBeUndefined();
  });

  it('hides the PPE and activity questions once Office is chosen', async () => {
    vi.stubGlobal('fetch', fetchMockFor({ success: true, data: { checkin: {}, blocked_reasons: [] } }));

    render(<HsCheckinPage />);

    const select = await screen.findByLabelText('Where are you working today?');
    // A site chosen first (mirrors a worker with a default project) proves
    // the questions are genuinely present before Office hides them, not
    // absent for an unrelated reason such as never having rendered.
    await userEvent.selectOptions(select, 'Lawley Phase 3');
    expect(screen.getByText('Do you have all the PPE you need for today?')).toBeInTheDocument();

    await userEvent.selectOptions(select, 'Office');

    expect(screen.queryByText('Do you have all the PPE you need for today?')).not.toBeInTheDocument();
    expect(screen.queryByText('Will you do any of these today?')).not.toBeInTheDocument();
    expect(screen.queryByText('Seen anything unsafe? (optional)')).not.toBeInTheDocument();
  });

  it('still requires a project when a site is chosen', async () => {
    vi.stubGlobal('fetch', fetchMockFor({ success: true, data: { checkin: {}, blocked_reasons: [] } }));
    const user = userEvent.setup();

    render(<HsCheckinPage />);

    await screen.findByLabelText('Where are you working today?');
    // Neither Office nor a project selected — fit answered so that only the
    // location gate can be the reason for the refusal.
    await user.click(screen.getByText('Yes, I am'));
    await user.click(screen.getByText('Submit check-in'));

    expect(await screen.findByText(/choose which project/i)).toBeInTheDocument();
  });
});
