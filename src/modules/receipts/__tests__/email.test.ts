/**
 * Pure helpers from src/modules/receipts/email.ts.
 *
 * The receipt notification path is plumbing-heavy (DB lookups, VF Storage
 * fetch, nodemailer transport) but the security-critical bits are pure
 * string transforms — header sanitisation, MIME whitelisting, HTML
 * escaping, and currency formatting. Lock those in here so a regression
 * surfaces in CI rather than as a surprise email at month-end.
 */

import { describe, it, expect } from 'vitest';

import {
  escapeHtml,
  fileExtensionFromMime,
  rands,
  safeAttachmentMime,
  sanitizeHeaderValue,
} from '../email';

describe('rands', () => {
  it('formats positive cents as ZAR with two decimals', () => {
    expect(rands(12345)).toBe('ZAR 123.45');
  });

  it('accepts cents as string (postgres bigint comes back as text)', () => {
    expect(rands('5000')).toBe('ZAR 50.00');
  });

  it('honours an explicit currency code', () => {
    expect(rands(100, 'USD')).toBe('USD 1.00');
  });

  it('returns empty string for null and undefined', () => {
    expect(rands(null)).toBe('');
    expect(rands(undefined)).toBe('');
  });

  it('returns empty string when value cannot be parsed', () => {
    expect(rands('abc')).toBe('');
  });

  it('handles zero cents', () => {
    expect(rands(0)).toBe('ZAR 0.00');
  });
});

describe('escapeHtml', () => {
  it('escapes <, >, &, single and double quotes', () => {
    expect(escapeHtml('<a href="x">&\'Y\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;Y&#39;&lt;/a&gt;');
  });

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('Acme Stores 2026')).toBe('Acme Stores 2026');
  });

  it('does not double-escape an existing entity', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('fileExtensionFromMime', () => {
  it('returns jpg for null / unknown', () => {
    expect(fileExtensionFromMime(null)).toBe('jpg');
    expect(fileExtensionFromMime(undefined)).toBe('jpg');
    expect(fileExtensionFromMime('application/x-binary')).toBe('jpg');
  });

  it.each([
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/heic', 'heic'],
    ['application/pdf', 'pdf'],
  ])('maps %s -> %s', (mime, ext) => {
    expect(fileExtensionFromMime(mime)).toBe(ext);
  });
});

describe('safeAttachmentMime', () => {
  it('returns octet-stream for null / undefined / empty', () => {
    expect(safeAttachmentMime(null)).toBe('application/octet-stream');
    expect(safeAttachmentMime(undefined)).toBe('application/octet-stream');
    expect(safeAttachmentMime('')).toBe('application/octet-stream');
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])(
    'allows %s through',
    (mime) => {
      expect(safeAttachmentMime(mime)).toBe(mime);
    }
  );

  it('strips parameters before matching the whitelist', () => {
    expect(safeAttachmentMime('image/jpeg; charset=utf-8')).toBe('image/jpeg');
  });

  it('lowercases before matching', () => {
    expect(safeAttachmentMime('IMAGE/PNG')).toBe('image/png');
  });

  it('falls back for unknown types', () => {
    expect(safeAttachmentMime('text/html')).toBe('application/octet-stream');
    expect(safeAttachmentMime('application/javascript')).toBe('application/octet-stream');
  });

  it('falls back for malformed multipart-style values', () => {
    // A vendor MIME containing a name= rider is the kind of thing nodemailer
    // would otherwise pass straight to the MUA.
    expect(safeAttachmentMime('image/jpeg; name=evil.html')).toBe('image/jpeg');
    expect(safeAttachmentMime('text/html; name=evil.html')).toBe('application/octet-stream');
  });
});

describe('sanitizeHeaderValue', () => {
  it('passes plain text through (trimmed)', () => {
    expect(sanitizeHeaderValue('Receipt to approve')).toBe('Receipt to approve');
    expect(sanitizeHeaderValue('  hi  ')).toBe('hi');
  });

  it('strips a CRLF injection attempt', () => {
    const malicious = 'Acme Ltd\r\nBcc: attacker@example.com';
    expect(sanitizeHeaderValue(malicious)).toBe('Acme Ltd Bcc: attacker@example.com');
  });

  it('strips a bare CR', () => {
    expect(sanitizeHeaderValue('foo\rbar')).toBe('foo bar');
  });

  it('strips a bare LF', () => {
    expect(sanitizeHeaderValue('foo\nbar')).toBe('foo bar');
  });

  it('strips NUL bytes', () => {
    expect(sanitizeHeaderValue('foo\0bar')).toBe('foo bar');
  });

  it('collapses runs of newline-class characters into a single space', () => {
    expect(sanitizeHeaderValue('foo\r\n\r\nbar')).toBe('foo bar');
  });
});
