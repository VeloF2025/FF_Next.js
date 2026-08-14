import type { OperationalMapOverlay } from '../mapOverlayService';
import type { OperationalOverview } from '../presentationTypes';
import { serializeOperationFilters, type OperationFilters } from './operationFilters';

export interface OperationalOverviewResponse extends OperationalOverview {
  workDate: string;
  evaluatedAt: string;
  rule: { id: string | null; version: number | null };
}

export type LiveTrackingState = 'tracked' | 'awaiting_data' | 'untracked';
export interface LiveVehicleTelemetry {
  vehicleId: string;
  registration: string;
  driverName: string | null;
  provider: string | null;
  lat: number | null;
  lon: number | null;
  speedKph: number | null;
  ignition: boolean | null;
  isSpeeding: boolean | null;
  recordedAt: string | null;
  ageSeconds: number | null;
  isStale: boolean;
  staleAfterSeconds: number;
  trackingState: LiveTrackingState;
}
export interface LiveFleetTelemetry { vehicles: LiveVehicleTelemetry[] }

type ApiErrorKind = 'permission' | 'transient';
interface ApiSuccessEnvelope<T> { success: true; data: T }
interface ApiErrorEnvelope { success: false; error: { code: string; message: string } }

export class OperationsPresentationApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public kind: ApiErrorKind = status === 403 ? 'permission' : 'transient',
  ) {
    super(message);
    this.name = 'OperationsPresentationApiError';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSuccessEnvelope<T>(value: unknown): value is ApiSuccessEnvelope<T> {
  return isRecord(value) && value.success === true && Object.prototype.hasOwnProperty.call(value, 'data');
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isRecord(value) || value.success !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

async function request<T>(url: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin', signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new OperationsPresentationApiError('Operational presentation request failed', 0, 'NETWORK_ERROR');
  }

  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new OperationsPresentationApiError('Operational presentation response was invalid', response.status, 'INVALID_RESPONSE');
  }
  if (isErrorEnvelope(body)) {
    throw new OperationsPresentationApiError(
      body.error.message,
      response.status,
      body.error.code,
    );
  }
  if (!response.ok || !isSuccessEnvelope<T>(body)) {
    throw new OperationsPresentationApiError('Operational presentation response was invalid', response.status, 'INVALID_RESPONSE');
  }
  return body.data;
}

function endpoint(path: string, filters: OperationFilters, allowed: Array<keyof OperationFilters>): string {
  const canonical = new URLSearchParams(serializeOperationFilters(filters));
  for (const key of [...canonical.keys()]) {
    if (!allowed.includes(key as keyof OperationFilters)) canonical.delete(key);
  }
  return `${path}?${canonical.toString()}`;
}

export const operationsPresentationApi = {
  overview(filters: OperationFilters, signal: AbortSignal): Promise<OperationalOverviewResponse> {
    const url = endpoint('/api/fleet/operations/overview', filters, ['projectId', 'workDate', 'asOf', 'status', 'group']);
    const params = new URLSearchParams(url.split('?')[1]);
    params.set('page', '1'); params.set('limit', '25');
    return request(`${url.split('?')[0]}?${params.toString()}`, signal);
  },
  overlay(filters: OperationFilters, signal: AbortSignal): Promise<OperationalMapOverlay> {
    const url = endpoint('/api/fleet/operations/map-overlay', filters,
      ['projectId', 'staffId', 'siteId', 'workDate', 'asOf']);
    const params = new URLSearchParams(url.split('?')[1]);
    params.set('page', '1'); params.set('limit', '100'); params.set('includeGeometry', 'true');
    return request(`${url.split('?')[0]}?${params.toString()}`, signal);
  },
  telemetry(signal: AbortSignal): Promise<LiveFleetTelemetry> {
    return request('/api/fleet/positions/live', signal);
  },
};

export function isOperationsRequestAbort(error: unknown): boolean { return isAbortError(error); }
