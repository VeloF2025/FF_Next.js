import type {
  CreateVehicleRuleVersionInput,
  VehicleOperationalRule,
} from '../../vehicleDetectors/types';
import { VEHICLE_RULE_FIELDS, type VehicleRuleField } from './vehicleRulesApi';

/**
 * The dialog's edit state and the pure functions over it.
 *
 * Split out of `VehicleRulesDialog.tsx` so the component stays under the size
 * limit — and so the draft rules can be read without reading any JSX.
 */

export type NumericKey = VehicleRuleField['key'];

export type VehicleRuleDraft = Record<NumericKey, string> & {
  effectiveFrom: string;
  changeReason: string;
  afterHoursStartTime: string;
  afterHoursEndTime: string;
  weekendsAreAfterHours: boolean;
  publicHolidaysAreAfterHours: boolean;
};

/** A local-time `datetime-local` value five minutes out, never a UTC one. */
export function effectiveDefault(): string {
  const value = new Date(Date.now() + 5 * 60_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

/** `HH:MM:SS` from Postgres narrowed to what an `<input type="time">` accepts. */
const clock = (value: string): string => value.slice(0, 5);

export function draftFrom(rule: VehicleOperationalRule): VehicleRuleDraft {
  const thresholds = Object.fromEntries(
    VEHICLE_RULE_FIELDS.map((field) => [field.key, String(rule[field.key])])
  ) as Record<NumericKey, string>;
  return {
    ...thresholds,
    effectiveFrom: effectiveDefault(),
    changeReason: '',
    afterHoursStartTime: clock(rule.afterHoursStartTime),
    afterHoursEndTime: clock(rule.afterHoursEndTime),
    weekendsAreAfterHours: rule.weekendsAreAfterHours,
    publicHolidaysAreAfterHours: rule.publicHolidaysAreAfterHours,
  };
}

/** Mirrors migration 529's CHECK constraints, so the operator sees the problem before the round trip. */
export function fieldError(field: VehicleRuleField, value: string): string | null {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number < field.minimum) {
    if (field.key === 'theftMinPositions') return 'Use a whole number of at least 2.';
    return field.integer
      ? `Use a whole number of at least ${field.minimum}.`
      : 'Use a non-negative number.';
  }
  if (field.integer && !Number.isInteger(number)) {
    return `Use a whole number of at least ${field.minimum}.`;
  }
  return null;
}

export function toInput(
  rule: VehicleOperationalRule,
  draft: VehicleRuleDraft
): CreateVehicleRuleVersionInput {
  const thresholds = Object.fromEntries(
    VEHICLE_RULE_FIELDS.map((field) => [field.key, Number(draft[field.key])])
  ) as Record<NumericKey, number>;
  return {
    ...thresholds,
    timezone: rule.timezone,
    effectiveFrom: new Date(draft.effectiveFrom).toISOString(),
    afterHoursStartTime: draft.afterHoursStartTime,
    afterHoursEndTime: draft.afterHoursEndTime,
    weekendsAreAfterHours: draft.weekendsAreAfterHours,
    publicHolidaysAreAfterHours: draft.publicHolidaysAreAfterHours,
    changeReason: draft.changeReason.trim(),
  };
}
