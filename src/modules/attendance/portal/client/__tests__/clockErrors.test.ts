/**
 * Unit tests for the pure ApiError → UI-state mapper used by
 * /my/attendance/clock. Keeping this pure means the page body doesn't need
 * a render-based test just to verify the error copy a field-staff user sees.
 */

import { describe, expect, it } from 'vitest';

import { ApiError } from '../api';
import { ImageDecodeError } from '../imageUtils';
import { mapConsentError, mapImageError, mapSubmitError } from '../clockErrors';

describe('mapImageError', () => {
  it('flags HEIC / decode failures with retake copy', () => {
    const r = mapImageError(new ImageDecodeError('cannot decode'));
    expect(r).toEqual({
      kind: 'error',
      message: expect.stringMatching(/retake the photo/i),
    });
  });

  it('falls back to generic for unknown errors', () => {
    const r = mapImageError(new Error('who knows'));
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/retake/i);
  });
});

describe('mapSubmitError', () => {
  it('routes 403 consent_missing to consent modal', () => {
    const err = new ApiError(403, 'FORBIDDEN', 'Consent required', { reason: 'consent_missing' });
    expect(mapSubmitError(err, 'in')).toEqual({ kind: 'consent_required' });
  });

  it('routes 403 consent_revoked to consent modal', () => {
    const err = new ApiError(403, 'FORBIDDEN', 'Consent revoked', { reason: 'consent_revoked' });
    expect(mapSubmitError(err, 'in')).toEqual({ kind: 'consent_required' });
  });

  it('routes 403 consent_revoked_mid_shift to consent modal on clock-out', () => {
    const err = new ApiError(403, 'FORBIDDEN', 'Revoked', {
      reason: 'consent_revoked_mid_shift',
    });
    expect(mapSubmitError(err, 'out')).toEqual({ kind: 'consent_required' });
  });

  it('shows "already open" message on 409 open_entry (clock-in only)', () => {
    const err = new ApiError(409, 'CONFLICT', 'Open', { reason: 'open_entry' });
    const r = mapSubmitError(err, 'in');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/open shift/i);
  });

  it('does NOT apply the 409 branch on clock-out (shouldn\'t happen server-side)', () => {
    const err = new ApiError(409, 'CONFLICT', 'Open', { reason: 'open_entry' });
    const r = mapSubmitError(err, 'out');
    // Falls through — some other ApiError path, just shows the server message.
    expect(r).not.toEqual({ kind: 'error', message: 'You already have an open shift. Go clock out first.' });
  });

  it('shows "no open shift" on 404 no_open_entry (clock-out)', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'None', { reason: 'no_open_entry' });
    const r = mapSubmitError(err, 'out');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/no open shift/i);
  });

  it('explains clock_skew with a phone-time hint', () => {
    const err = new ApiError(400, 'BAD_REQUEST', 'Bad skew', { reason: 'clock_skew' });
    const r = mapSubmitError(err, 'in');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/time/i);
  });

  it('shows a connection message for NETWORK_ERROR', () => {
    const err = new ApiError(0, 'NETWORK_ERROR', 'Unreachable');
    const r = mapSubmitError(err, 'in');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/connection/i);
  });

  it('masks 5xx messages behind a generic hint', () => {
    const err = new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
    const r = mapSubmitError(err, 'in');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).not.toMatch(/Internal server error/);
  });

  it('falls through to the server message for other 4xx codes', () => {
    const err = new ApiError(401, 'UNAUTHORIZED', 'Please sign in');
    const r = mapSubmitError(err, 'in');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toBe('Please sign in');
  });

  it('returns a generic message for non-ApiError throws', () => {
    const r = mapSubmitError(new Error('boom'), 'in');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/try again/i);
  });
});

describe('mapConsentError', () => {
  it('routes 404 to onboarding-incomplete copy', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'Missing credentials row');
    expect(mapConsentError(err)).toMatch(/onboarding/i);
  });

  it('routes NETWORK_ERROR to a connection message', () => {
    const err = new ApiError(0, 'NETWORK_ERROR', 'Unreachable');
    expect(mapConsentError(err)).toMatch(/connection/i);
  });

  it('passes through server message for other ApiErrors', () => {
    const err = new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
    expect(mapConsentError(err)).toBe('Internal server error');
  });

  it('returns a generic message for non-ApiError throws', () => {
    expect(mapConsentError(new Error('x'))).toMatch(/could not save consent/i);
  });
});
