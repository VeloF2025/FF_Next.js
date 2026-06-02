import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const B64 = 'QUJD'; // "ABC"

describe('StepCapture photo preview', () => {
  it('shows no captured-photo image before a photo is taken (pending)', () => {
    render(<StepCapture step={step({ status: 'pending' })} onCapture={vi.fn()} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Take Photo')).toBeTruthy();
  });

  it('renders the captured photo with a checking overlay while validating', () => {
    render(<StepCapture step={step({ status: 'validating', photoBase64: B64 })} onCapture={vi.fn()} />);
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toContain(`data:image/jpeg;base64,${B64}`);
    expect(screen.getByText('Checking photo…')).toBeTruthy();
  });

  it('keeps the captured photo visible on pass', () => {
    render(<StepCapture step={step({ status: 'pass', photoBase64: B64 })} onCapture={vi.fn()} />);
    expect((screen.getByRole('img') as HTMLImageElement).src).toContain(B64);
    expect(screen.getByText('Photo accepted!')).toBeTruthy();
  });

  it('shows the failed photo alongside the reason and a retake button', () => {
    render(
      <StepCapture
        step={step({ status: 'fail', photoBase64: B64, attemptNumber: 1, failReasons: ['Full property not in view'] })}
        onCapture={vi.fn()}
      />,
    );
    expect((screen.getByRole('img') as HTMLImageElement).src).toContain(B64);
    expect(screen.getByText('Full property not in view')).toBeTruthy();
    expect(screen.getByText('Take Photo')).toBeTruthy();
  });
});
