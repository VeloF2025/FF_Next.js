import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SiteCamWizard } from '../SiteCamWizard';
import type { SiteInfo, StepState } from '../../hooks/useSiteCamCapture';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const useSiteCamCaptureMock = vi.fn();
vi.mock('../../hooks/useSiteCamCapture', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useSiteCamCapture')>(
    '../../hooks/useSiteCamCapture',
  );
  return { ...actual, useSiteCamCapture: (...args: unknown[]) => useSiteCamCaptureMock(...args) };
});

const profile = { staffId: 'staff-1', name: 'Tech', profilePhotoUrl: null } as never;
const SITE_INFO: SiteInfo = {
  jobType: 'civils', siteId: 'POLE-1', customerName: null, address: null,
  projectName: null, plannedLat: null, plannedLon: null, pon: null, zone: null,
};

function passedStep(over: Partial<StepState> = {}): StepState {
  return {
    stepNumber: 1, label: 'Before Photo', hasVlm: true, hasSerialScan: false,
    serialLabel: '', serialDevice: null, serialAttempts: 0, serialScanned: null,
    status: 'pass', photoBase64: 'QUJD', attemptNumber: 1, failReasons: [],
    corrections: [], needsManualReview: false, ...over,
  };
}

function baseHookReturn(over: Partial<ReturnType<typeof useSiteCamCaptureMock>> = {}) {
  return {
    stepStates: [passedStep()],
    currentStep: null,
    currentStepIndex: 0,
    allDone: true,
    captureAndValidate: vi.fn(),
    handleSerialSaved: vi.fn(),
    skipSerialStep: vi.fn(),
    submitAll: vi.fn(),
    uploading: false,
    uploadError: null,
    uploadResult: null,
    photoNotSaved: false,
    queued: false,
    flushing: false,
    retrySubmit: vi.fn(),
    escalateStep: vi.fn(),
    onAppealSubmitted: vi.fn(),
    appealPending: false,
    ...over,
  };
}

describe('SiteCamWizard offline states (Task 7)', () => {
  it('renders the "Saved offline" screen for a queued result — NOT the success screen', () => {
    useSiteCamCaptureMock.mockReturnValue(baseHookReturn({ queued: true }));
    render(<SiteCamWizard profile={profile} siteInfo={SITE_INFO} />);

    expect(screen.getByText('Saved offline')).toBeTruthy();
    expect(screen.queryByText('All done!')).toBeNull();
    expect(screen.queryByText('Submit All Photos')).toBeNull();
  });

  it('shows the couldn\'t-submit banner inside the offline screen when a flush errored', () => {
    useSiteCamCaptureMock.mockReturnValue(
      baseHookReturn({ queued: true, uploadError: 'Site not found' }),
    );
    render(<SiteCamWizard profile={profile} siteInfo={SITE_INFO} />);

    expect(screen.getByText("Couldn't submit")).toBeTruthy();
    expect(screen.getByText('Site not found')).toBeTruthy();
  });

  it('renders the green success screen (not the offline screen) once uploadResult lands', () => {
    useSiteCamCaptureMock.mockReturnValue(
      baseHookReturn({ queued: false, uploadResult: { uploadedCount: 1 } }),
    );
    render(<SiteCamWizard profile={profile} siteInfo={SITE_INFO} />);

    expect(screen.getByText('All done!')).toBeTruthy();
    expect(screen.queryByText('Saved offline')).toBeNull();
  });

  it('renders the photoNotSaved banner as a failure, not a check, while mid-capture', () => {
    useSiteCamCaptureMock.mockReturnValue(
      baseHookReturn({
        allDone: false,
        photoNotSaved: true,
        currentStep: passedStep({ status: 'pending', photoBase64: null }),
        stepStates: [passedStep({ status: 'pending', photoBase64: null })],
      }),
    );
    render(<SiteCamWizard profile={profile} siteInfo={SITE_INFO} />);

    expect(screen.getByText('Photo not saved on this device')).toBeTruthy();
  });

  it('renders nothing offline-specific for a normal idle/online-success flow', () => {
    useSiteCamCaptureMock.mockReturnValue(
      baseHookReturn({
        allDone: false,
        currentStep: passedStep({ status: 'pending', photoBase64: null }),
        stepStates: [passedStep({ status: 'pending', photoBase64: null })],
      }),
    );
    render(<SiteCamWizard profile={profile} siteInfo={SITE_INFO} />);

    expect(screen.queryByText('Saved offline')).toBeNull();
    expect(screen.queryByText('Photo not saved on this device')).toBeNull();
    expect(screen.queryByText("Couldn't submit")).toBeNull();
  });
});

describe('SiteCamWizard — SiteCamSubmitPanel extraction wiring', () => {
  it('clicking "Submit All Photos" calls the hook\'s submitAll (extraction preserved the wiring)', () => {
    const submitAll = vi.fn();
    useSiteCamCaptureMock.mockReturnValue(baseHookReturn({ submitAll }));
    render(<SiteCamWizard profile={profile} siteInfo={SITE_INFO} />);

    fireEvent.click(screen.getByText('Submit All Photos'));

    expect(submitAll).toHaveBeenCalledTimes(1);
  });
});
