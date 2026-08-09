import { describe, expect, it, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import type { TrackerResult } from '../../types/zoneDelivery.types';
import { ZoneTrackerPage } from '../ZoneTrackerPage';

const fetchMock = vi.fn();

const trackerData: TrackerResult = {
  zones: [
    {
      projectId: 'p-lawley', projectName: 'Lawley', zoneNo: 20,
      totalPons: 1, livePons: 1, homesActive: 84,
      handedOverAt: '2026-08-05T09:00:00.000Z',
    },
    {
      projectId: 'p-etwatwa', projectName: 'Etwatwa', zoneNo: 24,
      totalPons: 2, livePons: 1, homesActive: 77,
      handedOverAt: null,
    },
  ],
  pons: [
    {
      projectId: 'p-lawley', projectName: 'Lawley', zoneNo: 20, ponNo: 212,
      portSubmittedAt: '2026-08-05T09:00:00.000Z', homesActive: 84,
    },
    {
      projectId: 'p-etwatwa', projectName: 'Etwatwa', zoneNo: 24, ponNo: 267,
      portSubmittedAt: null, homesActive: 77,
    },
    {
      projectId: 'p-etwatwa', projectName: 'Etwatwa', zoneNo: 24, ponNo: 268,
      portSubmittedAt: null, homesActive: 0,
    },
  ],
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: trackerData }) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ZoneTrackerPage', () => {
  it('shows the zone overview columns Johan keeps in Excel', async () => {
    render(<ZoneTrackerPage />);
    await settle();

    const header = screen.getByRole('table');
    for (const column of ['Site', 'Zone', 'Total PONs', 'PONs live', 'Zone handover']) {
      expect(within(header).getByText(column)).toBeInTheDocument();
    }
    // Handover renders as a bare SAST date, not a timestamp with a timezone.
    expect(screen.getByText('05/08/2026')).toBeInTheDocument();
  });

  it('omits the gate, blocker and QA columns that made the register unusable', async () => {
    render(<ZoneTrackerPage />);
    await settle();

    for (const column of ['Current gate', 'Blockers', 'Civil Zone QA', 'Optical Zone QA']) {
      expect(screen.queryByText(column)).not.toBeInTheDocument();
    }
    // The status label the register falls back to must not leak in either: no
    // zone in production has an approved scope, so it would be on every row.
    expect(screen.queryByText('Scope not approved')).not.toBeInTheDocument();
  });

  it('switches to the PON table and can narrow it to submitted PONs', async () => {
    render(<ZoneTrackerPage />);
    await settle();

    fireEvent.click(screen.getByRole('tab', { name: 'PONs' }));
    expect(screen.getByText('212')).toBeInTheDocument();
    expect(screen.getByText('267')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Submitted PONs only'));
    expect(screen.getByText('212')).toBeInTheDocument();
    expect(screen.queryByText('267')).not.toBeInTheDocument();
  });

  it('requests a single site when one is picked', async () => {
    render(<ZoneTrackerPage />);
    await settle();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p-etwatwa' } });
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some(url => url.includes('project_id=p-etwatwa'))).toBe(true);
    });
  });

  it('surfaces a failed load instead of rendering an empty tracker', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: { message: 'Tracker unavailable' } }),
    });
    render(<ZoneTrackerPage />);
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('Tracker unavailable');
  });
});
