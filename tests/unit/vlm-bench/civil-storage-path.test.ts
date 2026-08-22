// tests/unit/vlm-bench/civil-storage-path.test.ts
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveStoragePath } from '../../../scripts/vlm-bench/harvest/civilSource';

// STORAGE_ROOT defaults to /home/velo/storage/qa-photos when QA_PHOTO_STORAGE is
// unset. These tests pin the default so they do not depend on the environment.
const ROOT = path.resolve(process.env.QA_PHOTO_STORAGE || '/home/velo/storage/qa-photos');

describe('resolveStoragePath', () => {
  it('resolves an ordinary key to a path under the storage root', () => {
    const got = resolveStoragePath('thembisa-pop-1/TEM.P.C550/photo.jpeg');
    expect(got).toBe(path.join(ROOT, 'thembisa-pop-1/TEM.P.C550/photo.jpeg'));
  });

  it('keeps a key containing spaces (real storage keys have them)', () => {
    const got = resolveStoragePath('site/WhatsApp Image 2026-04-22 at 4.43.53 PM.jpeg');
    expect(got).toBe(path.join(ROOT, 'site/WhatsApp Image 2026-04-22 at 4.43.53 PM.jpeg'));
  });

  it('rejects a traversal that climbs out of the root', () => {
    expect(resolveStoragePath('../../../etc/passwd')).toBeNull();
  });

  it('rejects a traversal buried mid-key', () => {
    expect(resolveStoragePath('site/ok/../../../../etc/shadow')).toBeNull();
  });

  it('rejects an absolute path that escapes the root', () => {
    expect(resolveStoragePath('/etc/passwd')).toBeNull();
  });

  it('rejects a null byte', () => {
    expect(resolveStoragePath('site/photo.jpg\0.png')).toBeNull();
  });

  it('allows a traversal that stays inside the root', () => {
    const got = resolveStoragePath('site/sub/../photo.jpg');
    expect(got).toBe(path.join(ROOT, 'site/photo.jpg'));
  });

  it('rejects a sibling directory that merely shares the root prefix', () => {
    // /home/velo/storage/qa-photos-backup must NOT pass a naive startsWith check
    expect(resolveStoragePath('../qa-photos-backup/secret.jpg')).toBeNull();
  });

  // Documents current behaviour rather than asserting a security property: an
  // empty key is not an escape, so it is returned. The read then fails EISDIR
  // in seal.ts and the case is dropped. Pinned so a future "tighten the guard"
  // change has to decide about this case deliberately.
  it('returns the root itself for an empty key (caller fails EISDIR on read)', () => {
    expect(resolveStoragePath('')).toBe(ROOT);
  });
});
