/**
 * Shared 1Map API client for standalone sync scripts (env-only credentials).
 *
 * Auth flow mirrors src/modules/system/services/oneMapApiService.ts:
 *   GET /login (csrf) → POST /login → GET /app?layer=5121 (init layer) → API calls.
 *
 * Credentials come from the environment ONLY — no hardcoded fallback (issue #2029):
 *   ONEMAP_EMAIL    (defaults to the service account email; email is not a secret)
 *   ONEMAP_PASSWORD (required — throws if unset)
 *
 * Load env before importing (scripts do `dotenv.config({ path: '.env.local' })`).
 */

export const BASE_URL = 'https://www.1map.co.za';
export const LAYER_ID = '5121'; // Home Installation - Aerial

// Read env LAZILY (at call time), not at module load — importing scripts call
// dotenv.config() after the import statements are hoisted, so reading at load
// time would capture undefined.
const getEmail = () => process.env.ONEMAP_EMAIL || 'hein@velocityfibre.co.za';
function requirePassword() {
  const pw = process.env.ONEMAP_PASSWORD;
  if (!pw) {
    throw new Error('ONEMAP_PASSWORD not set — refusing to run (see .claude/credentials.local.md)');
  }
  return pw;
}

/** Authenticate and return the cookie header string for subsequent calls. */
export async function authenticate() {
  const password = requirePassword();

  const loginPage = await fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(30000) });
  const html = await loginPage.text();
  const csrfMatch = html.match(/name="_csrf".*?value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  const pageCookies = loginPage.headers.get('set-cookie') || '';
  const sid = pageCookies.match(/connect\.sid=([^;]+)/);
  const csrfCookie = pageCookies.match(/csrfToken=([^;]+)/);
  const cookies = [];
  if (sid) cookies.push('connect.sid=' + sid[1]);
  if (csrfCookie) cookies.push('csrfToken=' + csrfCookie[1]);

  const loginRes = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies.join('; ') },
    body: new URLSearchParams({ _csrf: csrf, email: getEmail(), password }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });

  const setCookie = loginRes.headers.get('set-cookie') || '';
  const newSid = setCookie.match(/connect\.sid=([^;]+)/);
  const newCsrf = setCookie.match(/csrfToken=([^;]+)/);
  const authCookies = [];
  if (newSid) authCookies.push('connect.sid=' + newSid[1]);
  if (newCsrf) authCookies.push('csrfToken=' + newCsrf[1]);

  // CRITICAL: initialise layer access before getattributes works.
  await fetch(`${BASE_URL}/app?layer=${LAYER_ID}`, {
    headers: { Cookie: authCookies.join('; ') },
    signal: AbortSignal.timeout(30000),
  });

  return authCookies.join('; ');
}

/** One page of getattributes for a free-text query (site prefix or DR). */
export async function fetchPage(cookieStr, query, page = 1, limit = 500) {
  const formData = new URLSearchParams({
    ungeocoded: 'false', left: '0', bottom: '0', right: '0', top: '0',
    selfilter: '', action: 'get', email: getEmail(), layerid: LAYER_ID,
    sort: 'prop_id', templateExpression: '', q: query,
    page: String(page), start: String((page - 1) * limit), limit: String(limit),
  });

  const res = await fetch(`${BASE_URL}/api/apps/app/getattributes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: cookieStr },
    body: formData.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(60000),
  });
  return res.json();
}

/** Fetch every record for a site prefix, paginating until total_pages, with a throttle. */
export async function fetchAllRecords(cookieStr, query, onProgress) {
  const all = [];
  let page = 1;
  while (true) {
    const data = await fetchPage(cookieStr, query, page, 500);
    if (!data.result || data.result.length === 0) break;
    all.push(...data.result);
    if (typeof onProgress === 'function' && (page % 5 === 0 || page >= data.total_pages)) {
      onProgress(query, page, data.total_pages, all.length);
    }
    if (page >= data.total_pages) break;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }
  return all;
}

/** Exact-DR search (mirrors oneMapApiService.searchDR): returns records where drp === drNumber. */
export async function searchDR(cookieStr, drNumber) {
  const data = await fetchPage(cookieStr, drNumber, 1, 50);
  if (!data || !data.success) return [];
  return (data.result || []).filter((r) => r.drp === drNumber);
}
