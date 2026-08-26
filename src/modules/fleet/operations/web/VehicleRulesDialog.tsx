import { useCallback, useEffect, useMemo, useState } from 'react';
import { log } from '@/lib/logger';
import type { VehicleOperationalRule } from '../../vehicleDetectors/types';
import { VEHICLE_RULE_FIELDS, vehicleRulesApi } from './vehicleRulesApi';
import { VehicleRuleForm } from './VehicleRuleForm';
import { draftFrom, fieldError, toInput, type VehicleRuleDraft } from './vehicleRuleDraft';

/**
 * Sibling of StatusRulesDialog, deliberately not an extension of it: the two
 * rules have disjoint fields and disjoint permissions (`fleet.operations-rules`
 * vs `fleet.vehicle-rules`), and merging them would put a vehicle threshold
 * behind a staff-rule permission.
 */
export function VehicleRulesDialog({
  open,
  onClose,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
}) {
  const [rules, setRules] = useState<VehicleOperationalRule[]>([]);
  const [draft, setDraft] = useState<VehicleRuleDraft | null>(null);
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
      log.error('Failed to load Fleet vehicle operational rules', { error: caught }, 'fleet');
      setError(caught instanceof Error ? caught.message : 'Could not load vehicle rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const current = rules.find((rule) => rule.effectiveTo === null) ?? rules[0];
  // The open version is not necessarily in force: a version created with a
  // future activation is open and PENDING. Labelling it "Current" would tell an
  // operator that thresholds are live which the detectors are not yet reading.
  const pendingFrom =
    current && Date.parse(current.effectiveFrom) > Date.now()
      ? new Date(current.effectiveFrom).toLocaleString()
      : null;
  const errors = useMemo(
    () =>
      new Map(
        VEHICLE_RULE_FIELDS.map((field) => [
          field.key,
          draft ? fieldError(field, draft[field.key]) : 'Required',
        ])
      ),
    [draft]
  );
  const valid = Boolean(
    current &&
    draft?.changeReason.trim() &&
    draft.effectiveFrom &&
    Date.parse(draft.effectiveFrom) > Date.now() &&
    draft.afterHoursStartTime &&
    draft.afterHoursEndTime &&
    [...errors.values()].every((value) => value === null)
  );

  async function create() {
    if (!current || !draft || !valid) return;
    setSaving(true);
    setError(null);
    try {
      await vehicleRulesApi.createRule(toInput(current, draft));
      await load();
    } catch (caught) {
      log.error('Failed to create a Fleet vehicle rule version', { error: caught }, 'fleet');
      setError(caught instanceof Error ? caught.message : 'Could not create vehicle rule version');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vehicle operational rules"
      className="fixed inset-0 z-50 overflow-auto bg-black/60 p-6"
    >
      {/*
        Surface class list is IDENTICAL to StatusRulesDialog's, and a test pins
        it that way. In particular there is deliberately NO text colour here:
        the sibling sets none, inherits the page's, and is verified correct in
        both themes.

        PR3 shipped this with `text-[var(--ff-text-primary)]` added, and a
        browser check on dev found near-white labels (rgb(249,250,251)) on this
        white surface in LIGHT theme while the sibling rendered dark text.

        Do NOT generalise from that: `text-[var(--ff-text-primary)]` is the
        repo's standard pattern (~4,800 uses), and 227 components pair it with
        `bg-[var(--ff-bg-primary)]` exactly as this one did, with no reported
        problem. The CSS mechanism was NOT identified — static analysis of the
        loaded stylesheets does not reproduce that computed value. What is
        established is the observation and the remedy: be identical to the
        sibling that is known good.
      */}
      <div className="mx-auto max-w-4xl space-y-4 rounded-lg bg-[var(--ff-bg-primary)] p-6">
        <header className="flex justify-between">
          <div>
            <h2 className="text-xl font-semibold">Vehicle operational rules</h2>
            <p>Versioned telematics thresholds use {current?.timezone ?? 'Africa/Johannesburg'}.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close vehicle rules">
            Close
          </button>
        </header>
        {loading && !current && <p>Loading vehicle rules…</p>}
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
        <p className="rounded border p-3">
          <strong>The after-hours window wraps midnight.</strong> 21:00 → 05:00 is one window
          spanning two calendar days. Weekends and public holidays are counted separately.
        </p>
        {current && draft && canEdit && (
          <VehicleRuleForm
            current={current}
            draft={draft}
            errors={errors}
            heading={pendingFrom ? `Pending from ${pendingFrom}` : 'Current thresholds'}
            saving={saving}
            valid={valid}
            onChange={setDraft}
            onCreate={() => void create()}
          />
        )}
        <section aria-label="Vehicle rule history">
          <h3 className="font-semibold">Version history</h3>
          {rules.map((rule) => (
            <article key={rule.id} className="border-t py-2">
              <strong>Version {rule.version}</strong>
              <span>
                {' '}
                · {Date.parse(rule.effectiveFrom) > Date.now() ? 'pending from' : 'effective'}{' '}
                {new Date(rule.effectiveFrom).toLocaleString()}
              </span>
              <p>{rule.changeReason ?? 'No reason recorded'}</p>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
