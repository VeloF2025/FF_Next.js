import type { VehicleOperationalRule } from '../../vehicleDetectors/types';
import { VEHICLE_RULE_FIELDS, VEHICLE_RULE_UNIT_LABELS } from './vehicleRulesApi';
import { effectiveDefault, type NumericKey, type VehicleRuleDraft } from './vehicleRuleDraft';

/** The create-a-version editor. Rendered only when the caller holds `fleet.vehicle-rules` edit. */
export function VehicleRuleForm({
  current,
  draft,
  errors,
  heading,
  saving,
  valid,
  onChange,
  onCreate,
}: {
  current: VehicleOperationalRule;
  draft: VehicleRuleDraft;
  errors: Map<NumericKey, string | null>;
  heading: string;
  saving: boolean;
  valid: boolean;
  onChange: (next: VehicleRuleDraft) => void;
  onCreate: () => void;
}) {
  const changes = VEHICLE_RULE_FIELDS.filter(
    (field) => Number(draft[field.key]) !== current[field.key]
  );

  return (
    <section className="space-y-3" aria-label="Create vehicle rule version">
      <h3 className="font-semibold">{heading}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {VEHICLE_RULE_FIELDS.map((field) => {
          const unit = VEHICLE_RULE_UNIT_LABELS[field.unit];
          return (
            <label key={field.key}>
              {field.label} ({unit})
              <input
                className="block w-full"
                aria-label={`${field.label} (${unit})`}
                type="number"
                step={field.integer ? 1 : 'any'}
                min={field.minimum}
                value={draft[field.key]}
                onChange={(event) => onChange({ ...draft, [field.key]: event.target.value })}
              />
              {errors.get(field.key) && (
                <span className="text-sm text-red-400">{errors.get(field.key)}</span>
              )}
            </label>
          );
        })}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          After-hours start
          <input
            className="block"
            aria-label="After-hours start"
            type="time"
            value={draft.afterHoursStartTime}
            onChange={(event) => onChange({ ...draft, afterHoursStartTime: event.target.value })}
          />
        </label>
        <label>
          After-hours end
          <input
            className="block"
            aria-label="After-hours end"
            type="time"
            value={draft.afterHoursEndTime}
            onChange={(event) => onChange({ ...draft, afterHoursEndTime: event.target.value })}
          />
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          aria-label="Weekends are after-hours"
          checked={draft.weekendsAreAfterHours}
          onChange={(event) => onChange({ ...draft, weekendsAreAfterHours: event.target.checked })}
        />{' '}
        Weekends are after-hours
      </label>
      <label>
        <input
          type="checkbox"
          aria-label="Public holidays are after-hours"
          checked={draft.publicHolidaysAreAfterHours}
          onChange={(event) =>
            onChange({ ...draft, publicHolidaysAreAfterHours: event.target.checked })
          }
        />{' '}
        Public holidays are after-hours
      </label>
      <label>
        Effective from
        <input
          className="block"
          aria-label="Effective from"
          type="datetime-local"
          value={draft.effectiveFrom}
          min={effectiveDefault()}
          onChange={(event) => onChange({ ...draft, effectiveFrom: event.target.value })}
        />
      </label>
      <label>
        Change reason
        <textarea
          className="block w-full"
          aria-label="Change reason"
          value={draft.changeReason}
          onChange={(event) => onChange({ ...draft, changeReason: event.target.value })}
        />
      </label>
      <section aria-label="Vehicle rule change summary">
        <h3 className="font-semibold">Before / after</h3>
        {changes.length ? (
          <ul>
            {changes.map((field) => (
              <li key={field.key}>
                {field.label}: {current[field.key]} {field.unit} → {draft[field.key]} {field.unit}
              </li>
            ))}
          </ul>
        ) : (
          <p>No threshold changes.</p>
        )}
      </section>
      <button type="button" disabled={!valid || saving} onClick={onCreate}>
        {saving ? 'Creating version…' : 'Create vehicle rule version'}
      </button>
    </section>
  );
}
