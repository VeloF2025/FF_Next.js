import { describe, expect, it, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { SubmitPonButton } from '../SubmitPonButton';
import { effectiveAtFor } from '../../services/zoneAttestationDate';

const can = vi.fn();
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can }) }));

const fetchMock = vi.fn();

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const body = () => JSON.parse(String(fetchMock.mock.calls[0]![1].body));

beforeEach(() => {
  can.mockReset().mockReturnValue(true);
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
  vi.stubGlobal('fetch', fetchMock);
});

const open = () => {
  render(<SubmitPonButton projectId="p-1" zoneNo={20} ponNo={212} />);
  fireEvent.click(screen.getByRole('button', { name: /Submit PON/ }));
};

describe('SubmitPonButton', () => {
  it('is hidden without the operations-confirm edit permission', () => {
    can.mockReturnValue(false);
    render(<SubmitPonButton projectId="p-1" zoneNo={20} ponNo={212} />);
    expect(screen.queryByRole('button', { name: /Submit PON/ })).not.toBeInTheDocument();
  });

  it('checks the permission the API enforces, not a nearby one', () => {
    render(<SubmitPonButton projectId="p-1" zoneNo={20} ponNo={212} />);
    expect(can).toHaveBeenCalledWith('construction-qa.zone-delivery.operations-confirm', 'edit');
  });

  it('submits today without asking for a reason', async () => {
    open();
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();

    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await settle();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/zone-delivery/pon-submit');
    expect(body()).toMatchObject({ projectId: 'p-1', zoneNo: 20, ponNo: 212, source: 'works-qa-toolbar' });
    expect(body().reason).toBeUndefined();
  });

  it('requires a reason once the date is moved back, and sends it', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Date submitted'), { target: { value: '2026-07-01' } });

    const reason = screen.getByLabelText('Reason for the earlier date');
    expect(reason).toBeRequired();

    fireEvent.change(reason, { target: { value: 'submitted on site' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await settle();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(body().reason).toBe('submitted on site');
    expect(body().effectiveAt).toBe(effectiveAtFor('2026-07-01', '2026-08-09'));
  });

  it('keeps the dialog open and shows why when the command refuses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: { message: 'PON 212 zone handover is terminal' } }),
    });
    open();
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('zone handover is terminal');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('effectiveAtFor', () => {
  it('records today as now, so the ordinary case is not treated as back-dated', () => {
    const now = Date.now();
    const recorded = new Date(effectiveAtFor('2026-08-09', '2026-08-09')).valueOf();
    // Well inside the command's five-minute back-dating threshold.
    expect(Math.abs(recorded - now)).toBeLessThan(5_000);
  });

  it('records an earlier day as midday SAST, clear of both date boundaries', () => {
    expect(effectiveAtFor('2026-07-01', '2026-08-09')).toBe('2026-07-01T10:00:00.000Z');
  });
});
