import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SerialScanStep } from '../SerialScanStep';
import { normaliseSerialCandidate } from '../../lib/serialCandidate';

const scannerStart = vi.fn();
const scannerStop = vi.fn();

vi.mock('@/modules/barcode-scanner/hooks/useBarcodeScanner', () => ({
  useBarcodeScanner: () => ({
    start: scannerStart,
    stop: scannerStop,
    state: 'idle',
    error: null,
    toggleTorch: vi.fn(),
    isTorchOn: false,
  }),
}));

const baseProps = {
  stepNumber: 6,
  serialLabel: 'ONT Serial',
  serialDevice: 'ont' as const,
  serialAttempts: 0,
  drNumber: 'DR1234567',
  onScanSaved: vi.fn(),
};

describe('normaliseSerialCandidate', () => {
  it('extracts an ONT serial from scanner noise and separators', () => {
    expect(normaliseSerialCandidate('S/N: alcl b48e-9de0 ', 'ALCL')).toBe('ALCLB48E9DE0');
  });
});

describe('SerialScanStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scannerStart.mockResolvedValue(undefined);
    scannerStop.mockResolvedValue(undefined);
    global.fetch = vi.fn();
  });

  it('offers manual ONT entry as a fallback to camera scanning', () => {
    render(<SerialScanStep {...baseProps} />);

    expect(screen.getByText('Manual ONT Serial')).toBeTruthy();
    expect(screen.getByPlaceholderText('ALCL...')).toBeTruthy();
    expect(screen.getByText('If the camera cannot read the barcode, type the serial exactly as printed and save.')).toBeTruthy();
  });

  it('normalises and saves a manually entered ONT serial', async () => {
    const onScanSaved = vi.fn();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: {
          result: 'saved',
          serial: 'ALCLB48E9DE0',
          message: 'Serial saved — cross-reference pending (1Map + OES)',
          crossRefStatus: 'pending',
        },
      }),
    });

    render(<SerialScanStep {...baseProps} onScanSaved={onScanSaved} />);
    fireEvent.change(screen.getByPlaceholderText('ALCL...'), { target: { value: 'S/N: alcl b48e-9de0' } });
    fireEvent.click(screen.getByText('Save ONT Serial'));

    await waitFor(() => expect(onScanSaved).toHaveBeenCalledWith('ALCLB48E9DE0'));
    expect(global.fetch).toHaveBeenCalledWith('/api/my/sitecam/verify-serial', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: expect.stringContaining('ALCLB48E9DE0'),
    }));
    expect(screen.getByText('Serial saved — ALCLB48E9DE0')).toBeTruthy();
  });

  it('keeps the entered serial visible after a network failure so the user can retry', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

    render(<SerialScanStep {...baseProps} />);
    const input = screen.getByPlaceholderText('ALCL...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'alclb48e9de0' } });
    fireEvent.click(screen.getByText('Save ONT Serial'));

    await waitFor(() => expect(screen.getByText(/Network error while saving/)).toBeTruthy());
    expect(input.value).toBe('ALCLB48E9DE0');
    expect(screen.getByText('Save ONT Serial')).toBeTruthy();
  });

  it('shows a manual-entry message when the camera scanner fails to start', async () => {
    scannerStart.mockRejectedValue(new Error('Permission denied'));

    render(<SerialScanStep {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Scan ONT Serial/ }));

    await waitFor(() => expect(screen.getByText(/Could not start camera scanner/)).toBeTruthy());
    expect(screen.getByText('Manual ONT Serial')).toBeTruthy();
  });
});
