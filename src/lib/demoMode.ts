/**
 * Demo Mode - Client-Side Sanitization
 *
 * Presentation helper that replaces real project names / codes with generic
 * placeholders ("Project 1", "P01") in API responses rendered to the user.
 *
 * Activated via `?demo=1` query param (sets the `ff_demo_mode` cookie).
 * Deactivated via `?demo=0` (clears the cookie).
 *
 * The fetch interceptor below runs alongside the existing auth interceptor —
 * it only touches JSON response bodies and only when the cookie is present.
 */

import { log } from '@/lib/logger';

const COOKIE_NAME = 'ff_demo_mode';
const MAP_STORAGE_KEY = 'ff_demo_mode_map_v1';

export interface DemoProjectMap {
  nameMap: Record<string, string>;
  codeMap: Record<string, string>;
  idMap: Record<string, { name: string; code: string }>;
}

// -----------------------------------------------------------------------------
// Cookie helpers
// -----------------------------------------------------------------------------

export function isDemoModeEnabled(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE_NAME}=1`));
}

function setCookie(value: '1' | '') {
  if (typeof document === 'undefined') return;
  const maxAge = value === '1' ? 60 * 60 * 8 : 0; // 8h or clear
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

// -----------------------------------------------------------------------------
// Sanitization
// -----------------------------------------------------------------------------

interface CompiledMap {
  replacements: Array<{ pattern: RegExp; replacement: string }>;
}

function compileMap(map: DemoProjectMap | null): CompiledMap {
  if (!map) return { replacements: [] };

  const entries: Array<[string, string]> = [
    ...Object.entries(map.nameMap),
    ...Object.entries(map.codeMap),
  ]
    .filter(([real]) => real && real.length >= 2)
    .sort((a, b) => b[0].length - a[0].length); // longest first

  const replacements = entries.map(([real, fake]) => ({
    pattern: new RegExp(`\\b${escapeRegex(real)}\\b`, 'gi'),
    replacement: fake,
  }));

  return { replacements };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shouldSkipString(s: string): boolean {
  if (s.length === 0 || s.length > 10_000) return true;
  if (s.startsWith('http://') || s.startsWith('https://')) return true;
  if (s.startsWith('/api/') || s.startsWith('/storage/') || s.startsWith('/static/')) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)) return true; // UUID-ish
  return false;
}

function sanitizeString(s: string, compiled: CompiledMap): string {
  if (shouldSkipString(s)) return s;
  let result = s;
  for (const { pattern, replacement } of compiled.replacements) {
    if (result.indexOf(replacement) !== -1 && !pattern.test(s)) continue;
    result = result.replace(pattern, replacement);
  }
  return result;
}

function sanitizeTree(value: unknown, compiled: CompiledMap, depth = 0): unknown {
  if (depth > 20) return value;
  if (value == null) return value;

  if (typeof value === 'string') {
    return sanitizeString(value, compiled);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTree(item, compiled, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeTree(v, compiled, depth + 1);
    }
    return out;
  }

  return value;
}

// -----------------------------------------------------------------------------
// Map loader
// -----------------------------------------------------------------------------

let cachedCompiled: CompiledMap | null = null;
let cachedRawMap: DemoProjectMap | null = null;
let mapLoadPromise: Promise<void> | null = null;

function readMapFromStorage(): DemoProjectMap | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MAP_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DemoProjectMap) : null;
  } catch {
    return null;
  }
}

function writeMapToStorage(map: DemoProjectMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage full / denied — non-fatal
  }
}

async function loadProjectMap(originalFetch: typeof fetch): Promise<void> {
  if (mapLoadPromise) return mapLoadPromise;

  mapLoadPromise = (async () => {
    try {
      const res = await originalFetch('/api/demo/project-map', { credentials: 'include' });
      if (!res.ok) {
        log.warn('Demo map fetch failed', { status: res.status }, 'demoMode');
        return;
      }
      const body = await res.json();
      const map: DemoProjectMap | undefined = body?.data;
      if (!map) return;
      cachedRawMap = map;
      cachedCompiled = compileMap(map);
      writeMapToStorage(map);
    } catch (err) {
      log.warn('Demo map load error', { err: String(err) }, 'demoMode');
    }
  })();

  return mapLoadPromise;
}

function ensureMapFromStorage() {
  if (cachedCompiled) return;
  const stored = readMapFromStorage();
  if (stored) {
    cachedRawMap = stored;
    cachedCompiled = compileMap(stored);
  }
}

export function getCachedMap(): DemoProjectMap | null {
  ensureMapFromStorage();
  return cachedRawMap;
}

// -----------------------------------------------------------------------------
// Query-param toggle
// -----------------------------------------------------------------------------

export function applyQueryParamToggle(): 'enabled' | 'disabled' | 'unchanged' {
  if (typeof window === 'undefined') return 'unchanged';
  const url = new URL(window.location.href);
  const param = url.searchParams.get('demo');
  if (param === null) return 'unchanged';

  if (param === '1' || param === 'true' || param === 'on') {
    setCookie('1');
    url.searchParams.delete('demo');
    window.history.replaceState({}, '', url.toString());
    return 'enabled';
  }

  if (param === '0' || param === 'false' || param === 'off') {
    setCookie('');
    clearCache();
    url.searchParams.delete('demo');
    window.history.replaceState({}, '', url.toString());
    return 'disabled';
  }

  return 'unchanged';
}

function clearCache() {
  cachedCompiled = null;
  cachedRawMap = null;
  mapLoadPromise = null;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(MAP_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

// -----------------------------------------------------------------------------
// Fetch interceptor
// -----------------------------------------------------------------------------

let interceptorInstalled = false;

export function installDemoFetchInterceptor() {
  if (typeof window === 'undefined' || interceptorInstalled) return;
  interceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);

  // Prime the map if the cookie is already set on page load
  if (isDemoModeEnabled()) {
    ensureMapFromStorage();
    void loadProjectMap(originalFetch);
  }

  window.fetch = async function (...args) {
    const response = await originalFetch(...args);

    if (!isDemoModeEnabled()) return response;

    const url = typeof args[0] === 'string'
      ? args[0]
      : args[0] instanceof Request
        ? args[0].url
        : args[0] instanceof URL
          ? args[0].toString()
          : '';

    // Skip the map endpoint itself and any non-API call
    if (url.includes('/api/demo/project-map')) return response;
    if (!url.includes('/api/')) return response;

    // Trigger a one-time background load if we don't have the map yet
    if (!cachedCompiled) {
      ensureMapFromStorage();
      void loadProjectMap(originalFetch);
      if (!cachedCompiled) return response;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return response;
    if (!response.ok && response.status !== 200 && response.status !== 201) return response;

    try {
      const text = await response.clone().text();
      if (!text) return response;
      const body = JSON.parse(text);
      const sanitized = sanitizeTree(body, cachedCompiled);
      const newBody = JSON.stringify(sanitized);

      return new Response(newBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (err) {
      // If anything goes wrong, return the untouched response — never break the app
      log.debug('Demo sanitize skipped', { url, err: String(err) }, 'demoMode');
      return response;
    }
  };
}

// -----------------------------------------------------------------------------
// Public helpers
// -----------------------------------------------------------------------------

/** Sanitize a free-form string (useful for SSR'd breadcrumbs, titles, etc.) */
export function sanitizeText(s: string): string {
  if (!isDemoModeEnabled()) return s;
  ensureMapFromStorage();
  if (!cachedCompiled) return s;
  return sanitizeString(s, cachedCompiled);
}
