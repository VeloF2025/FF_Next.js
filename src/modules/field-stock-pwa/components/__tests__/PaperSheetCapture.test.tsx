/**
 * PaperSheetCapture — recording a stack of historical sheets.
 *
 * The bug these exist for: after saving, the component rendered the result
 * view and never reset it, and the only button navigated away. So the tool
 * could record exactly ONE sheet per visit, and the carry-forward of date and
 * receiver — the whole point of supporting a stack — was unreachable. It
 * shipped looking like a working feature with no test that could tell.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const request = vi.fn();
const fetchTechnicians = vi.fn();
vi.mock('@/modules/field-stock-pwa/api/request', () => ({
  request: (...a: unknown[]) => request(...a),
}));
vi.mock('@/modules/field-stock-pwa/api', () => ({
  fetchTechnicians: (...a: unknown[]) => fetchTechnicians(...a),
}));

import { PaperSheetCapture } from '../PaperSheetCapture';

const RECEIVER = '7f325850-b286-42c5-9d76-dfba5d692200';
const SUMMARY = {
  sheetId: 'sheet-1', total: 1, alreadyRecorded: 0, contradictsStock: 0,
  unknownSerial: 1, unclassified: 0,
  serials: [{ serialNumber: 'ALCLB48F4F5A', status: null, verdict: 'unknown-serial' }],
};

beforeEach(() => {
  request.mockReset();
  fetchTechnicians.mockReset();
  fetchTechnicians.mockResolvedValue([
    { id: RECEIVER, name: 'Tshepo Mahlangu', phone: null, contractorId: null,
      contractorName: null, accountStatus: 'active', role: 'technician',
      siteProjectId: null, siteProjectName: null, siteSource: 'none',
      siteMatch: 'unmapped-store' },
  ]);
  request.mockResolvedValue(SUMMARY);
});

async function saveASheet(props: Record<string, unknown> = {}) {
  const onRecorded = vi.fn();
  const onNextSheet = vi.fn();
  const view = render(
    <PaperSheetCapture
      serials={['ALCLB48F4F5A']}
      onBack={vi.fn()}
      onRecorded={onRecorded}
      onNextSheet={onNextSheet}
      {...props}
    />,
  );
  // Wait for the OPTION, not just the fetch: setting a select value before its
  // options exist silently leaves it empty.
  await waitFor(() => expect(screen.getByRole('option', { name: 'Tshepo Mahlangu' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/date written/i), { target: { value: '2026-05-11' } });
  fireEvent.change(screen.getByLabelText(/who received/i), { target: { value: RECEIVER } });
  fireEvent.click(screen.getByRole('button', { name: /record this sheet/i }));
  // Wait for the RESULT view, not merely for the request: the state update
  // that swaps the form for the result flushes after the promise resolves.
  await waitFor(() => expect(screen.getByText(/sheet recorded/i)).toBeTruthy());
  return { onRecorded, onNextSheet, view };
}

describe('recording a stack', () => {
  it('offers a way to record the NEXT sheet after saving', async () => {
    // Without this the tool records one sheet per visit.
    await saveASheet();
    await waitFor(() => expect(screen.getByRole('button', { name: /next sheet/i })).toBeTruthy());
  });

  it('asks the page to start a fresh sheet, rather than navigating away', async () => {
    const { onNextSheet } = await saveASheet();
    fireEvent.click(screen.getByRole('button', { name: /next sheet/i }));
    expect(onNextSheet).toHaveBeenCalled();
  });

  it('returns to the form so the next sheet can be entered', async () => {
    await saveASheet();
    fireEvent.click(screen.getByRole('button', { name: /next sheet/i }));
    // The form is back — the result view no longer blocks the way.
    await waitFor(() => expect(screen.getByLabelText(/date written/i)).toBeTruthy());
  });

  it('still offers a way out of the tool entirely', async () => {
    await saveASheet();
    expect(screen.getByRole('button', { name: /back to stores/i })).toBeTruthy();
  });

  it('reports the date and receiver it used, so the next sheet can reuse them', async () => {
    const { onRecorded } = await saveASheet();
    expect(onRecorded).toHaveBeenCalledWith({
      sheetDate: '2026-05-11', receiverStaffId: RECEIVER,
    });
  });

  it('starts from the carried date and receiver when given them', async () => {
    render(
      <PaperSheetCapture
        serials={['X1234567']}
        onBack={vi.fn()}
        initialDate="2026-05-11"
        initialReceiverId={RECEIVER}
      />,
    );
    await waitFor(() => expect(screen.getByRole('option', { name: 'Tshepo Mahlangu' })).toBeTruthy());
    expect((screen.getByLabelText(/date written/i) as HTMLInputElement).value).toBe('2026-05-11');
    expect((screen.getByLabelText(/who received/i) as HTMLSelectElement).value).toBe(RECEIVER);
  });
});

describe('what it refuses to save', () => {
  it('will not save without a receiver, however many serials are scanned', async () => {
    render(<PaperSheetCapture serials={['ALCLB48F4F5A']} onBack={vi.fn()} />);
    await waitFor(() => expect(fetchTechnicians).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/date written/i), { target: { value: '2026-05-11' } });
    // The receiver is the batch key — a batch without one is not a batch.
    expect(screen.getByRole('button', { name: /choose who received/i })).toHaveProperty('disabled', true);
    expect(request).not.toHaveBeenCalled();
  });

  it('will not save without a date', async () => {
    render(<PaperSheetCapture serials={['ALCLB48F4F5A']} onBack={vi.fn()} />);
    await waitFor(() => expect(fetchTechnicians).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /date first/i })).toHaveProperty('disabled', true);
  });

  it('sends the receiver id, not a typed name', async () => {
    await saveASheet();
    const body = JSON.parse((request.mock.calls[0]![1] as { body: string }).body);
    expect(body.receiverStaffId).toBe(RECEIVER);
    expect(body.technicianName).toBeUndefined();
  });
});
