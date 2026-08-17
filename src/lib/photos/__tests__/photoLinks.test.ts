import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signLink, verifyLink, isConfigured, LINK_TTL_SECONDS, remainingTtl } from '../photoLinks';

describe('photo download link signing', () => {
  beforeEach(() => {
    process.env.PHOTO_LINK_SECRET = 'test-photo-link-secret';
  });
  afterEach(() => {
    delete process.env.PHOTO_LINK_SECRET;
  });

  it('accepts a link it just signed', () => {
    const parts = { key: 'etwatwa/ETW.P.F283/a.jpg', source: 'local', uid: 'user-1', purpose: 'download' };
    const signed = signLink(parts);
    expect(signed).not.toBeNull();
    expect(verifyLink(parts, String(signed!.exp), signed!.sig)).toBe('ok');
  });

  it('rejects a link edited to point at another photo', () => {
    // The whole reason the key is inside the signature: a leaked link must open exactly
    // one photo and must not be walkable into the rest of the archive.
    const signed = signLink({ key: 'etwatwa/a.jpg', source: 'local', uid: 'user-1', purpose: 'download' })!;
    const verdict = verifyLink(
      { key: 'lawley/secret.jpg', source: 'local', uid: 'user-1', purpose: 'download' },
      String(signed.exp),
      signed.sig,
    );
    expect(verdict).toBe('invalid');
  });

  it('rejects a link replayed under another user id', () => {
    const signed = signLink({ key: 'a.jpg', source: 'local', uid: 'user-1', purpose: 'download' })!;
    expect(verifyLink({ key: 'a.jpg', source: 'local', uid: 'user-2', purpose: 'download' }, String(signed.exp), signed.sig)).toBe(
      'invalid',
    );
  });

  it('rejects an expiry pushed further out', () => {
    const parts = { key: 'a.jpg', source: 'local', uid: 'user-1', purpose: 'download' };
    const signed = signLink(parts)!;
    const later = String(signed.exp + 86_400);
    expect(verifyLink(parts, later, signed.sig)).toBe('invalid');
  });

  it('reports expiry only for a signature that is otherwise genuine', () => {
    const parts = { key: 'a.jpg', source: 'local', uid: 'user-1', purpose: 'download' };
    const signed = signLink(parts, -10)!; // already expired
    expect(verifyLink(parts, String(signed.exp), signed.sig)).toBe('expired');
    // A forged signature must NOT be told its payload was otherwise fine.
    expect(verifyLink(parts, String(signed.exp), 'f'.repeat(64))).toBe('invalid');
  });

  it('cannot be fooled by shifting a character between fields', () => {
    // Without length-prefixing, {key:"ab", source:"c"} and {key:"a", source:"bc"} would
    // canonicalise to the same string and share a signature.
    const a = signLink({ key: 'ab', source: 'c', uid: 'u', purpose: 'download' })!;
    expect(verifyLink({ key: 'a', source: 'bc', uid: 'u', purpose: 'download' }, String(a.exp), a.sig)).toBe('invalid');
  });

  it('is order-independent, so callers cannot break it by reordering parts', () => {
    const signed = signLink({ key: 'a.jpg', source: 'local', uid: 'u', purpose: 'download' })!;
    expect(verifyLink({ uid: 'u', source: 'local', key: 'a.jpg', purpose: 'download' }, String(signed.exp), signed.sig)).toBe('ok');
  });

  it('fails closed with no secret configured', () => {
    const parts = { key: 'a.jpg', source: 'local', uid: 'u', purpose: 'download' };
    const signed = signLink(parts)!;
    delete process.env.PHOTO_LINK_SECRET;

    expect(isConfigured()).toBe(false);
    expect(signLink(parts)).toBeNull();
    // Critically NOT 'ok': an unconfigured server must refuse links, not wave them past.
    expect(verifyLink(parts, String(signed.exp), signed.sig)).toBe('unconfigured');
  });

  it('rejects malformed exp and sig types rather than throwing', () => {
    const parts = { key: 'a.jpg', source: 'local', uid: 'u', purpose: 'download' };
    expect(verifyLink(parts, undefined, undefined)).toBe('invalid');
    expect(verifyLink(parts, 'not-a-number', 'abc')).toBe('invalid');
    expect(verifyLink(parts, ['1', '2'] as unknown, 'abc')).toBe('invalid');
  });

  it('refuses to sign or verify a link with no purpose', () => {
    // The two link classes are otherwise distinguished only by having disjoint field
    // names — an accident that a third link class would silently undo.
    expect(() => signLink({ key: 'a.jpg', uid: 'u' })).toThrow(/purpose/);
    expect(() => verifyLink({ key: 'a.jpg', uid: 'u' }, '1', 'x')).toThrow(/purpose/);
  });

  it('does not let a manifest link stand in for a download link', () => {
    const manifest = signLink({ key: 'a.jpg', source: 'local', uid: 'u', purpose: 'manifest' })!;
    expect(
      verifyLink(
        { key: 'a.jpg', source: 'local', uid: 'u', purpose: 'download' },
        String(manifest.exp),
        manifest.sig,
      ),
    ).toBe('invalid');
  });

  it('remainingTtl caps a child link so it cannot outlive its parent', () => {
    // Without this, fetching a manifest at T+59m would mint downloads valid to T+119m —
    // twice the advertised window.
    const parentExp = Math.floor(Date.now() / 1000) + 120;
    expect(remainingTtl(parentExp)).toBeLessThanOrEqual(120);
    expect(remainingTtl(parentExp)).toBeGreaterThan(115);
    expect(remainingTtl(Math.floor(Date.now() / 1000) - 60)).toBe(0);
  });

  it('defaults to an hour, long enough for a gigabyte-scale pull', () => {
    const before = Math.floor(Date.now() / 1000);
    const signed = signLink({ key: 'a.jpg', source: 'local', uid: 'u', purpose: 'download' })!;
    expect(signed.exp - before).toBeGreaterThanOrEqual(LINK_TTL_SECONDS - 2);
    expect(signed.exp - before).toBeLessThanOrEqual(LINK_TTL_SECONDS);
  });
});
