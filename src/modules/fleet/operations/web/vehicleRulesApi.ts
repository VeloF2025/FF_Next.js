import type { CreateVehicleRuleVersionInput, VehicleOperationalRule, VehicleRuleThresholdKey } from '../../vehicleDetectors/types';

export interface VehicleRuleField {
  key: VehicleRuleThresholdKey; label: string; unit: string; minimum: number; integer: boolean;
}

/**
 * The editable thresholds, in the order the dialog shows them.
 *
 * `minimum` and `integer` mirror migration 529's CHECK constraints — the form
 * refuses locally what the database would refuse anyway, so an operator sees
 * the problem before the round trip rather than a 400.
 */
export const VEHICLE_RULE_FIELDS: VehicleRuleField[] = [
  { key: 'theftDisplacementMeters', label: 'Theft displacement', unit: 'm', minimum: 1, integer: true },
  // Two is the floor, not a preference: with one, a single GPS blip is a theft report.
  { key: 'theftMinPositions', label: 'Theft minimum positions', unit: 'fixes', minimum: 2, integer: true },
  { key: 'harshLinearG', label: 'Harsh braking threshold', unit: 'g', minimum: 0, integer: false },
  { key: 'harshLateralG', label: 'Harsh cornering threshold', unit: 'g', minimum: 0, integer: false },
  { key: 'harshMinSpeedKph', label: 'Harsh event minimum speed', unit: 'km/h', minimum: 0, integer: false },
  { key: 'speedOverLimitKph', label: 'Speed over limit', unit: 'km/h', minimum: 0, integer: false },
  { key: 'unauthorizedStopMinutes', label: 'Unauthorised stop', unit: 'min', minimum: 1, integer: true },
  { key: 'lostContactMinutes', label: 'Lost contact floor', unit: 'min', minimum: 1, integer: true },
  { key: 'idleAlertMinutes', label: 'Idle alert', unit: 'min', minimum: 1, integer: true },
  { key: 'knownSiteRadiusMeters', label: 'Known site radius', unit: 'm', minimum: 1, integer: true },
];

export const VEHICLE_RULE_UNIT_LABELS: Record<string, string> = {
  m: 'metres', min: 'minutes', 'km/h': 'km/h', g: 'g', fixes: 'fixes',
};

interface Envelope<T> { success: boolean; data?: T; error?: { message?: string } }

export class VehicleRulesApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'VehicleRulesApiError';
  }
}

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/fleet/vehicle-rules', {
    credentials: 'same-origin', ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json() as Envelope<T>;
  if (!response.ok || !body.success || body.data === undefined) {
    throw new VehicleRulesApiError(body.error?.message ?? 'Vehicle rules request failed', response.status);
  }
  return body.data;
}

export const vehicleRulesApi = {
  listRules: () => request<VehicleOperationalRule[]>(),
  createRule: (input: CreateVehicleRuleVersionInput) =>
    request<VehicleOperationalRule>({ method: 'POST', body: JSON.stringify(input) }),
};
