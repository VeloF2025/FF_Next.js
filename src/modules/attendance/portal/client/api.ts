/**
 * Typed fetch wrappers for the /api/my portal endpoints.
 *
 * All requests:
 *  - Same-origin with `credentials: 'include'` so the `ff_my_session` cookie
 *    (path=/my, httpOnly) is sent on every call.
 *  - Surface the standard `apiResponse` error envelope: on HTTP error we throw
 *    an `ApiError` carrying the `code` + `message` + `details` so callers can
 *    branch on e.g. `details.reason === 'consent_missing'` without re-parsing.
 *
 * Deliberately no React dependencies here — these are plain functions so they
 * can be called from event handlers, loaders, or unit tests alike.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    // TypeError: Failed to fetch — DNS, offline, CORS, aborted. Without this
    // wrap every caller falls into their generic catch because `err` isn't
    // an ApiError. Normalising to ApiError(0, 'NETWORK_ERROR') gives UIs a
    // single switch point for the "check your connection" copy.
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
    // Preserve a truncated snippet of the HTML/plaintext body so Sentry sees
    // "Bad Gateway" / "Cloudflare challenge" rather than a bare PARSE_ERROR.
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

  // The success envelope always has `data` populated by apiResponse.success;
  // non-nullability is a contract guarantee, not a runtime check.
  return envelope.data as T;
}

// =============================================================================
// Auth
// =============================================================================

export type LoginMethod = 'pin' | 'password';

export interface LoginResponse {
  staffId: string;
  name: string;
  expiresAt: string;
}

export function login(args: {
  method: LoginMethod;
  identifier: string;
  credential: string;
  deviceFingerprint?: string;
}): Promise<LoginResponse> {
  return request<LoginResponse>('/api/my/login', {
    method: 'POST',
    body: JSON.stringify({
      method: args.method,
      identifier: args.identifier,
      credential: args.credential,
      device_fingerprint: args.deviceFingerprint,
    }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/my/logout', { method: 'POST' });
}

export interface AttendanceSessionMeta {
  sessionId: string;
  staffId: string;
  method: LoginMethod;
  expiresAt: string;
}

export interface AttendanceProfile {
  staffId: string;
  name: string;
  phone: string | null;
  email: string | null;
  homeSiteId: string | null;
  hasAssignedVehicle: boolean;
  profilePhotoUrl: string | null;
}

export interface SessionResponse {
  session: AttendanceSessionMeta | null;
  profile: AttendanceProfile | null;
  reason?: string;
}

export function getSession(): Promise<SessionResponse> {
  return request<SessionResponse>('/api/my/session', { method: 'GET' });
}

// =============================================================================
// Hub
// =============================================================================

export interface HubSummaryResponse {
  openEntry: {
    id: string;
    clockInAt: string;
    durationMs: number;
  } | null;
  assignedVehicle: {
    id: string;
    registration: string | null;
  } | null;
  latestPayslip: {
    id: string;
    payPeriodStart: string;
    payPeriodEnd: string;
    hasPdf: boolean;
  } | null;
  latestReceipt: {
    id: string;
    vendor: string | null;
    totalCents: number;
    capturedAt: string;
  } | null;
  pendingCorrectionsCount: number;
  recentEntryCount: number;
}

export function getHubSummary(): Promise<HubSummaryResponse> {
  return request<HubSummaryResponse>('/api/my/hub-summary', { method: 'GET' });
}

// =============================================================================
// Payslips (PRD-040 Phase 3)
// =============================================================================

export interface PayslipListItem {
  id: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  hasPdf: boolean;
  importedAt: string;
}

export function listMyPayslips(): Promise<{ items: PayslipListItem[] }> {
  return request<{ items: PayslipListItem[] }>('/api/my/payslips', { method: 'GET' });
}

/**
 * Build the URL the browser should hit to download a payslip PDF. The
 * server proxies VF Storage so the underlying storage URL never reaches
 * the client (POPIA — payslips are personal financial data).
 */
export function payslipDownloadUrl(payslipId: string): string {
  return `/api/my/payslips/${encodeURIComponent(payslipId)}/download`;
}

// =============================================================================
// Fleet handoff (PRD-040 Phase 2)
// =============================================================================

export interface FleetHandoffResponse {
  sessionId: string;
  vehicleRegistration: string | null;
  expiresAt: string;
}

/**
 * Mint a fleet portal session from the current /my session and return
 * the assigned vehicle's registration. Caller should navigate to
 * /fleet/portal after this resolves so the page sees the new cookie.
 */
export function requestFleetHandoff(): Promise<FleetHandoffResponse> {
  return request<FleetHandoffResponse>('/api/my/fleet-handoff', { method: 'POST' });
}

// =============================================================================
// OTP onboarding (PR2b)
// =============================================================================

export function requestOtp(phone: string): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/my/login/request-otp', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

export interface VerifyOtpResponse {
  staffId: string;
  name: string;
  pinSet: boolean;
  sessionIssued: boolean;
  expiresAt?: string;
}

export function verifyOtp(args: {
  phone: string;
  otp: string;
  newPin?: string;
  deviceFingerprint?: string;
}): Promise<VerifyOtpResponse> {
  return request<VerifyOtpResponse>('/api/my/login/verify-otp', {
    method: 'POST',
    body: JSON.stringify({
      phone: args.phone,
      otp: args.otp,
      new_pin: args.newPin,
      device_fingerprint: args.deviceFingerprint,
    }),
  });
}

// =============================================================================
// Attendance
// =============================================================================

export interface ClockEntry {
  entryId: string;
  workDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  status: 'open' | 'closed' | 'auto_closed' | 'disputed' | 'manual';
  siteGeofenceId: string | null;
  vehicleAssignmentId: string | null;
  selfieInUrl: string | null;
  selfieOutUrl: string | null;
  durationMs: number | null;
}

export interface ClockInResponse {
  entryId: string;
  workDate: string;
  clockInAt: string;
  siteId: string | null;
  siteName: string | null;
  insideSite: boolean;
  vehicleAssignmentId: string | null;
  selfieUrl: string;
}

export function clockIn(args: {
  lat: number;
  lon: number;
  accuracyM: number;
  clientOccurredAt: string;
  selfieBase64: string;
  deviceFingerprint?: string;
}): Promise<ClockInResponse> {
  return request<ClockInResponse>('/api/my/attendance/clock-in', {
    method: 'POST',
    body: JSON.stringify({
      lat: args.lat,
      lon: args.lon,
      accuracy_m: args.accuracyM,
      client_occurred_at: args.clientOccurredAt,
      selfie_base64: args.selfieBase64,
      device_fingerprint: args.deviceFingerprint,
    }),
  });
}

export interface ClockOutResponse {
  entryId: string;
  clockInAt: string;
  clockOutAt: string;
  workDate: string;
  durationMs: number;
  selfieUrl: string;
}

export function clockOut(args: {
  lat: number;
  lon: number;
  accuracyM: number;
  clientOccurredAt: string;
  selfieBase64: string;
  deviceFingerprint?: string;
}): Promise<ClockOutResponse> {
  return request<ClockOutResponse>('/api/my/attendance/clock-out', {
    method: 'POST',
    body: JSON.stringify({
      lat: args.lat,
      lon: args.lon,
      accuracy_m: args.accuracyM,
      client_occurred_at: args.clientOccurredAt,
      selfie_base64: args.selfieBase64,
      device_fingerprint: args.deviceFingerprint,
    }),
  });
}

export function getHistory(limit = 14): Promise<{ entries: ClockEntry[]; limit: number }> {
  return request<{ entries: ClockEntry[]; limit: number }>(
    `/api/my/attendance/history?limit=${encodeURIComponent(String(limit))}`,
    { method: 'GET' }
  );
}

// =============================================================================
// Reverse geocoding (coords → "Somerset West, Western Cape")
// =============================================================================

export interface GeocodeResult {
  city: string;
  municipalDistrict: string;
  province: string;
}

/**
 * Resolve lat/lon to a structured SA address via our server-side
 * Nominatim proxy. Returns `null` on any failure — the caller should
 * silently hide the address line, never block submit on it.
 *
 * Swallows ApiError so a geocode outage can't propagate into the clock
 * flow. The server-side endpoint itself also masks upstream failures
 * as `{ geocode: null }`, but belt-and-braces here for network errors.
 */
export async function getReverseGeocode(
  lat: number,
  lon: number
): Promise<GeocodeResult | null> {
  try {
    const resp = await request<{ geocode: GeocodeResult | null; cached: boolean }>(
      `/api/my/geocode?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`,
      { method: 'GET' }
    );
    return resp.geocode;
  } catch {
    return null;
  }
}

// =============================================================================
// POPIA selfie consent
// =============================================================================

export function grantSelfieConsent(): Promise<{ ok: true; action: 'grant'; version: number }> {
  return request<{ ok: true; action: 'grant'; version: number }>('/api/my/consent/selfie', {
    method: 'POST',
    body: JSON.stringify({ action: 'grant' }),
  });
}

export function revokeSelfieConsent(): Promise<{ ok: true; action: 'revoke' }> {
  return request<{ ok: true; action: 'revoke' }>('/api/my/consent/selfie', {
    method: 'POST',
    body: JSON.stringify({ action: 'revoke' }),
  });
}

// =============================================================================
// Corrections (self-service)
// =============================================================================

export type CorrectionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type CorrectionStatusFilter = CorrectionStatus | 'all';

export type CorrectionKind =
  | 'forgot_clock_out'
  | 'wrong_clock_in_time'
  | 'wrong_clock_out_time'
  | 'wrong_site'
  | 'duplicate_entry'
  | 'other';

export interface CorrectionHint {
  label: string;
  placeholder: string;
  hint: string;
  minReasonChars: number;
}

export type CorrectionHints = Record<CorrectionKind, CorrectionHint>;

export interface CorrectionRow {
  id: string;
  entry_id: string;
  adjustment_kind: CorrectionKind;
  adjusted_clock_in_at: string | null;
  adjusted_clock_out_at: string | null;
  adjusted_site_geofence_id: string | null;
  reason: string;
  status: CorrectionStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  entry_work_date?: string;
  entry_clock_in_at?: string;
  entry_clock_out_at?: string | null;
}

export interface CorrectionCounts {
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
}

export function getCorrectionHints(): Promise<{
  hints: CorrectionHints;
  absoluteMinReasonChars: number;
}> {
  return request('/api/my/attendance-corrections-hints', { method: 'GET' });
}

export function listMyCorrections(args: {
  status?: CorrectionStatusFilter;
  limit?: number;
} = {}): Promise<{
  adjustments: CorrectionRow[];
  counts: CorrectionCounts;
  statusFilter: CorrectionStatusFilter;
}> {
  const qs = new URLSearchParams();
  if (args.status) qs.set('status', args.status);
  if (args.limit != null) qs.set('limit', String(args.limit));
  const suffix = qs.toString();
  return request(
    `/api/my/attendance-corrections${suffix ? `?${suffix}` : ''}`,
    { method: 'GET' }
  );
}

export function cancelMyCorrection(adjustmentId: string): Promise<{
  adjustment: CorrectionRow;
}> {
  return request(
    `/api/my/attendance-corrections?adjustment_id=${encodeURIComponent(adjustmentId)}`,
    { method: 'DELETE' }
  );
}

export interface SubmitMyCorrectionArgs {
  entryId: string;
  adjustmentKind: CorrectionKind;
  /** ISO-8601 string or null. Null means "don't change this side". */
  adjustedClockInAt: string | null;
  adjustedClockOutAt: string | null;
  adjustedSiteGeofenceId: string | null;
  reason: string;
}

export function submitMyCorrection(
  args: SubmitMyCorrectionArgs
): Promise<{ adjustment: CorrectionRow }> {
  return request('/api/my/attendance-corrections', {
    method: 'POST',
    body: JSON.stringify({
      entry_id: args.entryId,
      adjustment_kind: args.adjustmentKind,
      adjusted_clock_in_at: args.adjustedClockInAt,
      adjusted_clock_out_at: args.adjustedClockOutAt,
      adjusted_site_geofence_id: args.adjustedSiteGeofenceId,
      reason: args.reason,
    }),
  });
}
