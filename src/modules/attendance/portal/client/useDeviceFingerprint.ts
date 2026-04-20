/**
 * Stable per-device fingerprint for the /my portal.
 *
 * Not a cryptographic identity — just a stable random token persisted in
 * localStorage so repeat logins from the same browser can be grouped in the
 * `attendance_auth_sessions` audit log. Treated purely as metadata; the
 * backend never uses it as an authentication factor.
 *
 * Written lazily on first call. SSR-safe: returns null during render before
 * hydration; components should treat null as "not yet known" and avoid
 * submitting without it if they want the field populated.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ff.my.device_fingerprint.v1';

function readOrMint(): string {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  let fp = '';
  try {
    fp = window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    // localStorage disabled (private mode, quota, etc.) — fall through to a
    // session-only fingerprint so the endpoint still gets *something*.
  }
  if (fp) return fp;

  // 128 random bits encoded as hex (32 chars). `crypto.randomUUID` would also
  // work but isn't guaranteed in every embedded WebView.
  const buf = new Uint8Array(16);
  if (typeof window.crypto !== 'undefined' && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  fp = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');

  try {
    window.localStorage.setItem(STORAGE_KEY, fp);
  } catch {
    // Swallow — returning the session-only value is still useful.
  }
  return fp;
}

export function useDeviceFingerprint(): string | null {
  const [fp, setFp] = useState<string | null>(null);
  useEffect(() => {
    setFp(readOrMint() || null);
  }, []);
  return fp;
}
