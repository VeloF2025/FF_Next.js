/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HsCheckinSteps } from '../HsCheckinSteps';

const P1 = { id: 'proj-1', project_name: 'Lawley FTTH' };

function bootstrapResponse(overrides: {
  projects?: Array<{ id: string; project_name: string }>;
  completed?: boolean;
  default_project_id?: string | null;
}) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        checkin_date: '2026-08-20',
        completed: overrides.completed ?? false,
        checkin: null,
        projects: overrides.projects ?? [],
        default_project_id: overrides.default_project_id ?? null,
        activities: [],
        medical_status: 'current',
      },
    }),
  };
}

function postResponse(clearance: string) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { checkin: { id: 'checkin-1' }, clearance, blocked_reasons: clearance === 'blocked' ? ['self_declared_unfit'] : [] },
    }),
  };
}

/**
 * Concatenated rendered text — React can split an interpolated string across
 * sibling text nodes, so matching against a single serialised node is not
 * reliable evidence the text is actually there.
 */
function concatText(container: HTMLElement): string {
  return container.textContent ?? '';
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderSteps(props?: Partial<Parameters<typeof HsCheckinSteps>[0]>) {
  const onDone = vi.fn();
  let utils: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <HsCheckinSteps
        attendanceEntryId={props?.attendanceEntryId ?? 'entry-1'}
        gps={props?.gps ?? { lat: -26.1, lon: 28.0 }}
        onDone={props?.onDone ?? onDone}
      />
    );
  });
  return { ...utils!, onDone };
}

describe('HsCheckinSteps', () => {
  it('asks for a location first and posts office with no project', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapResponse({ projects: [P1] }));
    fetchMock.mockResolvedValueOnce(postResponse('cleared'));
    const user = userEvent.setup();

    await renderSteps();

    await waitFor(() => expect(screen.getByText('Office')).toBeVisible());
    await user.click(screen.getByRole('button', { name: 'Office' }));
    await user.click(screen.getByRole('button', { name: 'Yes, I am' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(posted.work_location).toBe('office');
    expect(posted.project_id).toBeUndefined();
    expect(posted.ppe_complete).toBeUndefined();
  });

  it('asks the site questions when a project is chosen', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapResponse({ projects: [P1] }));
    fetchMock.mockResolvedValueOnce(postResponse('cleared'));
    const user = userEvent.setup();

    await renderSteps();

    await waitFor(() => expect(screen.getByText(P1.project_name)).toBeVisible());
    await user.click(screen.getByRole('button', { name: P1.project_name }));
    await user.click(screen.getByRole('button', { name: 'Yes, I am' }));
    await user.click(screen.getByRole('button', { name: 'Yes, all of it' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(posted.work_location).toBe('site');
    expect(posted.project_id).toBe(P1.id);
    expect(typeof posted.ppe_complete).toBe('boolean');
  });

  it('sends the attendance entry id and the gps fix', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapResponse({ projects: [P1] }));
    fetchMock.mockResolvedValueOnce(postResponse('cleared'));
    const user = userEvent.setup();

    await renderSteps({ attendanceEntryId: 'entry-1', gps: { lat: -26.1, lon: 28.0 } });

    await waitFor(() => expect(screen.getByText('Office')).toBeVisible());
    await user.click(screen.getByRole('button', { name: 'Office' }));
    await user.click(screen.getByRole('button', { name: 'Yes, I am' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(posted.attendance_entry_id).toBe('entry-1');
    expect(posted.lat).toBe(-26.1);
    expect(posted.lon).toBe(28.0);
  });

  it('shows the blocked outcome without hiding that the shift is recorded', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapResponse({ projects: [P1] }));
    fetchMock.mockResolvedValueOnce(postResponse('blocked'));
    const user = userEvent.setup();

    const { container } = await renderSteps();

    await waitFor(() => expect(screen.getByText('Office')).toBeVisible());
    await user.click(screen.getByRole('button', { name: 'Office' }));
    await user.click(screen.getByRole('button', { name: 'No, I am not' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const text = concatText(container);
      expect(text).toMatch(/supervisor/i);
    });
    const text = concatText(container);
    expect(text).toMatch(/supervisor/i);
    expect(text).toMatch(/time (has been|is) recorded|shift is recorded/i);
  });

  it('calls onDone and does not block when the POST fails', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapResponse({ projects: [P1] }));
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();

    const { onDone } = await renderSteps();

    await waitFor(() => expect(screen.getByText('Office')).toBeVisible());
    await user.click(screen.getByRole('button', { name: 'Office' }));
    await user.click(screen.getByRole('button', { name: 'Yes, I am' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('calls onDone immediately and renders nothing when already completed', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapResponse({ completed: true }));

    const { onDone, container } = await renderSteps();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(concatText(container).trim()).toBe('');
  });
});
