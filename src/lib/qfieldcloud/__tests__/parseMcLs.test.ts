import { describe, it, expect } from 'vitest';
import { parseDcimKeys } from '../parseMcLs';

describe('parseDcimKeys', () => {
  it('parses a normal 5-column line (with STANDARD storage class)', () => {
    const line = '[2026-07-08 10:39:41 UTC] 4.2MiB STANDARD optical-audit_20260708.jpg/v20260708123941-a8b6a554';
    const { keys, skipped } = parseDcimKeys(line);
    expect(keys).toEqual(new Set(['DCIM/optical-audit_20260708.jpg']));
    expect(skipped).toBe(0);
  });

  it('parses a 4-column line with no STANDARD storage-class field, same result', () => {
    const line = '[2026-07-08 10:39:41 UTC] 4.2MiB optical-audit_20260708.jpg/v20260708123941-a8b6a554';
    const { keys, skipped } = parseDcimKeys(line);
    expect(keys).toEqual(new Set(['DCIM/optical-audit_20260708.jpg']));
    expect(skipped).toBe(0);
  });

  it('preserves embedded spaces in the filename for a 5-column line', () => {
    const line = '[2026-04-22 09:02:15 UTC] 152KiB STANDARD JPEG_20260422084832831.28.16 (1).jpeg/v20260422090215-1ab08aa5';
    const { keys, skipped } = parseDcimKeys(line);
    expect(keys).toEqual(new Set(['DCIM/JPEG_20260422084832831.28.16 (1).jpeg']));
    expect(skipped).toBe(0);
  });

  it('preserves embedded spaces in the filename for a 4-column line (no storage class) — the case that broke the old try-5-then-4 ordering', () => {
    const line = '[2026-04-22 09:02:15 UTC] 152KiB JPEG_20260422084832831.28.16 (1).jpeg/v20260422090215-1ab08aa5';
    const { keys, skipped } = parseDcimKeys(line);
    // The old order-dependent parser would have spuriously matched the 5-column
    // hypothesis here (slice(5) drops "JPEG_...28.16" and still ends in a valid
    // version suffix), silently truncating the key to "DCIM/(1).jpeg". The
    // deterministic storage-class check must not make that mistake.
    expect(keys).toEqual(new Set(['DCIM/JPEG_20260422084832831.28.16 (1).jpeg']));
    expect(keys.has('DCIM/(1).jpeg')).toBe(false);
    expect(skipped).toBe(0);
  });

  it('skips a non-version / garbage line without admitting it as a key', () => {
    const lines = [
      '[2026-07-08 10:39:41 UTC] 4.2MiB STANDARD optical-audit_20260708.jpg/v20260708123941-a8b6a554',
      'mc: <ERROR> Unable to list folder. The specified bucket does not exist',
    ].join('\n');
    const { keys, skipped } = parseDcimKeys(lines);
    expect(keys).toEqual(new Set(['DCIM/optical-audit_20260708.jpg']));
    expect(skipped).toBe(1);
  });

  it('recognizes REDUCED_REDUNDANCY as a storage-class column too', () => {
    const line = '[2026-07-08 10:39:41 UTC] 4.2MiB REDUCED_REDUNDANCY optical-audit_20260708.jpg/v20260708123941-a8b6a554';
    const { keys, skipped } = parseDcimKeys(line);
    expect(keys).toEqual(new Set(['DCIM/optical-audit_20260708.jpg']));
    expect(skipped).toBe(0);
  });

  it('dedupes multiple versions of the same logical file into one key', () => {
    const lines = [
      '[2026-05-07 16:00:08 UTC] 1008KiB STANDARD civil-audit_20260507155938595.jpg/v20260507143424-f305ed27',
      '[2026-06-03 14:47:59 UTC] 1008KiB STANDARD civil-audit_20260507155938595.jpg/v20260603144759-38ab1f56',
    ].join('\n');
    const { keys, skipped } = parseDcimKeys(lines);
    expect(keys).toEqual(new Set(['DCIM/civil-audit_20260507155938595.jpg']));
    expect(skipped).toBe(0);
  });

  it('returns an empty set and 0 skipped for empty input (project with zero DCIM objects)', () => {
    const { keys, skipped } = parseDcimKeys('');
    expect(keys.size).toBe(0);
    expect(skipped).toBe(0);
  });
});
