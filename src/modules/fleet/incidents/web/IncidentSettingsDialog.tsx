/**
 * Compact rules and oversight settings dialog (Task 8), opened from the
 * queue rather than a separate settings page (design §11.1). `canEdit`
 * gates every mutation control; a view-only visitor (or a closed dialog)
 * only ever reads.
 *
 * Oversight membership itself — search, add, end, history, and the
 * `userId` -> display-name resolution that keeps raw UUIDs out of the
 * visible UI — lives in `./OversightSection` (split out to stay under the
 * 200-line component cap once name resolution was added).
 *
 * `DriverInputSection` (PR7 Task 8) is deliberately compact per the plan's
 * own wording: it edits the response-window/visibility-window numbers a
 * manager is actually likely to tune, and passes the currently-loaded
 * concern-category/evidence-MIME/channel values straight through unchanged
 * on save (versioning requires the full settings shape) rather than
 * exposing every one of them as its own control.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { OUTCOMES } from '../reviewValidation';
import type { IncidentOutcome, IncidentRule, IncidentSeverity, IncidentType } from '../types';
import { incidentApi, IncidentApiError, type DriverInputSettingsRequestBody } from './incidentApi';
import { INCIDENT_TYPE_LABELS, OUTCOME_LABELS, SEVERITY_LABELS } from './incidentLabels';
import { OversightSection } from './OversightSection';
import type { DriverInputSettings } from '../driver/types';

function driverInputRequestFrom(settings: DriverInputSettings, overrides: Partial<DriverInputSettingsRequestBody>): DriverInputSettingsRequestBody {
  return {
    responseWindowWorkdays: settings.responseWindowWorkdays, postClosureResponseEnabled: settings.postClosureResponseEnabled,
    postClosureResponseWindowDays: settings.postClosureResponseWindowDays, recentWindowDays: settings.recentWindowDays,
    historyWindowDays: settings.historyWindowDays, enabledConcernCategories: settings.enabledConcernCategories,
    evidenceAllowedMimeTypes: settings.evidenceAllowedMimeTypes, evidenceMaxBytes: settings.evidenceMaxBytes,
    driverInputRequestedChannels: settings.driverInputRequestedChannels, driverResponseReceivedChannels: settings.driverResponseReceivedChannels,
    effectiveFrom: new Date(Date.now() + 5 * 60_000).toISOString(), changeReason: null,
    ...overrides,
  };
}

function DriverInputSection({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<DriverInputSettings | null>(null);
  const [responseWindowWorkdays, setResponseWindowWorkdays] = useState('');
  const [recentWindowDays, setRecentWindowDays] = useState('');
  const [historyWindowDays, setHistoryWindowDays] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const current = await incidentApi.getDriverInputSettings();
      setSettings(current);
      setResponseWindowWorkdays(String(current.responseWindowWorkdays));
      setRecentWindowDays(String(current.recentWindowDays));
      setHistoryWindowDays(String(current.historyWindowDays));
      setChangeReason('');
      setError(null);
    } catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not load driver-input settings'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const valid = Boolean(settings) && changeReason.trim().length > 0
    && Number.isInteger(Number(responseWindowWorkdays)) && Number(responseWindowWorkdays) > 0
    && Number.isInteger(Number(recentWindowDays)) && Number(recentWindowDays) > 0
    && Number.isInteger(Number(historyWindowDays)) && Number(historyWindowDays) >= Number(recentWindowDays);

  async function save(): Promise<void> {
    if (!settings || !valid) return;
    setSaving(true); setError(null);
    try {
      await incidentApi.versionDriverInputSettings(driverInputRequestFrom(settings, {
        responseWindowWorkdays: Number(responseWindowWorkdays), recentWindowDays: Number(recentWindowDays),
        historyWindowDays: Number(historyWindowDays), changeReason: changeReason.trim(),
      }));
      await load();
    } catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not update driver-input settings'); }
    finally { setSaving(false); }
  }

  return (
    <section aria-label="Driver input settings" className="space-y-2">
      <h3 className="font-semibold text-[var(--ff-text-primary)]">Driver input</h3>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {settings && <p className="text-sm text-[var(--ff-text-secondary)]">
        Version {settings.version} — response window {settings.responseWindowWorkdays} working day(s), {settings.recentWindowDays}-day recent visibility, {settings.historyWindowDays}-day history.
      </p>}
      {settings && canEdit && <div className="space-y-2 rounded border p-3">
        <label className="mr-3 inline-block text-sm">Response window workdays
          <input aria-label="Response window workdays" type="number" min={1} value={responseWindowWorkdays}
            onChange={(event) => setResponseWindowWorkdays(event.target.value)} className="ml-2 w-20 rounded border px-2 py-1" />
        </label>
        <label className="mr-3 inline-block text-sm">Recent visibility (days)
          <input aria-label="Recent visibility days" type="number" min={1} value={recentWindowDays}
            onChange={(event) => setRecentWindowDays(event.target.value)} className="ml-2 w-20 rounded border px-2 py-1" />
        </label>
        <label className="mr-3 inline-block text-sm">History visibility (days)
          <input aria-label="History visibility days" type="number" min={1} value={historyWindowDays}
            onChange={(event) => setHistoryWindowDays(event.target.value)} className="ml-2 w-20 rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">Change reason
          <textarea aria-label="Driver input settings change reason" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} className="block w-full rounded border px-2 py-1" />
        </label>
        {/* text-black — see the matching note on the "Create rule version" button below. */}
        <button type="button" disabled={!valid || saving} onClick={() => void save()} className="rounded bg-[var(--ff-primary)] px-3 py-2 text-sm text-black disabled:opacity-50">
          {saving ? 'Updating…' : 'Update driver input settings'}
        </button>
      </div>}
    </section>
  );
}
const RULED_TYPES: readonly IncidentType[] = ['late', 'wrong_site', 'evidence_mismatch', 'left_early'];
const SEVERITIES: readonly IncidentSeverity[] = ['normal', 'high', 'critical'];
type BooleanDraftKey = 'enabled' | 'createsIncident' | 'immediateNotification' | 'inApp' | 'email' | 'whatsapp' | 'includeInMorningSummary';
type NumberDraftKey = 'acknowledgementTargetMinutes' | 'reminderIntervalMinutes' | 'maximumEscalationLevel';
const BOOLEAN_FIELDS: ReadonlyArray<{ key: BooleanDraftKey; label: string }> = [
  { key: 'enabled', label: 'Enabled' }, { key: 'createsIncident', label: 'Creates incident' },
  { key: 'immediateNotification', label: 'Immediate notification' }, { key: 'inApp', label: 'In-app' },
  { key: 'email', label: 'Email' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'includeInMorningSummary', label: 'Include in morning summary' },
];
const NUMBER_FIELDS: ReadonlyArray<{ key: NumberDraftKey; label: string; min: number }> = [
  { key: 'acknowledgementTargetMinutes', label: 'Acknowledgement target (min)', min: 1 },
  { key: 'reminderIntervalMinutes', label: 'Reminder interval (min)', min: 1 },
  { key: 'maximumEscalationLevel', label: 'Maximum escalation level', min: 0 },
];
type Draft = Record<BooleanDraftKey, boolean> & Record<NumberDraftKey, string> & {
  severity: IncidentSeverity; evidenceRequiredOutcomes: IncidentOutcome[]; effectiveFrom: string; changeReason: string;
};
function effectiveDefault(): string {
  const value = new Date(Date.now() + 5 * 60_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}
function draftFrom(rule: IncidentRule): Draft {
  return {
    enabled: rule.enabled, createsIncident: rule.createsIncident, immediateNotification: rule.immediateNotification,
    inApp: rule.channels.inApp, email: rule.channels.email, whatsapp: rule.channels.whatsapp, includeInMorningSummary: rule.includeInMorningSummary,
    acknowledgementTargetMinutes: String(rule.acknowledgementTargetMinutes), reminderIntervalMinutes: String(rule.reminderIntervalMinutes),
    maximumEscalationLevel: String(rule.maximumEscalationLevel), severity: rule.severity, evidenceRequiredOutcomes: rule.evidenceRequiredOutcomes,
    effectiveFrom: effectiveDefault(), changeReason: '',
  };
}
function draftValid(draft: Draft | null): boolean {
  if (!draft || !draft.changeReason.trim() || !draft.effectiveFrom || Date.parse(draft.effectiveFrom) <= Date.now()) return false;
  return NUMBER_FIELDS.every((field) => Number.isInteger(Number(draft[field.key])) && Number(draft[field.key]) >= field.min);
}
function RulesSection({ canEdit }: { canEdit: boolean }) {
  const [incidentType, setIncidentType] = useState<IncidentType>('late');
  const [rules, setRules] = useState<IncidentRule[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const next = await incidentApi.listRules(incidentType); setRules(next); setDraft(next[0] ? draftFrom(next[0]) : null); setError(null); }
    catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not load incident rules'); }
  }, [incidentType]);
  useEffect(() => { void load(); }, [load]);
  async function create(): Promise<void> {
    if (!draft || !draftValid(draft)) return;
    setSaving(true); setError(null);
    try {
      await incidentApi.createRuleVersion({
        incidentType, enabled: draft.enabled, createsIncident: draft.createsIncident, severity: draft.severity,
        immediateNotification: draft.immediateNotification, channels: { inApp: draft.inApp, email: draft.email, whatsapp: draft.whatsapp },
        includeInMorningSummary: draft.includeInMorningSummary, acknowledgementTargetMinutes: Number(draft.acknowledgementTargetMinutes),
        reminderIntervalMinutes: Number(draft.reminderIntervalMinutes), maximumEscalationLevel: Number(draft.maximumEscalationLevel),
        evidenceRequiredOutcomes: draft.evidenceRequiredOutcomes, effectiveFrom: new Date(draft.effectiveFrom).toISOString(), changeReason: draft.changeReason.trim(),
      });
      await load();
    } catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not create a rule version'); }
    finally { setSaving(false); }
  }
  function toggleOutcome(outcome: IncidentOutcome): void {
    if (!draft) return;
    const has = draft.evidenceRequiredOutcomes.includes(outcome);
    setDraft({ ...draft, evidenceRequiredOutcomes: has ? draft.evidenceRequiredOutcomes.filter((item) => item !== outcome) : [...draft.evidenceRequiredOutcomes, outcome] });
  }
  return (
    <section aria-label="Incident rules" className="space-y-2">
      <h3 className="font-semibold text-[var(--ff-text-primary)]">Rules</h3>
      <label className="text-sm">Incident type
        <select aria-label="Rule incident type" value={incidentType} onChange={(event) => setIncidentType(event.target.value as IncidentType)} className="ml-2 rounded border px-2 py-1">
          {RULED_TYPES.map((type) => <option key={type} value={type}>{INCIDENT_TYPE_LABELS[type]}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {draft && canEdit && <div className="space-y-2 rounded border p-3">
        {BOOLEAN_FIELDS.map((field) => <label key={field.key} className="mr-3 inline-block text-sm">
          <input type="checkbox" checked={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.checked })} /> {field.label}
        </label>)}
        <label className="block text-sm">Severity
          <select aria-label="Rule severity" value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value as IncidentSeverity })} className="ml-2 rounded border px-2 py-1">
            {SEVERITIES.map((severity) => <option key={severity} value={severity}>{SEVERITY_LABELS[severity]}</option>)}
          </select>
        </label>
        {NUMBER_FIELDS.map((field) => <label key={field.key} className="mr-3 inline-block text-sm">{field.label}
          <input aria-label={field.label} type="number" min={field.min} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} className="ml-2 w-20 rounded border px-2 py-1" />
        </label>)}
        <fieldset className="text-sm"><legend>Evidence required for outcome</legend>
          {OUTCOMES.map((outcome) => <label key={outcome} className="mr-3 inline-block"><input type="checkbox" checked={draft.evidenceRequiredOutcomes.includes(outcome)} onChange={() => toggleOutcome(outcome)} /> {OUTCOME_LABELS[outcome]}</label>)}
        </fieldset>
        <label className="block text-sm">Effective from
          <input aria-label="Rule effective from" type="datetime-local" lang="en-ZA" min={effectiveDefault()} value={draft.effectiveFrom} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} className="ml-2 rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">Change reason
          <textarea aria-label="Rule change reason" value={draft.changeReason} onChange={(event) => setDraft({ ...draft, changeReason: event.target.value })} className="block w-full rounded border px-2 py-1" />
        </label>
        {/* text-black, not text-white: `--ff-primary` (#f59e0b) with white text measures ~2.15:1,
            well under the 4.5:1 floor, and reads as disabled. Black on this amber is ~9.8:1 in
            both themes (the token is identical light/dark) — fixed locally rather than touching
            `--ff-primary` itself, which is used app-wide and out of this page's scope. */}
        <button type="button" disabled={!draftValid(draft) || saving} onClick={() => void create()} className="rounded bg-[var(--ff-primary)] px-3 py-2 text-sm text-black disabled:opacity-50">
          {saving ? 'Creating version…' : 'Create rule version'}
        </button>
      </div>}
      <details><summary className="cursor-pointer text-sm">Version history ({rules.length})</summary>
        {rules.map((rule) => <p key={rule.id} className="text-sm">v{rule.version} — effective {new Date(rule.effectiveFrom).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}{rule.effectiveTo ? ` to ${new Date(rule.effectiveTo).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}` : ' (current)'}</p>)}
      </details>
    </section>
  );
}
export interface IncidentSettingsDialogProps { open: boolean; onClose: () => void; canEdit: boolean }

/**
 * Split from the exported wrapper so the focus hooks below are unconditional — the wrapper
 * returns null while closed, which would otherwise make them conditional hooks. Mounting
 * fresh on each open is also what lets the opener be captured during the first render.
 */
function SettingsDialogBody({ onClose, canEdit }: Omit<IncidentSettingsDialogProps, 'open'>) {
  const dialog = useRef<HTMLDivElement>(null);
  // Captured in a lazy initializer, which runs during the first render — by the time an
  // effect could look, autoFocus has already moved focus to the Close button.
  const [opener] = useState<HTMLElement | null>(
    () => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );

  useEffect(() => () => { if (opener?.isConnected) opener.focus(); }, [opener]);

  // Same trap IncidentReviewDrawer implements: without it Tab walks straight out of an open
  // modal into the page behind it, and Close drops focus on document.body.
  function handleKeys(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? []);
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable.at(-1)!;
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  }

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Fleet incident settings" className="fixed inset-0 z-50 overflow-auto bg-black/60 p-6"
      onKeyDown={handleKeys}>
      <div className="mx-auto max-w-3xl space-y-4 rounded-lg bg-[var(--ff-bg-primary)] p-6">
        <header className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Fleet incident settings</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="Close Fleet incident settings" className="rounded border px-3 py-2 text-sm">Close</button>
        </header>
        <RulesSection canEdit={canEdit} />
        <OversightSection canEdit={canEdit} />
        <DriverInputSection canEdit={canEdit} />
      </div>
    </div>
  );
}

export function IncidentSettingsDialog({ open, onClose, canEdit }: IncidentSettingsDialogProps) {
  if (!open) return null;
  return <SettingsDialogBody onClose={onClose} canEdit={canEdit} />;
}
