import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepCapture } from '../StepCapture';
import type { StepState } from '../../hooks/useSiteCamCapture';

function step(overrides: Partial<StepState>): StepState {
  return {
    stepNumber: 1,
    label: 'House / Property Photo',
    hasVlm: true,
    status: 'pending',
    photoBase64: null,
    attemptNumber: 0,
    failReasons: [],
    corrections: [],
    needsManualReview: false,
    ...overrides,
  };
}

// All Props are required; tests only assert on rendered output, so the
// callbacks are inert mocks shared via spread.
const baseProps = {
  drNumber: 'DR0000000',
  onCapture: vi.fn(),
  onSerialSaved: vi.fn(),
  onSkipSerial: vi.fn(),
  onAppeal: vi.fn(),
};

// A step sitting on the ONT serial-scan stage (step 6).
const serialScanStep = (): StepState =>
  step({
    stepNumber: 6,
    label: 'ONT Back After Install',
    hasVlm: false,
    hasSerialScan: true,
    serialLabel: 'ONT Serial',
    serialDevice: 'ont',
    serialAttempts: 0,
    serialScanned: null,
    status: 'serial_scan',
    photoBase64: B64,
  });

const B64 = 'QUJD'; // "ABC"

describe('StepCapture photo preview', () => {
  it('shows no captured-photo image before a photo is taken (pending)', () => {
    render(<StepCapture step={step({ status: 'pending' })} {...baseProps} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Take Photo')).toBeTruthy();
  });

  it('renders the captured photo with a checking overlay while validating', () => {
    render(<StepCapture step={step({ status: 'validating', photoBase64: B64 })} {...baseProps} />);
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toContain(`data:image/jpeg;base64,${B64}`);
    expect(screen.getByText('Checking photo…')).toBeTruthy();
  });

  it('keeps the captured photo visible on pass', () => {
    render(<StepCapture step={step({ status: 'pass', photoBase64: B64 })} {...baseProps} />);
    expect((screen.getByRole('img') as HTMLImageElement).src).toContain(B64);
    expect(screen.getByText('Photo accepted!')).toBeTruthy();
  });

  it('shows the failed photo alongside the reason and a retake button', () => {
    render(
      <StepCapture
        step={step({ status: 'fail', photoBase64: B64, attemptNumber: 1, failReasons: ['Full property not in view'] })}
        {...baseProps}
      />,
    );
    expect((screen.getByRole('img') as HTMLImageElement).src).toContain(B64);
    expect(screen.getByText('Full property not in view')).toBeTruthy();
    expect(screen.getByText('Take Photo')).toBeTruthy();
  });
});

describe('StepCapture test-only gallery upload (NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('hides the "Upload Photo (test)" button by default (flag unset)', () => {
    // The statically-imported module was evaluated with the flag unset, so the
    // gallery upload must be invisible — this is the production-safe default.
    render(<StepCapture step={step({ status: 'pending' })} {...baseProps} />);
    expect(screen.getByText('Take Photo')).toBeTruthy();
    expect(screen.queryByText('Upload Photo (test)')).toBeNull();
  });

  it('shows the "Upload Photo (test)" button only when the flag is "true"', async () => {
    // The flag is read into a module-level const at import time, so the env must
    // be stubbed before a fresh import re-evaluates it.
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD', 'true');
    const { StepCapture: FlaggedStepCapture } = await import('../StepCapture');
    render(<FlaggedStepCapture step={step({ status: 'pending' })} {...baseProps} />);
    expect(screen.getByText('Upload Photo (test)')).toBeTruthy();
  });
});

describe('StepCapture test-only serial-scan skip (NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('hides the "Skip serial scan (test)" button by default (flag unset)', () => {
    render(<StepCapture step={serialScanStep()} {...baseProps} />);
    // The live barcode scanner is still offered; only the skip shortcut is gated.
    expect(screen.getAllByText('Scan ONT Serial').length).toBeGreaterThan(0);
    expect(screen.queryByText('Skip serial scan (test)')).toBeNull();
  });

  it('shows the skip button and fires onSkipSerial when the flag is "true"', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD', 'true');
    const { StepCapture: FlaggedStepCapture } = await import('../StepCapture');
    const onSkipSerial = vi.fn();
    render(<FlaggedStepCapture step={serialScanStep()} {...baseProps} onSkipSerial={onSkipSerial} />);
    const skip = screen.getByText('Skip serial scan (test)');
    fireEvent.click(skip);
    expect(onSkipSerial).toHaveBeenCalledTimes(1);
  });
});
