import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SerialScanStep } from '../SerialScanStep';
import { normaliseSerialCandidate } from '../../lib/serialCandidate';

const scannerStart = vi.fn();
const scannerStop = vi.fn();
let scanHandler: ((r: { decodedText: string }) => void | Promise<void>) | null = null;

vi.mock('@/modules/barcode-scanner/hooks/useBarcodeScanner', () => ({
  useBarcodeScanner: (opts: { onScan: (r: { decodedText: string }) => void | Promise<void> }) => {
    scanHandler = opts.onScan;
    return {
      start: scannerStart,
      stop: scannerStop,
      state: 'idle',
      error: null,
      toggleTorch: vi.fn(),
      isTorchOn: false,
    };
  },
}));

const baseProps = {
  stepNumber: 6,
  serialLabel: 'ONT Serial',
  serialDevice: 'ont' as const,
  serialAttempts: 0,
  drNumber: 'DR1234567',
  onScanSaved: vi.fn(),
};

function mockSavedFetch(serial = 'ALCLB48E9DE0') {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      data: { result: 'saved', serial, message: 'Serial saved — cross-reference pending (1Map + OES)', crossRefStatus: 'pending' },
    }),
  });
}

describe('normaliseSerialCandidate', () => {
  it('extracts an ONT serial from scanner noise and separators', () => {
    expect(normaliseSerialCandidate('S/N: alcl b48e-9de0 ', 'ALCL')).toBe('ALCLB48E9DE0');
  });
});

describe('SerialScanStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scanHandler = null;
    scannerStart.mockResolvedValue(undefined);
    scannerStop.mockResolvedValue(undefined);
    global.fetch = vi.fn();
  });

  it('offers manual ONT entry as a fallback to camera scanning', () => {
    render(<SerialScanStep {...baseProps} />);
    expect(screen.getByText('Manual ONT Serial')).toBeTruthy();
    expect(screen.getByPlaceholderText('ALCL...')).toBeTruthy();
    expect(screen.getByText(/type the serial exactly as printed, then review and confirm/)).toBeTruthy();
  });

  it('does NOT save a typed serial until it is confirmed', async () => {
    const onScanSaved = vi.fn();
    mockSavedFetch();
    render(<SerialScanStep {...baseProps} onScanSaved={onScanSaved} />);

    fireEvent.change(screen.getByPlaceholderText('ALCL...'), { target: { value: 'S/N: alcl b48e-9de0' } });
    fireEvent.click(screen.getByText('Review ONT Serial'));

    // Confirm card is shown; nothing has been POSTed yet.
    expect(screen.getByText('Is this ONT Serial correct?')).toBeTruthy();
    expect(screen.getByText('ALCLB48E9DE0')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onScanSaved).not.toHaveBeenCalled();

    // Confirm → saves.
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(onScanSaved).toHaveBeenCalledWith('ALCLB48E9DE0'));
    expect(global.fetch).toHaveBeenCalledWith('/api/my/sitecam/verify-serial', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"device":"ont"'),
    }));
    expect(screen.getByText('Serial saved — ALCLB48E9DE0')).toBeTruthy();
  });

  it('Rescan / Edit discards the candidate without saving', () => {
    render(<SerialScanStep {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText('ALCL...'), { target: { value: 'alclb48e9de0' } });
    fireEvent.click(screen.getByText('Review ONT Serial'));
    expect(screen.getByText('Is this ONT Serial correct?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Rescan \/ Edit/ }));
    // Back on the scan/manual UI, nothing saved, typed value retained for editing.
    expect(screen.getByText('Manual ONT Serial')).toBeTruthy();
    expect((screen.getByPlaceholderText('ALCL...') as HTMLInputElement).value).toBe('ALCLB48E9DE0');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('routes a camera scan through the confirm gate before saving', async () => {
    const onScanSaved = vi.fn();
    mockSavedFetch();
    render(<SerialScanStep {...baseProps} onScanSaved={onScanSaved} />);

    // Simulate a barcode read.
    await scanHandler?.({ decodedText: 'S/N alcl-b48e9de0' });
    await waitFor(() => expect(screen.getByText('Is this ONT Serial correct?')).toBeTruthy());
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(onScanSaved).toHaveBeenCalledWith('ALCLB48E9DE0'));
  });

  it('shows a Gizzu UPS "2 of 2" hint when positioned as the second serial', () => {
    render(
      <SerialScanStep
        {...baseProps}
        serialLabel="Gizzu UPS Serial"
        serialDevice="ups"
        serialPosition={{ index: 1, total: 2 }}
      />,
    );
    expect(screen.getByText('Serial 2 of 2')).toBeTruthy();
    expect(screen.getByText('Manual Gizzu UPS Serial')).toBeTruthy();
  });

  it('keeps the entered serial visible after a network failure so the user can retry', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

    render(<SerialScanStep {...baseProps} />);
    const input = screen.getByPlaceholderText('ALCL...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'alclb48e9de0' } });
    fireEvent.click(screen.getByText('Review ONT Serial'));
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));

    await waitFor(() => expect(screen.getByText(/Network error while saving/)).toBeTruthy());
    expect(input.value).toBe('ALCLB48E9DE0');
    expect(screen.getByText('Review ONT Serial')).toBeTruthy();
  });

  it('shows a manual-entry message when the camera scanner fails to start', async () => {
    scannerStart.mockRejectedValue(new Error('Permission denied'));

    render(<SerialScanStep {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Scan ONT Serial/ }));

    await waitFor(() => expect(screen.getByText(/Could not start camera scanner/)).toBeTruthy());
    expect(screen.getByText('Manual ONT Serial')).toBeTruthy();
  });
});
