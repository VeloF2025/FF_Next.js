import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SiteCamSignatureStep } from '../SiteCamSignatureStep';
import { SIGNOFF_CONSENT_TEXT } from '../../lib/signoff';

vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

describe('SiteCamSignatureStep', () => {
  it('renders the name field, consent statement, signature pad and confirm button', () => {
    render(<SiteCamSignatureStep onSigned={vi.fn()} />);
    expect(screen.getByLabelText(/Customer name/i)).toBeTruthy();
    expect(screen.getByText(SIGNOFF_CONSENT_TEXT)).toBeTruthy();
    expect(screen.getByText(/Customer signature/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Confirm sign-off/i })).toBeTruthy();
  });

  it('disables confirm until name, consent AND signature are all present', () => {
    const onSigned = vi.fn();
    render(<SiteCamSignatureStep onSigned={onSigned} />);
    const confirm = screen.getByRole('button', { name: /Confirm sign-off/i }) as HTMLButtonElement;

    // Nothing filled in → disabled.
    expect(confirm.disabled).toBe(true);

    // Name + consent but no signature (the pad needs a canvas, unavailable in
    // jsdom) → still disabled, proving the signature is required.
    fireEvent.change(screen.getByLabelText(/Customer name/i), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirm.disabled).toBe(true);

    // Confirm never fired without a signature.
    fireEvent.click(confirm);
    expect(onSigned).not.toHaveBeenCalled();
  });
});
