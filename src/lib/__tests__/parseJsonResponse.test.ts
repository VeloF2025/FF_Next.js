/**
 * Regression tests for parseJsonResponse (#2175).
 *
 * On 2026-07-15 `/api/auth/login` failed at module load, so Next served an
 * HTML error page. The sign-in UI called res.json() on it and showed the user
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 */

import { describe, it, expect } from 'vitest';
import { ApiResponseError, parseJsonResponse } from '@/lib/handleApiResponse';

/** Build a Response with an explicit content-type, as fetch would return. */
function makeResponse(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
}

/** The literal body Next.js serves when an API route fails to load. */
const NEXT_HTML_ERROR_PAGE =
  '<!DOCTYPE html><html lang="en"><head><title>500</title></head><body>Internal Server Error</body></html>';

describe('parseJsonResponse', () => {
  it('parses a JSON body and returns it', async () => {
    const res = makeResponse(
      JSON.stringify({ success: true, data: { user: { id: 'u1' } } }),
      'application/json; charset=utf-8'
    );

    await expect(parseJsonResponse(res)).resolves.toEqual({
      success: true,
      data: { user: { id: 'u1' } },
    });
  });

  it('parses a JSON error body, so the handler message still reaches the caller', async () => {
    const res = makeResponse(
      JSON.stringify({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }),
      'application/json; charset=utf-8',
      401
    );

    const data = await parseJsonResponse<{ error: { message: string } }>(res);
    expect(data.error.message).toBe('Invalid email or password');
  });

  it('throws ApiResponseError — not a JSON parser error — on an HTML 500 page', async () => {
    const res = makeResponse(NEXT_HTML_ERROR_PAGE, 'text/html; charset=utf-8', 500);

    await expect(parseJsonResponse(res)).rejects.toBeInstanceOf(ApiResponseError);
  });

  it('never surfaces the raw parser text to the user', async () => {
    const res = makeResponse(NEXT_HTML_ERROR_PAGE, 'text/html; charset=utf-8', 500);

    // The exact string Llewelyn saw on screen — it must not survive.
    await expect(parseJsonResponse(res)).rejects.toThrow(
      'The server is temporarily unavailable. Please try again in a moment.'
    );
    await expect(parseJsonResponse(res)).rejects.not.toThrow(/Unexpected token|DOCTYPE|valid JSON/);
  });

  it('rejects an HTML body even when the status is 200', async () => {
    const res = makeResponse('<!DOCTYPE html><html></html>', 'text/html; charset=utf-8', 200);

    await expect(parseJsonResponse(res)).rejects.toBeInstanceOf(ApiResponseError);
  });

  it('throws ApiResponseError when content-type claims JSON but the body is malformed', async () => {
    const res = makeResponse('{"truncated":', 'application/json; charset=utf-8');

    await expect(parseJsonResponse(res)).rejects.toThrow(
      'The server sent a response we could not read. Please try again.'
    );
  });

  it('throws ApiResponseError when the content-type header is absent', async () => {
    const res = new Response('nothing useful', { status: 502 });

    await expect(parseJsonResponse(res)).rejects.toBeInstanceOf(ApiResponseError);
  });
});
