/**
 * The security claim of an export link is that its SCOPE is inside the signature.
 *
 * The link is fetched without a session, so if the email or the owner flag could be
 * edited in the URL, the link would be an unauthenticated read of anyone's data. These
 * tests attack exactly that.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXPORT_TTL_SECONDS,
  isExportable,
  signExportLink,
  verifyExportLink,
} from '../exportLinks';
import type { ActionItemAccess } from '@/lib/actionItems/meetingAccess';

const JOHAN: ActionItemAccess = {
  isOwner: false,
  email: 'johan@velocityfibre.co.za',
  userId: '11111111-1111-4111-8111-111111111111',
};
const OWNER: ActionItemAccess = { isOwner: true, email: 'hein@velocityfibre.co.za', userId: 'x' };

beforeEach(() => vi.stubEnv('PHOTO_LINK_SECRET', 'test-secret-not-a-real-one'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('isExportable', () => {
  it('accepts only the known reports', () => {
    expect(isExportable('action-items')).toBe(true);
    expect(isExportable('meetings')).toBe(true);
    expect(isExportable('transcripts')).toBe(false);
    expect(isExportable('')).toBe(false);
    expect(isExportable(undefined)).toBe(false);
  });
});

describe('signExportLink / verifyExportLink', () => {
  it('round-trips a link it just signed', () => {
    const signed = signExportLink('action-items', JOHAN, 'open')!;
    const { verdict, access } = verifyExportLink(
      'action-items', JOHAN.email, false, 'open', String(signed.exp), signed.sig,
    );
    expect(verdict).toBe('ok');
    expect(access?.email).toBe(JOHAN.email);
    expect(access?.isOwner).toBe(false);
  });

  it('REFUSES a link whose email has been edited', () => {
    // The attack: take your own link, swap in someone else's address, read their slice.
    const signed = signExportLink('action-items', JOHAN, 'open')!;
    const { verdict } = verifyExportLink(
      'action-items', 'lew@velocityfibre.co.za', false, 'open', String(signed.exp), signed.sig,
    );
    expect(verdict).toBe('invalid');
  });

  it('REFUSES a link whose owner flag has been raised', () => {
    // The escalation: owner=1 would return every row in the table.
    const signed = signExportLink('action-items', JOHAN, 'open')!;
    const { verdict } = verifyExportLink(
      'action-items', JOHAN.email, true, 'open', String(signed.exp), signed.sig,
    );
    expect(verdict).toBe('invalid');
  });

  it('REFUSES a link whose filters have been widened', () => {
    // state=open -> state=all would return completed items the link was not minted for.
    const signed = signExportLink('action-items', JOHAN, 'open')!;
    const { verdict } = verifyExportLink(
      'action-items', JOHAN.email, false, 'all', String(signed.exp), signed.sig,
    );
    expect(verdict).toBe('invalid');
  });

  it('REFUSES a link replayed against a different report', () => {
    const signed = signExportLink('action-items', JOHAN, 'open')!;
    const { verdict } = verifyExportLink(
      'meetings', JOHAN.email, false, 'open', String(signed.exp), signed.sig,
    );
    expect(verdict).toBe('invalid');
  });

  it('REFUSES a link whose expiry has been pushed out', () => {
    const signed = signExportLink('action-items', JOHAN, 'open')!;
    const { verdict } = verifyExportLink(
      'action-items', JOHAN.email, false, 'open', String(signed.exp + 86_400), signed.sig,
    );
    expect(verdict).toBe('invalid');
  });

  it('reports expiry only for a link that was otherwise genuine', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T09:00:00Z'));
    const signed = signExportLink('action-items', JOHAN, 'open')!;

    vi.setSystemTime(new Date('2026-07-15T09:00:00Z').getTime() + (EXPORT_TTL_SECONDS + 1) * 1000);
    const { verdict } = verifyExportLink(
      'action-items', JOHAN.email, false, 'open', String(signed.exp), signed.sig,
    );
    expect(verdict).toBe('expired');
  });

  it('is still valid one second before it expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T09:00:00Z'));
    const signed = signExportLink('action-items', JOHAN, 'open')!;

    vi.setSystemTime(new Date('2026-07-15T09:00:00Z').getTime() + (EXPORT_TTL_SECONDS - 1) * 1000);
    expect(
      verifyExportLink('action-items', JOHAN.email, false, 'open', String(signed.exp), signed.sig)
        .verdict,
    ).toBe('ok');
  });

  it('expires well inside the photo link TTL', () => {
    // A CSV is a bulk extract of meeting content; a photo link is one image.
    expect(EXPORT_TTL_SECONDS).toBeLessThan(60 * 60);
  });

  it('fails CLOSED with no secret configured, rather than signing nothing', () => {
    vi.stubEnv('PHOTO_LINK_SECRET', '');
    expect(signExportLink('action-items', JOHAN, 'open')).toBeNull();
    expect(
      verifyExportLink('action-items', JOHAN.email, false, 'open', '99999999999', 'deadbeef')
        .verdict,
    ).toBe('unconfigured');
  });

  it('rebuilds access WITHOUT a user id, so a link is never wider than its page', () => {
    // The user-id arm of the action-item rule only ever widens. Omitting it makes the
    // link slightly narrower than the page that minted it — the safe direction.
    const signed = signExportLink('action-items', JOHAN, 'open')!;
    const { access } = verifyExportLink(
      'action-items', JOHAN.email, false, 'open', String(signed.exp), signed.sig,
    );
    expect(access?.userId).toBe('');
  });

  it('signs the owner and a normal caller to different signatures', () => {
    const a = signExportLink('meetings', JOHAN, 'open')!;
    const b = signExportLink('meetings', OWNER, 'open')!;
    expect(a.sig).not.toBe(b.sig);
  });
});
