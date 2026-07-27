/**
 * Input normalisation helpers shared by the H&S write endpoints.
 *
 * `isSafeDocumentUrl` is a security control, not a formatting nicety: a stored
 * link is written by anyone with H&S edit permission and clicked by anyone with
 * view permission, so an unchecked scheme is stored XSS against the reader's
 * authenticated session.
 */

import { describe, it, expect } from 'vitest';
import { blankToNull, isSafeDocumentUrl } from '../services/inputNormalize';

describe('blankToNull', () => {
  it('maps every shape of "empty" to null', () => {
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
    expect(blankToNull('')).toBeNull();
    // The one that caused a real 500: whitespace-only reads as empty to a
    // trimming guard but is truthy to `||`.
    expect(blankToNull('   ')).toBeNull();
    expect(blankToNull('\t\n ')).toBeNull();
  });

  it('trims and preserves real values', () => {
    expect(blankToNull('  Isopropyl Alcohol  ')).toBe('Isopropyl Alcohol');
    expect(blankToNull('swp')).toBe('swp');
  });
});

describe('isSafeDocumentUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeDocumentUrl('https://app.fibreflow.app/storage/sds.pdf')).toBe(true);
    expect(isSafeDocumentUrl('http://example.com/a.pdf')).toBe(true);
    expect(isSafeDocumentUrl('  https://example.com/a.pdf  ')).toBe(true);
  });

  it('accepts a same-origin path', () => {
    expect(isSafeDocumentUrl('/storage/sds/ipa.pdf')).toBe(true);
  });

  it('rejects script-bearing and data schemes', () => {
    expect(isSafeDocumentUrl('javascript:alert(document.cookie)')).toBe(false);
    expect(isSafeDocumentUrl('  JavaScript:alert(1)')).toBe(false);
    expect(isSafeDocumentUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeDocumentUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeDocumentUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects protocol-relative links, whose scheme the embedding page decides', () => {
    expect(isSafeDocumentUrl('//evil.example.com/a.pdf')).toBe(false);
  });

  it('rejects empty and unparseable values', () => {
    expect(isSafeDocumentUrl('')).toBe(false);
    expect(isSafeDocumentUrl('   ')).toBe(false);
    expect(isSafeDocumentUrl('not a url at all')).toBe(false);
  });
});
