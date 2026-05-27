/**
 * detectPlatform tests — UA-based browser classification for the
 * geolocation help banner.
 *
 * Driving incident: Samsung Internet (UA contains both
 * `SamsungBrowser/29.0` and `Chrome/136`) was being matched by the
 * Chrome branch and shown Chrome's settings path. Field staff hit a
 * dead end because Samsung Internet's per-site permissions menu is
 * structured differently. These tests pin the precedence of the
 * Samsung match so a future "simplify the regex" change can't quietly
 * regress it.
 */

import { describe, it, expect } from 'vitest';
import { detectPlatform, classifyDenialFollowup } from '../gpsPlatform';

describe('detectPlatform', () => {
  it('classifies Samsung Internet on Android as android-samsung, not android-chrome', () => {
    // Real UA from the 2026-04-28 Jaun De Wit screenshot.
    const ua =
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/136.0.0.0 Mobile Safari/537.36';
    expect(detectPlatform(ua, 0)).toBe('android-samsung');
  });

  it('classifies Android Chrome (no SamsungBrowser token) as android-chrome', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36';
    expect(detectPlatform(ua, 0)).toBe('android-chrome');
  });

  it('classifies iPhone Safari as ios-safari', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(detectPlatform(ua, 5)).toBe('ios-safari');
  });

  it('classifies iPad-as-desktop (Macintosh UA + multitouch) as ios-safari', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(detectPlatform(ua, 5)).toBe('ios-safari');
  });

  it('classifies Chrome iOS (CriOS) as ios-other', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/136.0 Mobile/15E148 Safari/604.1';
    expect(detectPlatform(ua, 5)).toBe('ios-other');
  });

  it('classifies desktop Chrome on Linux as desktop-chrome', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
    expect(detectPlatform(ua, 0)).toBe('desktop-chrome');
  });

  it('classifies desktop Safari on macOS as desktop-safari', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    // No multitouch — pure desktop Safari.
    expect(detectPlatform(ua, 0)).toBe('desktop-safari');
  });

  it('classifies desktop Firefox as desktop-firefox', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0';
    expect(detectPlatform(ua, 0)).toBe('desktop-firefox');
  });

  it('returns unknown for empty UA', () => {
    expect(detectPlatform('', 0)).toBe('unknown');
  });
});

describe('classifyDenialFollowup', () => {
  // After getCurrentPosition fires PERMISSION_DENIED, the live
  // Permissions API state drives one of three responses:
  //   show-help  → cannot recover in-app, surface the settings recipe
  //   retry      → 'granted': transient race, retry capture
  //   soft-error → 'prompt': user dismissed the native prompt
  // 'unsupported' is grouped with 'denied' because we cannot verify
  // whether the deny is transient — guessing wrong strands users with
  // no actionable recovery.

  it('shows help when state is denied (persistent block)', () => {
    expect(classifyDenialFollowup('denied')).toBe('show-help');
  });

  it('shows help when state is unsupported (no Permissions API — cannot verify)', () => {
    expect(classifyDenialFollowup('unsupported')).toBe('show-help');
  });

  it('returns retry when state is granted (transient race — silent retry)', () => {
    // 'granted' contradicts the PERMISSION_DENIED we just got. Telling
    // the user "permission was dismissed" would be wrong; the right
    // reaction is to retry capture inline.
    expect(classifyDenialFollowup('granted')).toBe('retry');
  });

  it('returns soft-error when state is prompt (user dismissed — needs new tap)', () => {
    // The browser will prompt again on the next call, but iOS Safari
    // requires a user gesture to display it. Surface a soft error so
    // the user's next tap on "Get location" provides that gesture.
    expect(classifyDenialFollowup('prompt')).toBe('soft-error');
  });
});
