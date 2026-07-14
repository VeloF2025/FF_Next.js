import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepCapture } from '../StepCapture';
import type { StepState } from '../../hooks/useSiteCamCapture';

function step(overrides: Partial<StepState>): StepState {
  return {
    stepNumber: 1,
    label: 'House / Property Photo',
    hasVlm: true,
    hasSerialScan: false,
    serials: [],
    serialIndex: 0,
    serialLabel: '',
    serialDevice: null,
    serialAttempts: 0,
    serialScanned: null,
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
    serials: [
      { device: 'ont', label: 'ONT Serial' },
      { device: 'ups', label: 'Gizzu UPS Serial' },
    ],
    serialIndex: 0,
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

describe('StepCapture gallery upload (allowUpload prop)', () => {
  it('hides the "Upload Photo" button by default (allowUpload unset)', () => {
    // Camera-only steps (1–9, civils) must never offer the gallery upload —
    // it would defeat the live-capture / anti-reuse guarantee.
    render(<StepCapture step={step({ status: 'pending' })} {...baseProps} />);
    expect(screen.getByText('Take Photo')).toBeTruthy();
    expect(screen.queryByText('Upload Photo')).toBeNull();
  });

  it('shows the "Upload Photo" button when allowUpload is true', () => {
    // Signature + dome-joint steps pass allowUpload — the photo is legitimately
    // captured outside the SiteCam camera.
    render(<StepCapture step={step({ status: 'pending' })} {...baseProps} allowUpload />);
    expect(screen.getByText('Upload Photo')).toBeTruthy();
  });

  it('routes an uploaded file through onCapture (same pipeline as a camera photo)', () => {
    const onCapture = vi.fn();
    const { container } = render(
      <StepCapture step={step({ status: 'pending' })} {...baseProps} onCapture={onCapture} allowUpload />,
    );
    // The gallery input is the one without a `capture` attribute.
    const galleryInput = container.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    const file = new File(['x'], 'signature.jpg', { type: 'image/jpeg' });
    fireEvent.change(galleryInput, { target: { files: [file] } });
    expect(onCapture).toHaveBeenCalledWith(file);
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

  // TEMPORARY (dev testing): the flag also opens gallery upload on every step so
  // other-site photos can exercise camera-only steps. Remove with the feature.
  it('shows "Upload Photo (test)" on a camera-only step when the flag is "true"', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD', 'true');
    const { StepCapture: FlaggedStepCapture } = await import('../StepCapture');
    // step 1 is camera-only (no allowUpload prop) — normally no gallery button.
    render(<FlaggedStepCapture step={step({ status: 'pending' })} {...baseProps} />);
    expect(screen.getByText('Upload Photo (test)')).toBeTruthy();
  });

  it('keeps a camera-only step gallery-free when the flag is explicitly "false"', async () => {
    // Fail-closed: an explicit "false" (not just unset) must not open the upload.
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD', 'false');
    const { StepCapture: FlaggedStepCapture } = await import('../StepCapture');
    render(<FlaggedStepCapture step={step({ status: 'pending' })} {...baseProps} />);
    expect(screen.queryByText('Upload Photo')).toBeNull();
    expect(screen.queryByText('Upload Photo (test)')).toBeNull();
  });

  it('labels the permanent allowUpload button plainly (not "(test)") even with the flag on', async () => {
    // Steps 10–12 pass allowUpload; the dev flag must not relabel their
    // permanent, production button as a test affordance.
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SITECAM_ALLOW_UPLOAD', 'true');
    const { StepCapture: FlaggedStepCapture } = await import('../StepCapture');
    render(<FlaggedStepCapture step={step({ status: 'pending' })} {...baseProps} allowUpload />);
    expect(screen.getByText('Upload Photo')).toBeTruthy();
    expect(screen.queryByText('Upload Photo (test)')).toBeNull();
  });
});
