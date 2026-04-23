/**
 * Tests for the demo-mode fetch interceptor's sanitisation logic.
 *
 * Regression focus: the interceptor must NOT rewrite storage keys, filenames,
 * or other opaque identifiers. The original bug caused `/api/construction-qa/photo-proxy`
 * to 404 because `storage_key` values like "tonga/VTN_TOG.../photo.jpg" were
 * being rewritten to "Project 11/VTN_TOG.../photo.jpg".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeText, installDemoFetchInterceptor } from '../../src/lib/demoMode';

// sanitizeTree is not exported; we exercise it indirectly via the fetch interceptor.
// For direct coverage of the tree-walk rules we reach into the module under test
// by re-importing and pulling the function through a small shim. To keep the
// surface narrow we only test the two public behaviours we rely on:
//   1) sanitizeText returns input unchanged when demo mode is off (cookie absent)
//   2) the exported fetch interceptor preserves preserved-key values in JSON bodies
//
// For (2), we install the interceptor against a stubbed window.fetch that returns
// a synthetic JSON response, set the cookie + cached map, and assert the response
// body is not corrupted.

const PROJECT_MAP = {
  nameMap: { Tonga: 'Project 11', Etwatwa: 'Project 1' },
  codeMap: {},
  idMap: {},
};

function setDemoCookieAndMap() {
  // jsdom provides document.cookie
  document.cookie = 'ff_demo_mode=1; path=/; max-age=3600';
  // Prime the localStorage cache so the interceptor doesn't need to fetch the map
  window.localStorage.setItem('ff_demo_mode_map_v1', JSON.stringify(PROJECT_MAP));
}

function clearDemoCookie() {
  document.cookie = 'ff_demo_mode=; path=/; max-age=0';
  window.localStorage.removeItem('ff_demo_mode_map_v1');
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('demoMode sanitisation', () => {
  beforeEach(() => {
    clearDemoCookie();
  });

  describe('sanitizeText', () => {
    it('returns input unchanged when demo mode is off', () => {
      expect(sanitizeText('Hello from Tonga')).toBe('Hello from Tonga');
    });
  });

  describe('fetch interceptor', () => {
    it('preserves storage_key, filename, and other path-like identifiers', async () => {
      setDemoCookieAndMap();

      const payload = {
        success: true,
        data: {
          review: { project_name: 'Tonga', feature_id: 'VTN_TOG_Z0A-P0372' },
          photos: [
            {
              id: 'p1',
              storage_key: 'tonga/VTN_TOG_Z0A-P0372/civil-audit_20260312024320549.jpg',
              filename: 'civil-audit_20260312024320549.jpg',
              source: 'local',
            },
            {
              id: 'p2',
              storage_key: 'tonga/VTN_TOG_Z0A-P0372/v20260317105457-4b4637b6',
              filename: 'v20260317105457-4b4637b6',
              source: 'local',
            },
          ],
        },
      };

      // Stub window.fetch to return our payload for the target URL
      window.fetch = async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/api/demo/project-map')) {
          return jsonResponse({ success: true, data: PROJECT_MAP });
        }
        return jsonResponse(payload);
      };

      // Install the interceptor (it wraps window.fetch once)
      installDemoFetchInterceptor();

      // Give the async map loader a tick to resolve
      await new Promise((r) => setTimeout(r, 0));

      const res = await window.fetch('/api/construction-qa/review?id=xyz');
      const body = await res.json();

      // Display fields SHOULD be sanitised
      expect(body.data.review.project_name).toBe('Project 11');

      // Storage keys and filenames MUST be preserved (the bug we are fixing)
      expect(body.data.photos[0].storage_key).toBe(
        'tonga/VTN_TOG_Z0A-P0372/civil-audit_20260312024320549.jpg',
      );
      expect(body.data.photos[0].filename).toBe('civil-audit_20260312024320549.jpg');
      expect(body.data.photos[1].storage_key).toBe(
        'tonga/VTN_TOG_Z0A-P0372/v20260317105457-4b4637b6',
      );
    });

    it('is a no-op when demo mode is off', async () => {
      // Cookie cleared by beforeEach
      const payload = {
        data: {
          review: { project_name: 'Tonga' },
          photos: [{ storage_key: 'tonga/foo/bar.jpg' }],
        },
      };

      window.fetch = async () => jsonResponse(payload);
      installDemoFetchInterceptor();

      const res = await window.fetch('/api/construction-qa/review?id=xyz');
      const body = await res.json();

      expect(body.data.review.project_name).toBe('Tonga');
      expect(body.data.photos[0].storage_key).toBe('tonga/foo/bar.jpg');
    });
  });
});
