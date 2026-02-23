/**
 * handleApiResponse — Frontend API error normaliser
 *
 * Handles both old and new FibreFlow API error shapes during the
 * 6-week migration period (2026-02-23 → 2026-04-06).
 *
 * OLD FORMATS (being deprecated):
 *   { error: "string" }                        — Pattern 1
 *   { success: false, error: "string" }        — Pattern 2
 *   { status: "unhealthy", ... }               — Pattern 3 (health only)
 *
 * NEW FORMAT (target):
 *   { success: false, error: { code, message, details } }
 *   { success: true,  data: T }
 *
 * Usage:
 *   const result = await fetch('/api/projects/stale').then(r => r.json());
 *   const { data, error } = handleApiResponse(result);
 *   if (error) showError(error.message, error.code);
 *   else renderProjects(data);
 *
 * Error-code-aware UI (optional, Phase 5):
 *   if (error?.code === 'AUTH_ERROR')       → redirect to login
 *   if (error?.code === 'NOT_FOUND')        → show empty state
 *   if (error?.code === 'VALIDATION_ERROR') → highlight fields via error.details
 *   if (error?.code === 'RATE_LIMIT')       → show retry timer
 */

/** Error codes from the new standard — matches ErrorCode enum in src/lib/apiResponse.ts */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'AUTH_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'INTERNAL_ERROR'
  | 'DATABASE_ERROR'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR'
  /** Assigned when normalising a legacy error without a code */
  | 'UNKNOWN';

export interface NormalisedError {
  /** Machine-readable code — use for conditional UI logic */
  code: ApiErrorCode;
  /** Human-readable message — safe to show in UI */
  message: string;
  /** Structured details (e.g. field-level validation errors) */
  details?: Record<string, unknown>;
}

export interface HandleApiResponseResult<T = unknown> {
  data: T | null;
  error: NormalisedError | null;
}

/**
 * Normalise any FibreFlow API response (old or new format) into a
 * consistent `{ data, error }` shape for frontend consumption.
 */
export function handleApiResponse<T = unknown>(
  json: unknown
): HandleApiResponseResult<T> {
  // ── Not an object ────────────────────────────────────────────────────────
  if (!json || typeof json !== 'object') {
    return {
      data: null,
      error: { code: 'UNKNOWN', message: 'Unexpected API response format' },
    };
  }

  const body = json as Record<string, unknown>;

  // ── New format: { success: false, error: { code, message, details } } ───
  if (body.success === false && body.error && typeof body.error === 'object') {
    const err = body.error as Record<string, unknown>;
    return {
      data: null,
      error: {
        code: (err.code as ApiErrorCode) ?? 'UNKNOWN',
        message: (err.message as string) ?? 'An error occurred',
        details: err.details as Record<string, unknown> | undefined,
      },
    };
  }

  // ── New format: { success: true, data: T } ───────────────────────────────
  if (body.success === true) {
    return { data: (body.data ?? body) as T, error: null };
  }

  // ── Legacy Pattern 2: { success: false, error: "string" } ───────────────
  if (body.success === false && typeof body.error === 'string') {
    return {
      data: null,
      error: { code: 'UNKNOWN', message: body.error || 'An error occurred' },
    };
  }

  // ── Legacy Pattern 1: { error: "string" } (no success field) ────────────
  if (typeof body.error === 'string') {
    return {
      data: null,
      error: { code: 'UNKNOWN', message: body.error || 'An error occurred' },
    };
  }

  // ── Legacy Pattern 3: { status: "unhealthy" } (health endpoint) ─────────
  if (body.status === 'unhealthy' || body.status === 'degraded') {
    return {
      data: null,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service is currently unhealthy',
        details: body as Record<string, unknown>,
      },
    };
  }

  // ── Apparent success (no success flag, no error field) ───────────────────
  return { data: body as T, error: null };
}

/**
 * Convenience: fetch a URL and normalise the response in one call.
 *
 * Usage:
 *   const { data, error } = await fetchApi<ProjectList>('/api/projects');
 *   const { data, error } = await fetchApi<void>('/api/projects', {
 *     method: 'POST',
 *     body: JSON.stringify(payload),
 *   });
 */
export async function fetchApi<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<HandleApiResponseResult<T>> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      ...init,
    });

    const json = await res.json();
    const result = handleApiResponse<T>(json);

    // If the HTTP status indicates an error but the body looks like success,
    // override — HTTP status is the source of truth for auth errors.
    if (!res.ok && !result.error) {
      return {
        data: null,
        error: {
          code: res.status === 401 ? 'UNAUTHORIZED'
              : res.status === 403 ? 'FORBIDDEN'
              : res.status === 404 ? 'NOT_FOUND'
              : res.status === 429 ? 'RATE_LIMIT'
              : 'SERVER_ERROR',
          message: `Request failed (HTTP ${res.status})`,
        },
      };
    }

    return result;
  } catch (e) {
    return {
      data: null,
      error: {
        code: 'NETWORK_ERROR',
        message: e instanceof Error ? e.message : 'Network error',
      },
    };
  }
}

/**
 * Map an error code to a user-facing message suitable for display.
 * Override specific codes to provide context-appropriate copy.
 */
export function getErrorDisplayMessage(
  error: NormalisedError,
  context?: string
): string {
  switch (error.code) {
    case 'UNAUTHORIZED':
    case 'AUTH_ERROR':
      return 'Your session has expired. Please sign in again.';
    case 'FORBIDDEN':
      return 'You don\'t have permission to do this.';
    case 'NOT_FOUND':
      return context ? `${context} not found.` : 'The requested item was not found.';
    case 'RATE_LIMIT':
      return 'Too many requests — please wait a moment and try again.';
    case 'SERVICE_UNAVAILABLE':
      return 'The service is temporarily unavailable. Please try again shortly.';
    case 'NETWORK_ERROR':
      return 'Unable to reach the server. Check your connection and try again.';
    default:
      return error.message || 'Something went wrong. Please try again.';
  }
}

export default handleApiResponse;
