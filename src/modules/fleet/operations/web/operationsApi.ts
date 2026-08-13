import type { CreateRuleVersionInput, OperationalStatusRule } from '../ruleQueries';

type NumericRuleKey = Exclude<keyof CreateRuleVersionInput, 'timezone' | 'effectiveFrom' | 'changeReason'>;
export interface RuleField { key: NumericRuleKey; label: string; unit: string; minimum: number; integer: boolean }
export const RULE_FIELDS: RuleField[] = [
  { key: 'monitoringBeforeMinutes', label: 'Monitoring before shift', unit: 'min', minimum: 0, integer: true },
  { key: 'monitoringAfterMinutes', label: 'Monitoring after shift', unit: 'min', minimum: 0, integer: true },
  { key: 'arrivalDwellMinutes', label: 'Arrival dwell', unit: 'min', minimum: 0, integer: true },
  { key: 'wrongSiteConfirmationMinutes', label: 'Wrong-site confirmation', unit: 'min', minimum: 0, integer: true },
  { key: 'earlyDepartureConfirmationMinutes', label: 'Early-departure confirmation', unit: 'min', minimum: 0, integer: true },
  { key: 'approachingDistanceMeters', label: 'Approaching distance', unit: 'm', minimum: 1, integer: true },
  { key: 'approachingMinReadings', label: 'Approaching minimum readings', unit: 'readings', minimum: 2, integer: true },
  { key: 'minimumMovingSpeedKmh', label: 'Minimum moving speed', unit: 'km/h', minimum: 0, integer: false },
  { key: 'evidenceMismatchToleranceMeters', label: 'Evidence mismatch tolerance', unit: 'm', minimum: 0, integer: true },
];

interface Envelope<T> { success: boolean; data?: T; error?: { message?: string } }
export class OperationsApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'OperationsApiError'; } }
async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/fleet/operations/rules', { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json() as Envelope<T>;
  if (!response.ok || !body.success || body.data === undefined) throw new OperationsApiError(body.error?.message ?? 'Operational rules request failed', response.status);
  return body.data;
}
export const operationsApi = {
  listRules: () => request<OperationalStatusRule[]>(),
  createRule: (input: CreateRuleVersionInput) => request<OperationalStatusRule>({ method: 'POST', body: JSON.stringify(input) }),
};
