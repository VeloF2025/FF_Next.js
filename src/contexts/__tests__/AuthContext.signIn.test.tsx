/**
 * Regression test for the sign-in error path (#2175).
 *
 * On 2026-07-15 `/api/auth/login` failed at module load (a missing `cookie`
 * dependency), so Next served an HTML error page. signInWithEmail called
 * res.json() on it and rethrew the parser error, which PremiumLoginPage
 * rendered verbatim: `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * These tests drive signInWithEmail against that exact response.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// vitest.setup.ts mocks @/contexts/AuthContext globally so other suites can
// render components that call useAuth. This suite tests the real thing, so it
// must opt out — otherwise it asserts against the stub and proves nothing.
vi.mock('@/contexts/AuthContext', async () => await vi.importActual('@/contexts/AuthContext'));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';

/** The body Next.js serves when an API route crashes at module load. */
const NEXT_HTML_ERROR_PAGE =
  '<!DOCTYPE html><html lang="en"><head><title>500</title></head><body>Internal Server Error</body></html>';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

/** Stub /api/auth/me (called on mount) so only the login response varies. */
function mockFetch(loginResponse: Response) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(new Response(null, { status: 401 }));
    }
    return Promise.resolve(loginResponse);
  });
}

async function renderAuth() {
  const hook = renderHook(() => useAuth(), { wrapper });
  // Let the on-mount checkAuth settle so it can't race the assertions.
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('signInWithEmail error handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch(new Response(null, { status: 401 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('surfaces a readable message — not the JSON parser error — when the API returns an HTML 500', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        new Response(NEXT_HTML_ERROR_PAGE, {
          status: 500,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      )
    );

    const { result } = await renderAuth();

    let thrown: unknown;
    await act(async () => {
      await result.current.signInWithEmail('llewelyn@example.com', 'pw').catch((e) => {
        thrown = e;
      });
    });

    // This is what PremiumLoginPage puts on screen (err.message).
    const message = (thrown as Error).message;
    expect(message).toBe('The server is temporarily unavailable. Please try again in a moment.');
    expect(message).not.toMatch(/Unexpected token|DOCTYPE|valid JSON/);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('still surfaces the API error message on a normal JSON 401', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        new Response(
          JSON.stringify({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        )
      )
    );

    const { result } = await renderAuth();

    let thrown: unknown;
    await act(async () => {
      await result.current.signInWithEmail('llewelyn@example.com', 'wrong').catch((e) => {
        thrown = e;
      });
    });

    expect((thrown as Error).message).toBe('Invalid email or password');
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('authenticates on a successful JSON login', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              user: {
                id: 'u1',
                email: 'llewelyn@example.com',
                firstName: 'Llewelyn',
                lastName: 'Hofmeyr',
                role: 'admin',
                permissions: [],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    );

    const { result } = await renderAuth();

    await act(async () => {
      await result.current.signInWithEmail('llewelyn@example.com', 'pw');
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.displayName).toBe('Llewelyn Hofmeyr');
  });
});
