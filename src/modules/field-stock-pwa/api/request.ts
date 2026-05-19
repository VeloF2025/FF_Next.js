/**
 * Shared fetch primitive for the field-stock PWA client API.
 *
 * Mirrors the pattern in attendance/portal/client/api.ts:
 *  - credentials: 'include'
 *  - JSON Content-Type
 *  - ApiError on non-2xx or non-JSON responses
 */

// =============================================================================
// ApiError
// =============================================================================

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// =============================================================================
// API envelope shape
// =============================================================================

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// =============================================================================
// request() — base fetch wrapper
// =============================================================================

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection.',
      { cause: message }
    );
  }

  let bodyText = '';
  let envelope: ApiEnvelope<T> | null = null;
  try {
    bodyText = await res.text();
    envelope = bodyText ? (JSON.parse(bodyText) as ApiEnvelope<T>) : null;
  } catch {
    throw new ApiError(
      res.status,
      'PARSE_ERROR',
      `Server returned non-JSON (HTTP ${res.status})`,
      { bodySnippet: bodyText.slice(0, 200) }
    );
  }

  if (!envelope) {
    throw new ApiError(res.status, 'EMPTY_RESPONSE', `Empty response (HTTP ${res.status})`);
  }

  if (!res.ok || !envelope.success) {
    const err = envelope.error ?? { code: 'UNKNOWN', message: `HTTP ${res.status}` };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }

  return envelope.data as T;
}
