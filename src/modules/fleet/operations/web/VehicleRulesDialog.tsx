import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CreateVehicleRuleVersionInput, VehicleOperationalRule } from '../../vehicleDetectors/types';
import {
  VEHICLE_RULE_FIELDS, VEHICLE_RULE_UNIT_LABELS, vehicleRulesApi, type VehicleRuleField,
} from './vehicleRulesApi';

/**
 * Sibling of StatusRulesDialog, deliberately not an extension of it: the two
 * rules have disjoint fields and disjoint permissions (`fleet.operations-rules`
 * vs `fleet.vehicle-rules`), and merging them would put a vehicle threshold
 * behind a staff-rule permission.
 */

type NumericKey = VehicleRuleField['key'];
type Draft = Record<NumericKey, string> & {
  effectiveFrom: string; changeReason: string;
  afterHoursStartTime: string; afterHoursEndTime: string;
  weekendsAreAfterHours: boolean; publicHolidaysAreAfterHours: boolean;
};

/** A local-time `datetime-local` value five minutes out, never a UTC one. */
function effectiveDefault(): string {
  const value = new Date(Date.now() + 5 * 60_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

/** `HH:MM:SS` from Postgres narrowed to what an `<input type="time">` accepts. */
const clock = (value: string): string => value.slice(0, 5);

function draftFrom(rule: VehicleOperationalRule): Draft {
  const thresholds = Object.fromEntries(
    VEHICLE_RULE_FIELDS.map((field) => [field.key, String(rule[field.key])]),
  ) as Record<NumericKey, string>;
  return {
    ...thresholds,
    effectiveFrom: effectiveDefault(), changeReason: '',
    afterHoursStartTime: clock(rule.afterHoursStartTime),
    afterHoursEndTime: clock(rule.afterHoursEndTime),
    weekendsAreAfterHours: rule.weekendsAreAfterHours,
    publicHolidaysAreAfterHours: rule.publicHolidaysAreAfterHours,
  };
}

function fieldError(field: VehicleRuleField, value: string): string | null {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number < field.minimum) {
    if (field.key === 'theftMinPositions') return 'Use a whole number of at least 2.';
    return field.integer ? `Use a whole number of at least ${field.minimum}.` : 'Use a non-negative number.';
  }
  if (field.integer && !Number.isInteger(number)) return `Use a whole number of at least ${field.minimum}.`;
  return null;
}

function toInput(rule: VehicleOperationalRule, draft: Draft): CreateVehicleRuleVersionInput {
  const thresholds = Object.fromEntries(
    VEHICLE_RULE_FIELDS.map((field) => [field.key, Number(draft[field.key])]),
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

export function VehicleRulesDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [rules, setRules] = useState<VehicleOperationalRule[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await vehicleRulesApi.listRules();
      setRules(next);
      if (next[0]) setDraft(draftFrom(next[0]));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load vehicle rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const current = rules.find((rule) => rule.effectiveTo === null) ?? rules[0];
  const errors = useMemo(
    () => new Map(VEHICLE_RULE_FIELDS.map((field) => [field.key, draft ? fieldError(field, draft[field.key]) : 'Required'])),
    [draft],
  );
  const changes = current && draft
    ? VEHICLE_RULE_FIELDS.filter((field) => Number(draft[field.key]) !== current[field.key])
    : [];
  const valid = Boolean(
    current && draft?.changeReason.trim() && draft.effectiveFrom
    && Date.parse(draft.effectiveFrom) > Date.now()
    && draft.afterHoursStartTime && draft.afterHoursEndTime
    && [...errors.values()].every((value) => value === null),
  );

  async function create() {
    if (!current || !draft || !valid) return;
    setSaving(true); setError(null);
    try {
      await vehicleRulesApi.createRule(toInput(current, draft));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create vehicle rule version');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return <div role="dialog" aria-modal="true" aria-label="Vehicle operational rules" className="fixed inset-0 z-50 overflow-auto bg-black/60 p-6"><div className="mx-auto max-w-4xl space-y-4 rounded-lg bg-[var(--ff-bg-primary)] p-6 text-[var(--ff-text-primary)]">
    <header className="flex justify-between"><div><h2 className="text-xl font-semibold">Vehicle operational rules</h2><p>Versioned telematics thresholds use {current?.timezone ?? 'Africa/Johannesburg'}.</p></div><button type="button" onClick={onClose} aria-label="Close vehicle rules">Close</button></header>
    {loading && !current && <p>Loading vehicle rules…</p>}{error && <p role="alert" className="text-red-400">{error}</p>}
    <p className="rounded border p-3"><strong>The after-hours window wraps midnight.</strong> 18:00 → 06:00 is one window spanning two calendar days. Weekends and public holidays are counted separately.</p>
    {current && draft && canEdit && <section className="space-y-3" aria-label="Create vehicle rule version">
      <h3 className="font-semibold">Current thresholds</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {VEHICLE_RULE_FIELDS.map((field) => <label key={field.key}>{field.label} ({VEHICLE_RULE_UNIT_LABELS[field.unit]})
          <input className="block w-full" aria-label={`${field.label} (${VEHICLE_RULE_UNIT_LABELS[field.unit]})`} type="number" step={field.integer ? 1 : 'any'} min={field.minimum} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
          {errors.get(field.key) && <span className="text-sm text-red-400">{errors.get(field.key)}</span>}</label>)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label>After-hours start<input className="block" aria-label="After-hours start" type="time" value={draft.afterHoursStartTime} onChange={(event) => setDraft({ ...draft, afterHoursStartTime: event.target.value })} /></label>
        <label>After-hours end<input className="block" aria-label="After-hours end" type="time" value={draft.afterHoursEndTime} onChange={(event) => setDraft({ ...draft, afterHoursEndTime: event.target.value })} /></label>
      </div>
      <label><input type="checkbox" aria-label="Weekends are after-hours" checked={draft.weekendsAreAfterHours} onChange={(event) => setDraft({ ...draft, weekendsAreAfterHours: event.target.checked })} /> Weekends are after-hours</label>
      <label><input type="checkbox" aria-label="Public holidays are after-hours" checked={draft.publicHolidaysAreAfterHours} onChange={(event) => setDraft({ ...draft, publicHolidaysAreAfterHours: event.target.checked })} /> Public holidays are after-hours</label>
      <label>Effective from<input className="block" aria-label="Effective from" type="datetime-local" value={draft.effectiveFrom} min={effectiveDefault()} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} /></label>
      <label>Change reason<textarea className="block w-full" aria-label="Change reason" value={draft.changeReason} onChange={(event) => setDraft({ ...draft, changeReason: event.target.value })} /></label>
      <section aria-label="Vehicle rule change summary"><h3 className="font-semibold">Before / after</h3>{changes.length ? <ul>{changes.map((field) => <li key={field.key}>{field.label}: {current[field.key]} {field.unit} → {draft[field.key]} {field.unit}</li>)}</ul> : <p>No threshold changes.</p>}</section>
      <button type="button" disabled={!valid || saving} onClick={() => void create()}>{saving ? 'Creating version…' : 'Create vehicle rule version'}</button>
    </section>}
    <section aria-label="Vehicle rule history"><h3 className="font-semibold">Version history</h3>{rules.map((rule) => <article key={rule.id} className="border-t py-2"><strong>Version {rule.version}</strong><span> · effective {new Date(rule.effectiveFrom).toLocaleString()}</span><p>{rule.changeReason ?? 'No reason recorded'}</p></article>)}</section>
  </div></div>;
}
