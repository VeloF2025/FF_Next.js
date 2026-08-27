/**
 * The PR8 analytics/retention section of the incident settings dialog
 * (stage 8, task 9b).
 *
 * Its own file for the reason `OversightSection` is: the dialog was already at
 * its size cap before this arrived.
 *
 * Compact in the same way `DriverInputSection` is — it edits the numbers a
 * manager actually tunes and passes the rest of the policy through unchanged.
 * That pass-through is not laziness: versioning takes the WHOLE settings shape,
 * so a field this form omitted would be silently rewritten to whatever the
 * request left out.
 *
 * One field is not like the others. Shortening the retention window makes every
 * terminal incident between the new cutoff and the old one deletable at the
 * next purge — so the moment the number is reduced this warns, asks for a dry
 * run to point at, and will not send without one. The server enforces the same
 * rule; doing it here as well means the manager finds out while they are still
 * looking at the form.
 *
 * `liveRetentionEnabled` is pass-through only: this section shows whether live
 * retention is armed but has no control that arms it. That switch is a
 * separate, unreviewed-here surface and is deliberately out of scope.
 */
import { useCallback, useEffect, useState } from 'react';
import { log } from '@/lib/logger';
import { IncidentApiError } from './incidentApi';
import { retentionSettingsApi } from './retentionSettingsApi';
import type { AnalyticsRetentionSettingsChangeRequest } from './retentionSettingsApi';
import type { RetentionPolicy } from '../analytics/types';

/**
 * Every number this form exposes, with the policy field it edits and the
 * floor and ceiling migration 518's own CHECK constraints enforce
 * (`retentionSettingsValidation.ts`). Mirroring the server's bounds here means
 * a manager finds out about an invalid number from the input itself, not a
 * 500 naming a constraint.
 *
 * `holdReviewReminderLeadDays` has no fixed ceiling of its own — its server
 * floor is `maximumHoldReviewDays`, enforced separately below — so it carries
 * the absolute ceiling `maximumHoldReviewDays` itself is bound to (90).
 */
const FIELDS = [
  ['retentionMonths', 'Retention months', 1, 120],
  ['anonymityMinContributors', 'Anonymity threshold', 5, 1000],
  ['recalculationWindowMonths', 'Recalculation window months', 1, 24],
  ['retentionBatchSize', 'Retention batch size', 1, 100],
  ['maximumHoldReviewDays', 'Maximum hold review days', 1, 90],
  ['holdReviewReminderLeadDays', 'Hold review reminder lead days', 1, 90],
  ['aggregationRunHourSast', 'Aggregation run hour (SAST)', 0, 23],
  ['aggregationRunMinuteSast', 'Aggregation run minute (SAST)', 0, 59],
  ['retentionRunHourSast', 'Retention run hour (SAST)', 0, 23],
  ['retentionRunMinuteSast', 'Retention run minute (SAST)', 0, 59],
] as const satisfies readonly (readonly [keyof RetentionPolicy, string, number, number])[];

type EditableField = (typeof FIELDS)[number][0];
type Draft = Record<EditableField, string>;

function draftFrom(policy: RetentionPolicy): Draft {
  return Object.fromEntries(FIELDS.map(([field]) => [field, String(policy[field])])) as Draft;
}

const RETENTION_MONTHS_FIELD = FIELDS.find(([field]) => field === 'retentionMonths')!;

/** A blank or non-integer field is never "valid at 0" — it is simply not entered yet. */
function isValidWhole(raw: string, min: number, max: number): boolean {
  const trimmed = raw.trim();
  return trimmed !== '' && Number.isInteger(Number(trimmed))
    && Number(trimmed) >= min && Number(trimmed) <= max;
}

function NumberField({ field, label, value, min, max, onChange }: {
  field: string; label: string; value: string; min: number; max: number; onChange: (value: string) => void;
}) {
  return (
    <label className="mr-3 inline-block text-sm">{label}
      <input
        aria-label={label} id={field} type="number" min={min} max={max} value={value}
        onChange={(event) => onChange(event.target.value)}
        className="ml-2 w-20 rounded border px-2 py-1"
      />
    </label>
  );
}

export function RetentionAnalyticsSection({ canEdit }: { canEdit: boolean }) {
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [dryRunId, setDryRunId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const current = await retentionSettingsApi.get();
      setPolicy(current);
      setDraft(draftFrom(current));
      setChangeReason('');
      setDryRunId('');
      setError(null);
    } catch (caught) {
      // Left null rather than defaulted: a form pre-filled with invented
      // numbers would let someone "save" a policy nobody is looking at.
      setError(caught instanceof IncidentApiError ? caught.message : 'Could not load analytics and retention settings');
      log.error('Fleet analytics/retention settings failed to load', { error: caught }, 'fleet');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // A blank retentionMonths field is not "requesting 0 months" — `Number('')`
  // coerces to 0, which would otherwise both warn about a shortening to zero
  // and let a 0 slip into the request the server 400s on.
  const requested = draft && isValidWhole(draft.retentionMonths, RETENTION_MONTHS_FIELD[2], RETENTION_MONTHS_FIELD[3])
    ? Number(draft.retentionMonths) : null;
  const shortening = policy !== null && requested !== null && requested < policy.retentionMonths;

  const valid = policy !== null && draft !== null
    && changeReason.trim().length > 0
    && FIELDS.every(([field, , min, max]) => isValidWhole(draft[field], min, max))
    // Same rule DriverInputSection enforces client-side for its own pair
    // (historyWindowDays >= recentWindowDays): the server's floor on
    // holdReviewReminderLeadDays is `maximumHoldReviewDays`, not a fixed number.
    && Number(draft.holdReviewReminderLeadDays) <= Number(draft.maximumHoldReviewDays)
    // The server refuses this too; refusing here means the manager finds out
    // while they are still looking at the number they just changed.
    && (!shortening || dryRunId.trim().length > 0);

  async function save(): Promise<void> {
    if (!policy || !draft || !valid) return;
    setSaving(true); setError(null);
    try {
      const numbers = Object.fromEntries(
        FIELDS.map(([field]) => [field, Number(draft[field])]),
      ) as Record<EditableField, number>;
      const body: AnalyticsRetentionSettingsChangeRequest = {
        // Everything this form does not expose, carried through untouched.
        aggregateFreshnessWarningHours: policy.aggregateFreshnessWarningHours,
        retentionFreshnessWarningHours: policy.retentionFreshnessWarningHours,
        permittedHoldCategories: [...policy.permittedHoldCategories],
        metricVersion: policy.metricVersion,
        liveRetentionEnabled: policy.liveRetentionEnabled,
        ...numbers,
        // Far enough ahead that a version cannot activate before the person
        // saving it has stopped looking at the dialog. Matches DriverInputSection.
        effectiveFrom: new Date(Date.now() + 5 * 60_000).toISOString(),
        changeReason: changeReason.trim(),
        ...(shortening ? { acknowledgedDryRunId: dryRunId.trim() } : {}),
      };
      await retentionSettingsApi.version(body);
      await load();
    } catch (caught) {
      setError(caught instanceof IncidentApiError ? caught.message : 'Could not update analytics and retention settings');
      log.error('Fleet analytics/retention settings update failed', { error: caught }, 'fleet');
    } finally { setSaving(false); }
  }

  return (
    <section aria-label="Analytics and retention settings" className="space-y-2">
      <h3 className="font-semibold text-[var(--ff-text-primary)]">Analytics and retention</h3>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {policy && (
        <p className="text-sm text-[var(--ff-text-secondary)]">
          {/* "Policy version", not bare "Version": the driver-input section
              above shows its own version, and two lines reading "Version 1" in
              one dialog leave a reader unable to tell which is which. */}
          Policy version {policy.version} — identifiable detail kept {policy.retentionMonths} months, groups of
          fewer than {policy.anonymityMinContributors} people generalised, {policy.recalculationWindowMonths}-month
          recalculation window. Live retention {policy.liveRetentionEnabled ? 'enabled' : 'dry-run only'}.
        </p>
      )}

      {policy && draft && canEdit && (
        <div className="space-y-2 rounded border p-3">
          {FIELDS.map(([field, label, min, max]) => (
            <NumberField
              key={field} field={field} label={label} value={draft[field]} min={min} max={max}
              onChange={(value) => setDraft({ ...draft, [field]: value })}
            />
          ))}

          {shortening && (
            // Same amber pair CheckInSummary.tsx uses for its offline banner: the
            // dark-only amber-900/20 + amber-300 this replaced measured ~1.02:1 in
            // light mode — effectively invisible. bg-amber-50/text-amber-700 in
            // light, dark:bg-amber-900/20/dark:text-amber-400 in dark, both pass.
            <div data-testid="retention-shorten-warning" className="rounded border border-amber-200 bg-amber-50 p-2 text-sm dark:border-amber-800 dark:bg-amber-900/20">
              <p className="text-amber-700 dark:text-amber-400">
                Shortening retention from {policy.retentionMonths} to {requested} months makes every terminal
                incident between the two cutoffs deletable at the next purge. Review a dry run first, then
                name it below.
              </p>
              <label className="mt-1 block text-sm">Acknowledged dry run id
                <input
                  aria-label="Acknowledged dry run id" value={dryRunId}
                  onChange={(event) => setDryRunId(event.target.value)}
                  className="ml-2 rounded border px-2 py-1"
                />
              </label>
            </div>
          )}

          <label className="block text-sm">Change reason
            <textarea
              aria-label="Retention settings change reason" value={changeReason}
              onChange={(event) => setChangeReason(event.target.value)}
              className="block w-full rounded border px-2 py-1"
            />
          </label>
          {/* text-black — see the matching note on the dialog's other save buttons. */}
          <button
            type="button" data-testid="retention-save" disabled={!valid || saving}
            onClick={() => void save()}
            className="rounded bg-[var(--ff-primary)] px-3 py-2 text-sm text-black disabled:opacity-50"
          >
            {saving ? 'Updating…' : 'Update analytics and retention settings'}
          </button>
        </div>
      )}
    </section>
  );
}
