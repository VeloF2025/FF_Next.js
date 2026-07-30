import { describe, expect, it, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { ZoneRegisterResult } from '../../types/zoneDelivery.types';
import { ZoneDeliveryRegisterPage } from '../ZoneDeliveryRegisterPage';

const fetchMock = vi.fn();

const registerData: ZoneRegisterResult = {
  rows: [{
    projectId: 'project & one', projectName: 'Project One', zoneNo: 7,
    status: 'ready_for_zone_qa', includedPons: 12, livePons: 8,
    earliestIncompleteGate: 'port_approved', blockerCount: 2,
    civilQa: 'passed', opticalQa: 'in_progress', handedOverAt: null,
  }],
  summary: { zones: 1, includedPons: 12, livePons: 8, readyForQa: 1, handedOver: 0 },
};

const success = (data = registerData) => ({
  ok: true,
  json: async () => ({ success: true, data }),
});

const renderPage = () => render(<ZoneDeliveryRegisterPage />);

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const expectFilterRequest = async (parameter: string, value: string) => {
  await waitFor(() => {
    const requests = fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'));
    expect(requests.some(request => request.searchParams.get(parameter) === value)).toBe(true);
  });
  await settle();
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(success());
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('ZoneDeliveryRegisterPage', () => {
  it('shows an accessible loading state before the initial register response', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole('status', { name: /loading zone delivery register/i })).toBeInTheDocument();
  });

  it('shows the server-provided summary and operational columns', async () => {
    renderPage();
    expect(await screen.findByText('Approved-scope PONs')).toBeInTheDocument();
    expect(screen.getByText('Technically live PONs')).toBeInTheDocument();
    expect(screen.getAllByText('Ready for Zone QA')).toHaveLength(3);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('8 / 12')).toBeInTheDocument();
    expect(screen.getByText('Port approved')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Ready for Zone QA', { selector: 'td' })).toBeInTheDocument();
  });

  it('shows the empty result message', async () => {
    fetchMock.mockResolvedValue(success({ ...registerData, rows: [], summary: { ...registerData.summary, zones: 0 } }));
    renderPage();
    expect(await screen.findByText('No zones match the current filters.')).toBeInTheDocument();
  });

  it('shows an error and retries the register request', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Register unavailable' } }) });
    renderPage();
    expect(await screen.findByText('Register unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Project One Zone 7' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends every filter through the exact register query parameters', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Project One Zone 7' });
    await screen.findByRole('option', { name: 'Project One' });

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project & one' } });
    await expectFilterRequest('project_id', 'project & one');
    fireEvent.change(screen.getByLabelText('Zone number'), { target: { value: '7' } });
    await expectFilterRequest('zone_no', '7');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ready_for_zone_qa' } });
    await expectFilterRequest('status', 'ready_for_zone_qa');
    fireEvent.change(screen.getByLabelText('Blocker'), { target: { value: 'BLOCKING_SNAG' } });
    await expectFilterRequest('blocker', 'BLOCKING_SNAG');
    fireEvent.change(screen.getByLabelText('Handover'), { target: { value: 'pending' } });
    await expectFilterRequest('handover', 'pending');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'north' } });
    await expectFilterRequest('search', 'north');
  });

  it('clears all active filters', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Project One Zone 7' });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'north' } });
    await expectFilterRequest('search', 'north');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      const latest = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'http://localhost');
      expect(latest.search).toBe('');
    });
    await settle();
  });

  it('keeps rows visible while refresh is in progress and updates only after success', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Project One Zone 7' });
    let resolveRefresh: ((value: ReturnType<typeof success>) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByRole('link', { name: 'Project One Zone 7' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refreshing' })).toBeDisabled();
    await act(async () => { resolveRefresh?.(success()); });
    expect(await screen.findByText(/Updated:/)).toBeInTheDocument();
  });

  it('uses the encoded stable zone route and shows a handed-over date', async () => {
    fetchMock.mockResolvedValue(success({
      ...registerData,
      rows: [{ ...registerData.rows[0], handedOverAt: '2026-07-30T10:00:00.000Z', status: 'handed_over' }],
      summary: { ...registerData.summary, handedOver: 1 },
    }));
    renderPage();
    const link = await screen.findByRole('link', { name: 'Project One Zone 7' });
    expect(link).toHaveAttribute('href', '/field-ops/zone?project_id=project%20%26%20one&zone_no=7');
    expect(screen.getByText('2026-07-30')).toBeInTheDocument();
  });
});
