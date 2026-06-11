/**
 * SSR auth-cookie forwarding for Server Components.
 *
 * Server Components run with no ambient credentials, so a plain
 * `fetch('${BASE_URL}/api/...')` to an internal route that now enforces RBAC
 * would arrive unauthenticated and get a 401. When the SSR fetch is acting on
 * behalf of the page's viewer, forward the viewer's auth cookie so the route
 * sees their identity and applies the correct permission check.
 *
 * Usage:
 *   const res = await fetch(url, { cache: 'no-store', headers: await authCookieHeader() });
 *
 * Returns {} when there is no token — the downstream fetch then gets a 401 and
 * the page falls back to its empty/null default, which is the correct outcome
 * for an unauthenticated request.
 */
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME } from './middleware';

export async function authCookieHeader(): Promise<Record<string, string>> {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  return token ? { Cookie: `${AUTH_COOKIE_NAME}=${token}` } : {};
}
